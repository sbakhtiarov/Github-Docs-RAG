import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";

import { RagDatabase } from "../src/database.js";
import { ingestPreparedSource } from "../src/ingest.js";
import { createTempContentDir, createTestConfig, FakeEmbeddingProvider } from "./helpers.js";

test("reindex replaces stale chunks without duplicates", async () => {
  const { rootDir, contentDir } = await createTempContentDir({
    "actions/refresh.md": `---
title: Refresh docs
---

## First section

Old content.
`,
  });

  const config = createTestConfig(rootDir);
  const provider = new FakeEmbeddingProvider();

  await ingestPreparedSource(
    {
      repoRoot: rootDir,
      contentDir,
      sourceCommitSha: "sha-1",
    },
    config,
    provider,
    { rebuild: true },
  );

  await fs.writeFile(
    path.join(contentDir, "actions/refresh.md"),
    `---
title: Refresh docs
---

## First section

New content.
`,
    "utf8",
  );

  await ingestPreparedSource(
    {
      repoRoot: rootDir,
      contentDir,
      sourceCommitSha: "sha-2",
    },
    config,
    provider,
    { rebuild: false },
  );

  const database = new RagDatabase(config.dbPath, provider.dimension);
  try {
    assert.equal(database.countChunks(), 1);
    assert.match(
      database.getChunkByChunkId("content/actions/refresh.md#first-section")?.rawMarkdown ?? "",
      /New content\./,
    );
  } finally {
    database.close();
  }
});
