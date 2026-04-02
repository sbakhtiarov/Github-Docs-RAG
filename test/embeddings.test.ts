import test from "node:test";
import assert from "node:assert/strict";

import {
  createEmbeddingsForBatch,
  isRetryableEmbeddingError,
  isJsonBodyParseError,
  resolveEmbeddingRetryDelayMs,
} from "../src/embeddings.js";

test("429 and 5xx embedding errors are retryable", () => {
  assert.equal(
    isRetryableEmbeddingError({ status: 429, headers: new Headers() }),
    true,
  );
  assert.equal(
    isRetryableEmbeddingError({ status: 503, headers: new Headers() }),
    true,
  );
  assert.equal(
    isRetryableEmbeddingError({ status: 400, headers: new Headers() }),
    false,
  );
});

test("retry delay honors retry-after-ms header", () => {
  const headers = new Headers({
    "retry-after-ms": "530",
  });

  assert.equal(
    resolveEmbeddingRetryDelayMs({ status: 429, headers }, 0),
    750,
  );
});

test("retry delay falls back to exponential backoff", () => {
  assert.equal(
    resolveEmbeddingRetryDelayMs({ status: 429, headers: new Headers() }, 0),
    750,
  );
  assert.equal(
    resolveEmbeddingRetryDelayMs({ status: 429, headers: new Headers() }, 2),
    3000,
  );
});

test("json body parse errors are recognized", () => {
  assert.equal(
    isJsonBodyParseError({
      status: 400,
      message: "We could not parse the JSON body of your request.",
    }),
    true,
  );
  assert.equal(
    isJsonBodyParseError({
      status: 400,
      message: "Other bad request",
    }),
    false,
  );
});

test("embedding batch falls back to smaller requests on JSON body parse error", async () => {
  const seen: number[] = [];
  const embeddings = await createEmbeddingsForBatch(
    ["a", "b", "c", "d"],
    {
      batchStart: 0,
      totalTexts: 4,
      model: "test-model",
      dimension: 3,
    },
    async (input) => {
      seen.push(input.length);
      if (input.length > 2) {
        throw {
          status: 400,
          message: "We could not parse the JSON body of your request.",
        };
      }

      return {
        data: input.map((_, index) => ({
          embedding: [input.length, index, 1],
        })),
      };
    },
  );

  assert.deepEqual(seen, [4, 2, 2]);
  assert.deepEqual(embeddings, [
    [2, 0, 1],
    [2, 1, 1],
    [2, 0, 1],
    [2, 1, 1],
  ]);
});
