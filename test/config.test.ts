import test from "node:test";
import assert from "node:assert/strict";

import { loadHttpServerConfig } from "../src/config.js";

test("loadHttpServerConfig reads defaults and normalizes path", () => {
  assert.deepEqual(loadHttpServerConfig({}), {
    host: "0.0.0.0",
    port: 3000,
    path: "/mcp",
  });

  assert.deepEqual(
    loadHttpServerConfig({
      MCP_HTTP_HOST: "127.0.0.1",
      MCP_HTTP_PORT: "8080",
      MCP_HTTP_PATH: "custom-mcp",
    }),
    {
      host: "127.0.0.1",
      port: 8080,
      path: "/custom-mcp",
    },
  );
});

test("loadHttpServerConfig rejects invalid ports", () => {
  assert.throws(
    () => loadHttpServerConfig({ MCP_HTTP_PORT: "not-a-number" }),
    /Invalid MCP_HTTP_PORT/,
  );
});
