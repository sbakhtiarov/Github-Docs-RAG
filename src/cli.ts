#!/usr/bin/env node

import { loadConfig, loadHttpServerConfig } from "./config.js";
import { OpenAiEmbeddingProvider } from "./embeddings.js";
import { ingestGithubDocs } from "./ingest.js";
import { startHttpMcpServer, startMcpServer } from "./mcp.js";
import { searchGithubDocs } from "./search.js";

async function main(): Promise<void> {
  const config = loadConfig();
  const command = process.argv[2];

  if (!command || ["-h", "--help", "help"].includes(command)) {
    printHelp();
    return;
  }

  const provider = new OpenAiEmbeddingProvider(config);

  switch (command) {
    case "ingest": {
      const pull = hasFlag("--pull");
      const rebuild = hasFlag("--rebuild");
      const result = await ingestGithubDocs(config, provider, { pull, rebuild });
      console.log(JSON.stringify(result, null, 2));
      return;
    }

    case "query": {
      const query = readOption("--q");
      if (!query) {
        throw new Error("Missing required option: --q");
      }

      const topK = Number.parseInt(readOption("--top-k") ?? "5", 10);
      const pathPrefix = readOption("--path-prefix");
      const results = await searchGithubDocs(config, provider, query, {
        topK,
        pathPrefix: pathPrefix ?? undefined,
      });
      console.log(JSON.stringify(results, null, 2));
      return;
    }

    case "mcp": {
      await startMcpServer(config, provider);
      return;
    }

    case "mcp-http": {
      const server = await startHttpMcpServer(
        config,
        provider,
        loadHttpServerConfig(),
      );
      console.log(`MCP HTTP server listening on ${server.endpoint}`);
      registerShutdown(server.close);
      return;
    }

    default:
      throw new Error(`Unknown command: ${command}`);
  }
}

function registerShutdown(close: () => Promise<void>): void {
  let shuttingDown = false;

  const shutdown = async (): Promise<void> => {
    if (shuttingDown) {
      return;
    }

    shuttingDown = true;
    await close();
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });
}

function hasFlag(flag: string): boolean {
  return process.argv.includes(flag);
}

function readOption(name: string): string | null {
  const index = process.argv.indexOf(name);
  if (index === -1) {
    return null;
  }

  return process.argv[index + 1] ?? null;
}

function printHelp(): void {
  console.log(`
Usage:
  github-docs-rag ingest [--pull] [--rebuild]
  github-docs-rag query --q "<text>" [--top-k N] [--path-prefix content/actions/]
  github-docs-rag mcp
  github-docs-rag mcp-http
  `.trim());
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(message);
  process.exitCode = 1;
});
