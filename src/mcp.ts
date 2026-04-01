import { McpServer, ResourceTemplate } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import type { AppConfig } from "./config.js";
import { RagDatabase } from "./database.js";
import { ingestGithubDocs } from "./ingest.js";
import { searchGithubDocs } from "./search.js";
import type { EmbeddingProvider } from "./types.js";

export async function startMcpServer(
  config: AppConfig,
  provider: EmbeddingProvider,
): Promise<void> {
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

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

export function buildChunkResourceUri(chunkId: string): string {
  return `github-docs://chunk/${encodeURIComponent(chunkId)}`;
}

export function buildPageResourceUri(repoPath: string): string {
  return `github-docs://page/${encodeURIComponent(repoPath)}`;
}
