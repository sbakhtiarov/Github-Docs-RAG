export interface DocumentRecord {
  repoPath: string;
  pageTitle: string;
  canonicalUrl: string;
  sourceCommitSha: string;
  updatedAt: string;
}

export interface ChunkRecord {
  chunkId: string;
  repoPath: string;
  pageTitle: string;
  sectionTitle: string | null;
  sectionSlug: string | null;
  canonicalUrl: string;
  rawMarkdown: string;
  plainText: string;
  tokenCount: number;
  sourceCommitSha: string;
  updatedAt: string;
}

export interface SearchResult {
  chunkId: string;
  repoPath: string;
  pageTitle: string;
  sectionTitle: string | null;
  url: string;
  score: number;
  quote: string;
  rawMarkdown: string;
  plainText: string;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly model: string;
  readonly dimension: number;
  embed(texts: string[]): Promise<number[][]>;
}

export interface IngestOptions {
  pull?: boolean | undefined;
  rebuild?: boolean | undefined;
}

export interface SearchOptions {
  topK?: number | undefined;
  pathPrefix?: string | undefined;
}

export interface PreparedSource {
  repoRoot: string;
  contentDir: string;
  sourceCommitSha: string;
}
