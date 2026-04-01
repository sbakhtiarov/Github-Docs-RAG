import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import type { AppConfig } from "../src/config.js";
import type { EmbeddingProvider } from "../src/types.js";

export class FakeEmbeddingProvider implements EmbeddingProvider {
  readonly name = "fake";
  readonly model = "fake-test-model";
  readonly dimension = 4;

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => embedDeterministically(text));
  }
}

export async function createTempContentDir(
  files: Record<string, string>,
): Promise<{ rootDir: string; contentDir: string }> {
  const rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "github-docs-rag-"));
  const contentDir = path.join(rootDir, "content");
  await fs.mkdir(contentDir, { recursive: true });

  await Promise.all(
    Object.entries(files).map(async ([relativePath, content]) => {
      const absolutePath = path.join(contentDir, relativePath);
      await fs.mkdir(path.dirname(absolutePath), { recursive: true });
      await fs.writeFile(absolutePath, content, "utf8");
    }),
  );

  return { rootDir, contentDir };
}

export function createTestConfig(rootDir: string): AppConfig {
  return {
    projectRoot: rootDir,
    cacheDir: path.join(rootDir, ".cache"),
    dbPath: path.join(rootDir, ".cache", "test.sqlite"),
    sourceDir: path.join(rootDir, ".cache", "github-docs"),
    contentDirOverride: path.join(rootDir, "content"),
    embeddingModel: "fake-test-model",
    embeddingDimension: 4,
  };
}

function embedDeterministically(text: string): number[] {
  const lower = text.toLowerCase();
  return [
    count(lower, "actions") + count(lower, "workflow"),
    count(lower, "secret") + count(lower, "token"),
    count(lower, "issue") + count(lower, "pull request"),
    Math.max(1, Math.ceil(lower.length / 50)),
  ];
}

function count(text: string, needle: string): number {
  return text.split(needle).length - 1;
}
