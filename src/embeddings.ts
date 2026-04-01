import OpenAI from "openai";

import type { AppConfig } from "./config.js";
import type { EmbeddingProvider } from "./types.js";

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
    const batchSize = 50;

    for (let index = 0; index < texts.length; index += batchSize) {
      const batch = texts.slice(index, index + batchSize);
      const response = await this.client.embeddings.create({
        model: this.model,
        input: batch,
      });

      results.push(...response.data.map((item) => item.embedding));
    }

    return results;
  }
}
