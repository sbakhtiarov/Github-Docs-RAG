import test from "node:test";
import assert from "node:assert/strict";

import { parseMarkdownDocument } from "../src/markdown.js";

test("chunker creates intro and section chunks with stable ids", () => {
  const markdown = `---
title: Sample page
---

Intro paragraph before sections.

## First section

Alpha content.

### Nested section

Nested details.

#### Deep heading

Deep content that should stay inside the H3 chunk.
`;

  const parsed = parseMarkdownDocument({
    repoPath: "content/actions/sample-page.md",
    markdown,
    sourceCommitSha: "abc123",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  assert.equal(parsed.document.pageTitle, "Sample page");
  assert.deepEqual(
    parsed.chunks.map((chunk) => chunk.chunkId),
    [
      "content/actions/sample-page.md#intro",
      "content/actions/sample-page.md#first-section",
      "content/actions/sample-page.md#nested-section",
    ],
  );
  assert.equal(parsed.chunks[2]?.sectionTitle, "Nested section");
  assert.match(parsed.chunks[2]?.rawMarkdown ?? "", /#### Deep heading/);
});

test("chunker splits oversized sections into part chunks", () => {
  const repeatedParagraph = "\n\nA long paragraph about Actions workflows and secrets.".repeat(120);
  const markdown = `---
title: Large page
---

## Big section
${repeatedParagraph}
`;

  const parsed = parseMarkdownDocument({
    repoPath: "content/actions/large-page.md",
    markdown,
    sourceCommitSha: "abc123",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  assert.ok(parsed.chunks.length > 1);
  assert.equal(parsed.chunks[0]?.chunkId, "content/actions/large-page.md#big-section:part-01");
  assert.equal(parsed.chunks[1]?.chunkId, "content/actions/large-page.md#big-section:part-02");
});

test("chunker keeps chunk ids unique when a heading slug collides with intro", () => {
  const markdown = `---
title: Collision page
---

Lead in text.

## Overview

Overview details.

### intro

Heading named intro.
`;

  const parsed = parseMarkdownDocument({
    repoPath: "content/example/collision.md",
    markdown,
    sourceCommitSha: "abc123",
    updatedAt: "2026-04-01T00:00:00.000Z",
  });

  assert.deepEqual(
    parsed.chunks.map((chunk) => chunk.chunkId),
    [
      "content/example/collision.md#intro",
      "content/example/collision.md#overview",
      "content/example/collision.md#intro:dup-02",
    ],
  );
  assert.equal(parsed.chunks[2]?.sectionSlug, "intro");
});
