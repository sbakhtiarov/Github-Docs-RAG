import test from "node:test";
import assert from "node:assert/strict";

import { buildChunkResourceUri, buildPageResourceUri } from "../src/mcp.js";

test("mcp resource URIs encode chunk ids and repo paths safely", () => {
  assert.equal(
    buildChunkResourceUri("content/actions/foo.md#bar:baz"),
    "github-docs://chunk/content%2Factions%2Ffoo.md%23bar%3Abaz",
  );
  assert.equal(
    buildPageResourceUri("content/actions/foo.md"),
    "github-docs://page/content%2Factions%2Ffoo.md",
  );
});
