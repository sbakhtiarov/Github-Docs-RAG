import test from "node:test";
import assert from "node:assert/strict";

import { buildCanonicalUrl, deriveDocsPageUrl } from "../src/url.js";

test("derives canonical docs URL from a standard page path", () => {
  assert.equal(
    deriveDocsPageUrl("content/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions.md"),
    "https://docs.github.com/en/actions/security-for-github-actions/security-guides/using-secrets-in-github-actions",
  );
});

test("derives canonical docs URL from an index page path", () => {
  assert.equal(
    deriveDocsPageUrl("content/actions/index.md"),
    "https://docs.github.com/en/actions",
  );
});

test("falls back to source blob URL for non-content files", () => {
  assert.equal(
    buildCanonicalUrl("README.md"),
    "https://github.com/github/docs/blob/main/README.md",
  );
});
