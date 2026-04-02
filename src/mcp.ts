import http from "node:http";
import type { AddressInfo } from "node:net";

import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { z } from "zod";

import type { AppConfig, HttpServerConfig } from "./config.js";
import { RagDatabase } from "./database.js";
import { ingestGithubDocs } from "./ingest.js";
import { searchGithubDocs } from "./search.js";
import type { EmbeddingProvider } from "./types.js";

export interface HttpMcpServerHandle {
  readonly endpoint: string;
  readonly host: string;
  readonly path: string;
  readonly port: number;
  close(): Promise<void>;
}

export function createMcpServer(
  config: AppConfig,
  provider: EmbeddingProvider,
): McpServer {
  const server = new McpServer({
    name: "github-docs-rag",
    version: "0.1.0",
  });

  server.tool(
    "search_github_docs",
    {
      query: z.string().min(1),
      topK: z.number().int().positive().max(20).optional(),
      pathPrefix: z.string().optional(),
    },
    async ({ query, topK, pathPrefix }) => {
      const results = await searchGithubDocs(config, provider, query, {
        topK,
        pathPrefix,
      });

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(results, null, 2),
          },
        ],
      };
    },
  );

  server.tool(
    "get_github_doc_chunk",
    {
      chunkId: z.string().min(1),
    },
    async ({ chunkId }) => {
      const database = new RagDatabase(config.dbPath, provider.dimension);
      try {
        const chunk = database.getChunkByChunkId(chunkId);
        if (!chunk) {
          return {
            content: [
              {
                type: "text",
                text: `Chunk not found: ${chunkId}`,
              },
            ],
          };
        }

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(chunk, null, 2),
            },
          ],
        };
      } finally {
        database.close();
      }
    },
  );

  server.tool(
    "refresh_github_docs_index",
    {
      pull: z.boolean().optional(),
    },
    async ({ pull }) => {
      const result = await ingestGithubDocs(config, provider, {
        pull,
      });
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    },
  );

  server.resource(
    "github-docs-chunk",
    new ResourceTemplate("github-docs://chunk/{chunkId}", { list: undefined }),
    async (uri, params) => {
      const chunkId = decodeURIComponent(String(params.chunkId));
      const database = new RagDatabase(config.dbPath, provider.dimension);
      try {
        const chunk = database.getChunkByChunkId(chunkId);
        if (!chunk) {
          throw new Error(`Chunk not found: ${chunkId}`);
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(chunk, null, 2),
            },
          ],
        };
      } finally {
        database.close();
      }
    },
  );

  server.resource(
    "github-docs-page",
    new ResourceTemplate("github-docs://page/{repoPath}", { list: undefined }),
    async (uri, params) => {
      const repoPath = decodeURIComponent(String(params.repoPath));
      const database = new RagDatabase(config.dbPath, provider.dimension);
      try {
        const chunks = database.getChunksForRepoPath(repoPath);
        if (chunks.length === 0) {
          throw new Error(`Page not found: ${repoPath}`);
        }

        return {
          contents: [
            {
              uri: uri.href,
              mimeType: "application/json",
              text: JSON.stringify(chunks, null, 2),
            },
          ],
        };
      } finally {
        database.close();
      }
    },
  );

  return server;
}

export async function startMcpServer(
  config: AppConfig,
  provider: EmbeddingProvider,
): Promise<void> {
  const server = createMcpServer(config, provider);
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export async function startHttpMcpServer(
  config: AppConfig,
  provider: EmbeddingProvider,
  httpConfig: HttpServerConfig,
): Promise<HttpMcpServerHandle> {
  const server = http.createServer((request, response) => {
    void handleHttpRequest(config, provider, httpConfig, request, response);
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(httpConfig.port, httpConfig.host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to resolve MCP HTTP server address.");
  }

  return {
    endpoint: buildHttpEndpoint(address, httpConfig.path, httpConfig.host),
    host: httpConfig.host,
    path: httpConfig.path,
    port: address.port,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }

          resolve();
        });
      }),
  };
}

async function handleHttpRequest(
  config: AppConfig,
  provider: EmbeddingProvider,
  httpConfig: HttpServerConfig,
  request: http.IncomingMessage,
  response: http.ServerResponse,
): Promise<void> {
  const requestUrl = new URL(
    request.url ?? "/",
    `http://${request.headers.host ?? "localhost"}`,
  );

  if (requestUrl.pathname !== httpConfig.path) {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  if (request.method !== "POST") {
    writeJsonRpcError(response, 405, -32000, "Method not allowed.");
    return;
  }

  let parsedBody: unknown;
  try {
    parsedBody = await readJsonBody(request);
  } catch {
    writeJsonRpcError(response, 400, -32700, "Invalid JSON body.");
    return;
  }

  const server = createMcpServer(config, provider);
  const transport = new StreamableHTTPServerTransport();

  let cleanedUp = false;
  const cleanup = async (): Promise<void> => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    response.off("close", onClose);
    await transport.close().catch(() => undefined);
    await Promise.resolve(server.close());
  };
  const onClose = (): void => {
    void cleanup();
  };

  response.on("close", onClose);

  try {
    await server.connect(transport as Parameters<typeof server.connect>[0]);
    await transport.handleRequest(request, response, parsedBody);
  } catch (error) {
    console.error("Error handling HTTP MCP request:", error);
    if (!response.headersSent) {
      writeJsonRpcError(response, 500, -32603, "Internal server error");
    }
  } finally {
    await cleanup();
  }
}

async function readJsonBody(request: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];

  for await (const chunk of request) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }

  if (chunks.length === 0) {
    return undefined;
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function writeJsonRpcError(
  response: http.ServerResponse,
  statusCode: number,
  code: number,
  message: string,
): void {
  response.writeHead(statusCode, { "content-type": "application/json" });
  response.end(
    JSON.stringify({
      jsonrpc: "2.0",
      error: {
        code,
        message,
      },
      id: null,
    }),
  );
}

function buildHttpEndpoint(
  address: AddressInfo,
  path: string,
  host: string,
): string {
  const publicHost =
    host === "0.0.0.0" || host === "::" ? "localhost" : address.address;
  const formattedHost =
    publicHost.includes(":") && !publicHost.startsWith("[")
      ? `[${publicHost}]`
      : publicHost;

  return `http://${formattedHost}:${address.port}${path}`;
}

export function buildChunkResourceUri(chunkId: string): string {
  return `github-docs://chunk/${encodeURIComponent(chunkId)}`;
}

export function buildPageResourceUri(repoPath: string): string {
  return `github-docs://page/${encodeURIComponent(repoPath)}`;
}
