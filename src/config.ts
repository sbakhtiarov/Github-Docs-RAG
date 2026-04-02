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

export interface HttpServerConfig {
  host: string;
  port: number;
  path: string;
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

export function loadHttpServerConfig(
  env: NodeJS.ProcessEnv = process.env,
): HttpServerConfig {
  const port = Number.parseInt(env.MCP_HTTP_PORT ?? "3000", 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid MCP_HTTP_PORT: ${env.MCP_HTTP_PORT ?? ""}`);
  }

  return {
    host: env.MCP_HTTP_HOST?.trim() || "0.0.0.0",
    port,
    path: normalizeHttpPath(env.MCP_HTTP_PATH?.trim() || "/mcp"),
  };
}

function normalizeHttpPath(pathValue: string): string {
  if (!pathValue || pathValue === "/") {
    return "/mcp";
  }

  return pathValue.startsWith("/") ? pathValue : `/${pathValue}`;
}
