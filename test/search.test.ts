import test from "node:test";
import assert from "node:assert/strict";

import { ingestPreparedSource } from "../src/ingest.js";
import { searchGithubDocs } from "../src/search.js";
import { createTempContentDir, createTestConfig, FakeEmbeddingProvider } from "./helpers.js";

test("search returns section metadata, url, and exact quote", async () => {
  const { rootDir, contentDir } = await createTempContentDir({
    "actions/secrets.md": `---
title: Using Actions secrets
---

## Store secrets

GitHub Actions secrets let you store encrypted tokens for workflows.

## Rotate secrets

Rotate secrets whenever credentials change.
`,
    "issues/triage.md": `---
title: Triage issues
---

## Manage issue intake

Issues should be labeled and assigned quickly.
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

  const results = await searchGithubDocs(
    config,
    provider,
    "How do I store GitHub Actions secrets?",
    { topK: 3 },
  );

  assert.ok(results.length > 0);
  assert.equal(results[0]?.sectionTitle, "Store secrets");
  assert.match(results[0]?.url ?? "", /docs\.github\.com\/en\/actions\/secrets#store-secrets$/);
  assert.ok(results[0]?.rawMarkdown.includes(results[0]?.quote ?? ""));
});
