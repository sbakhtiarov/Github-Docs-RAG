import path from "node:path";
import { fileURLToPath } from "node:url";

export interface AppConfig {
  projectRoot: string;
  cacheDir: string;
  dbPath: string;
  sourceDir: string;
  contentDirOverride?: string | undefined;
  openAiApiKey?: string | undefined;
  embeddingModel: string;
  embeddingDimension: number;
}

export function getProjectRoot(): string {
  const currentFile = fileURLToPath(import.meta.url);
  return path.resolve(path.dirname(currentFile), "..");
}

export function loadConfig(): AppConfig {
  const projectRoot = getProjectRoot();
  const cacheDir =
    process.env.GITHUB_DOCS_RAG_CACHE_DIR ??
    path.join(projectRoot, ".cache", "github-docs-rag");

  return {
    projectRoot,
    cacheDir,
    dbPath:
      process.env.GITHUB_DOCS_RAG_DB_PATH ??
      path.join(cacheDir, "github-docs-rag.sqlite"),
    sourceDir:
      process.env.GITHUB_DOCS_RAG_SOURCE_DIR ??
      path.join(cacheDir, "github-docs"),
    contentDirOverride: process.env.GITHUB_DOCS_RAG_CONTENT_DIR,
    openAiApiKey: process.env.OPENAI_API_KEY,
    embeddingModel:
      process.env.OPENAI_EMBEDDING_MODEL ?? "text-embedding-3-small",
    embeddingDimension: Number.parseInt(
      process.env.OPENAI_EMBEDDING_DIMENSION ?? "1536",
      10,
    ),
  };
}
