import test from "node:test";
import assert from "node:assert/strict";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

import { ingestPreparedSource } from "../src/ingest.js";
import { startHttpMcpServer } from "../src/mcp.js";
import { createTempContentDir, createTestConfig, FakeEmbeddingProvider } from "./helpers.js";

test("http MCP server exposes search and chunk tools", async () => {
  const { rootDir, contentDir } = await createTempContentDir({
    "actions/secrets.md": `---
title: Using Actions secrets
---

## Store secrets

GitHub Actions secrets let you store encrypted tokens for workflows.

## Rotate secrets

Rotate secrets whenever credentials change.
`,
    "actions/workflows.md": `---
title: Create workflows
---

## Reuse workflows

Reusable workflows help you share workflow logic.
`,
  });

  const config = createTestConfig(rootDir);
  const provider = new FakeEmbeddingProvider();

  await ingestPreparedSource(
    {
      repoRoot: rootDir,
      contentDir,
      sourceCommitSha: "fixture-sha",
    },
    config,
    provider,
    { rebuild: true },
  );

  const server = await startHttpMcpServer(config, provider, {
    host: "127.0.0.1",
    port: 0,
    path: "/mcp",
  });

  const client = new Client({
    name: "github-docs-rag-test-client",
    version: "0.1.0",
  });
  const transport = new StreamableHTTPClientTransport(new URL(server.endpoint));

  try {
    await client.connect(transport as Parameters<typeof client.connect>[0]);

    const searchResponse = await client.callTool({
      name: "search_github_docs",
      arguments: {
        query: "How do I store GitHub Actions secrets?",
        topK: 2,
      },
    });

    const searchContent = searchResponse.content as Array<{
      type: string;
      text?: string;
    }>;
    const searchText = searchContent[0];
    assert.equal(searchText?.type, "text");
    const results = JSON.parse(searchText?.text ?? "[]") as Array<{
      chunkId: string;
      sectionTitle: string | null;
    }>;

    const firstResult = results[0];
    assert.ok(firstResult);
    assert.equal(firstResult.sectionTitle, "Store secrets");

    const chunkResponse = await client.callTool({
      name: "get_github_doc_chunk",
      arguments: {
        chunkId: firstResult.chunkId,
      },
    });

    const chunkContent = chunkResponse.content as Array<{
      type: string;
      text?: string;
    }>;
    const chunkText = chunkContent[0];
    assert.equal(chunkText?.type, "text");
    const chunk = JSON.parse(chunkText?.text ?? "{}") as {
      pageTitle?: string;
      sectionTitle?: string | null;
    };

    assert.equal(chunk.pageTitle, "Using Actions secrets");
    assert.equal(chunk.sectionTitle, "Store secrets");
  } finally {
    await transport.close();
    await server.close();
  }
});
