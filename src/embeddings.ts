import OpenAI from "openai";

import type { AppConfig } from "./config.js";
import type { EmbeddingProvider } from "./types.js";

const EMBEDDING_BATCH_SIZE = 20;
const MAX_EMBEDDING_RETRIES = 8;
const BASE_RETRY_DELAY_MS = 750;
const MAX_RETRY_DELAY_MS = 15_000;

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = "openai";
  readonly model: string;
  readonly dimension: number;

  private readonly client: OpenAI;

  constructor(config: AppConfig) {
    if (!config.openAiApiKey) {
      throw new Error("OPENAI_API_KEY is required for embeddings.");
    }

    this.model = config.embeddingModel;
    this.dimension = config.embeddingDimension;
    this.client = new OpenAI({
      apiKey: config.openAiApiKey,
    });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const results: number[][] = [];
    const sanitizedTexts = texts.map((text) => sanitizeEmbeddingInput(text));

    for (let index = 0; index < sanitizedTexts.length; index += EMBEDDING_BATCH_SIZE) {
      const batch = sanitizedTexts.slice(index, index + EMBEDDING_BATCH_SIZE);
      const embeddings = await createEmbeddingsForBatch(
        batch,
        {
          batchStart: index,
          totalTexts: sanitizedTexts.length,
          model: this.model,
          dimension: this.dimension,
        },
        (input) =>
          createEmbeddingWithRetry(
            () =>
              this.client.embeddings.create({
                model: this.model,
                input,
              }),
            {
              batchStart: index,
              batchSize: input.length,
              totalTexts: sanitizedTexts.length,
              model: this.model,
            },
          ),
      );

      results.push(...embeddings);
    }

    return results;
  }
}

export async function createEmbeddingsForBatch(
  batch: string[],
  context: {
    batchStart: number;
    totalTexts: number;
    model: string;
    dimension: number;
  },
  requestEmbeddings: (input: string[]) => Promise<{ data: Array<{ embedding: number[] }> }>,
): Promise<number[][]> {
  try {
    const response = await requestEmbeddings(batch);
    return response.data.map((item) => item.embedding);
  } catch (error) {
    if (!isJsonBodyParseError(error)) {
      throw error;
    }

    if (batch.length === 1) {
      console.warn(
        `Skipping one embedding input at position ${context.batchStart + 1} after OpenAI rejected its JSON body; using a zero vector fallback.`,
      );
      return [new Array<number>(context.dimension).fill(0)];
    }

    const midpoint = Math.ceil(batch.length / 2);
    console.warn(
      `Splitting embeddings batch ${context.batchStart + 1}-${context.batchStart + batch.length} for model ${context.model} after OpenAI rejected the request body.`,
    );
    const left = await createEmbeddingsForBatch(
      batch.slice(0, midpoint),
      {
        ...context,
        batchStart: context.batchStart,
      },
      requestEmbeddings,
    );
    const right = await createEmbeddingsForBatch(
      batch.slice(midpoint),
      {
        ...context,
        batchStart: context.batchStart + midpoint,
      },
      requestEmbeddings,
    );
    return [...left, ...right];
  }
}

export async function createEmbeddingWithRetry<T>(
  create: () => Promise<T>,
  context: {
    batchStart: number;
    batchSize: number;
    totalTexts: number;
    model: string;
  },
): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      return await create();
    } catch (error) {
      if (!isRetryableEmbeddingError(error) || attempt >= MAX_EMBEDDING_RETRIES) {
        throw error;
      }

      const delayMs = resolveEmbeddingRetryDelayMs(error, attempt);
      console.warn(
        `Retrying embeddings batch ${context.batchStart + 1}-${context.batchStart + context.batchSize} of ${context.totalTexts} for model ${context.model} after ${delayMs}ms due to transient API error.`,
      );
      await sleep(delayMs);
    }
  }
}

export function isRetryableEmbeddingError(error: unknown): boolean {
  const status = readNumericProperty(error, "status");
  return status === 429 || (status != null && status >= 500);
}

export function isJsonBodyParseError(error: unknown): boolean {
  const status = readNumericProperty(error, "status");
  if (status !== 400) {
    return false;
  }

  const message = readStringProperty(error, "message");
  return typeof message === "string" && message.includes("parse the JSON body");
}

export function resolveEmbeddingRetryDelayMs(
  error: unknown,
  attempt: number,
): number {
  const retryAfterMs = readRetryAfterMs(error);
  if (retryAfterMs != null) {
    return clampDelay(retryAfterMs);
  }

  return clampDelay(BASE_RETRY_DELAY_MS * 2 ** attempt);
}

function readRetryAfterMs(error: unknown): number | null {
  const headers = readHeadersLike(error);
  if (!headers) {
    return null;
  }

  const retryAfterMs = headers.get("retry-after-ms");
  if (retryAfterMs) {
    const parsed = Number.parseInt(retryAfterMs, 10);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }

  const retryAfter = headers.get("retry-after");
  if (!retryAfter) {
    return null;
  }

  const retryAfterSeconds = Number.parseFloat(retryAfter);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds >= 0) {
    return retryAfterSeconds * 1000;
  }

  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) {
    return null;
  }

  return Math.max(0, retryAt - Date.now());
}

function readHeadersLike(error: unknown): Headers | null {
  if (!error || typeof error !== "object" || !("headers" in error)) {
    return null;
  }

  const headers = error.headers;
  return headers instanceof Headers ? headers : null;
}

function readNumericProperty(
  value: unknown,
  property: string,
): number | null {
  if (!value || typeof value !== "object" || !(property in value)) {
    return null;
  }

  const propertyValue = value[property as keyof typeof value];
  return typeof propertyValue === "number" ? propertyValue : null;
}

function readStringProperty(
  value: unknown,
  property: string,
): string | null {
  if (!value || typeof value !== "object" || !(property in value)) {
    return null;
  }

  const propertyValue = value[property as keyof typeof value];
  return typeof propertyValue === "string" ? propertyValue : null;
}

function clampDelay(delayMs: number): number {
  return Math.min(Math.max(Math.ceil(delayMs), BASE_RETRY_DELAY_MS), MAX_RETRY_DELAY_MS);
}

async function sleep(delayMs: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, delayMs);
  });
}

function sanitizeEmbeddingInput(text: string): string {
  return text
    .normalize("NFC")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, " ");
}
