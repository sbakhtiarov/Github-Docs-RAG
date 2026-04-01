import fs from "node:fs/promises";
import path from "node:path";

import type { AppConfig } from "./config.js";
import { RagDatabase } from "./database.js";
import { parseMarkdownDocument } from "./markdown.js";
import { listMarkdownFiles, prepareSource } from "./source.js";
import type { ChunkRecord, DocumentRecord, EmbeddingProvider, IngestOptions } from "./types.js";

export async function ingestGithubDocs(
  config: AppConfig,
  provider: EmbeddingProvider,
  options?: IngestOptions,
): Promise<{ documentCount: number; chunkCount: number }> {
  const source = await prepareSource(config, { pull: options?.pull });
  return ingestPreparedSource(source, config, provider, options);
}

export async function ingestPreparedSource(
  source: { repoRoot: string; contentDir: string; sourceCommitSha: string },
  config: AppConfig,
  provider: EmbeddingProvider,
  options?: IngestOptions,
): Promise<{ documentCount: number; chunkCount: number }> {
  const files = await listMarkdownFiles(source.contentDir);
  const updatedAt = new Date().toISOString();
  const documents: DocumentRecord[] = [];
  const chunks: ChunkRecord[] = [];

  for (const filePath of files) {
    const markdown = await fs.readFile(filePath, "utf8");
    const repoPath = normalizeRepoPath(source, filePath);
    const parsed = parseMarkdownDocument({
      repoPath,
      markdown,
      sourceCommitSha: source.sourceCommitSha,
      updatedAt,
    });

    if (parsed.chunks.length === 0) {
      continue;
    }

    documents.push(parsed.document);
    chunks.push(...parsed.chunks);
  }

  const embeddings = await provider.embed(
    chunks.map((chunk) => buildEmbeddingInput(chunk)),
  );

  const database = new RagDatabase(config.dbPath, provider.dimension, {
    rebuild: options?.rebuild,
  });

  try {
    database.replaceIndex({
      documents,
      chunks,
      embeddings,
    });
  } finally {
    database.close();
  }

  return {
    documentCount: documents.length,
    chunkCount: chunks.length,
  };
}

function normalizeRepoPath(
  source: { repoRoot: string; contentDir: string },
  filePath: string,
): string {
  const fromRepoRoot = path.relative(source.repoRoot, filePath);
  if (!fromRepoRoot.startsWith("..")) {
    return fromRepoRoot.split(path.sep).join("/");
  }

  const fromContentDir = path.relative(source.contentDir, filePath);
  return path.posix.join("content", fromContentDir.split(path.sep).join("/"));
}

function buildEmbeddingInput(chunk: ChunkRecord): string {
  return [chunk.pageTitle, chunk.sectionTitle, chunk.plainText]
    .filter((value): value is string => Boolean(value && value.trim().length > 0))
    .join("\n\n");
}
