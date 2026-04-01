import fs from "node:fs";
import path from "node:path";

import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

import type { ChunkRecord, DocumentRecord } from "./types.js";

type DatabaseRow = Record<string, unknown>;

export class RagDatabase {
  private readonly db: Database.Database;
  readonly dimension: number;

  constructor(
    dbPath: string,
    dimension: number,
    options?: { rebuild?: boolean | undefined },
  ) {
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.dimension = dimension;
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    loadSqliteVecExtension(this.db);
    this.ensureSchema(Boolean(options?.rebuild));
  }

  close(): void {
    this.db.close();
  }

  replaceIndex(records: {
    documents: DocumentRecord[];
    chunks: ChunkRecord[];
    embeddings: number[][];
  }): void {
    const insert = this.db.transaction(() => {
      this.db.exec(`
        DELETE FROM chunk_embeddings;
        DELETE FROM chunks_fts;
        DELETE FROM chunks;
        DELETE FROM documents;
      `);

      const insertDocument = this.db.prepare(`
        INSERT INTO documents (
          repo_path,
          page_title,
          canonical_url,
          source_commit_sha,
          updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const insertChunk = this.db.prepare(`
        INSERT INTO chunks (
          document_id,
          chunk_id,
          repo_path,
          page_title,
          section_title,
          section_slug,
          canonical_url,
          raw_markdown,
          plain_text,
          token_count,
          source_commit_sha,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const insertFts = this.db.prepare(`
        INSERT INTO chunks_fts (
          rowid,
          chunk_id,
          page_title,
          section_title,
          plain_text
        ) VALUES (?, ?, ?, ?, ?)
      `);

      const insertEmbedding = this.db.prepare(`
        INSERT INTO chunk_embeddings (chunk_rowid, embedding) VALUES (?, ?)
      `);

      const documentIds = new Map<string, number>();
      for (const document of records.documents) {
        const result = insertDocument.run(
          document.repoPath,
          document.pageTitle,
          document.canonicalUrl,
          document.sourceCommitSha,
          document.updatedAt,
        );

        documentIds.set(document.repoPath, Number(result.lastInsertRowid));
      }

      records.chunks.forEach((chunk, index) => {
        const documentId = documentIds.get(chunk.repoPath);
        if (!documentId) {
          throw new Error(`Missing document row for ${chunk.repoPath}`);
        }

        const result = insertChunk.run(
          documentId,
          chunk.chunkId,
          chunk.repoPath,
          chunk.pageTitle,
          chunk.sectionTitle,
          chunk.sectionSlug,
          chunk.canonicalUrl,
          chunk.rawMarkdown,
          chunk.plainText,
          chunk.tokenCount,
          chunk.sourceCommitSha,
          chunk.updatedAt,
        );

        const rowid = normalizeSqliteInteger(result.lastInsertRowid);
        insertFts.run(
          rowid,
          chunk.chunkId,
          chunk.pageTitle,
          chunk.sectionTitle ?? "",
          chunk.plainText,
        );
        insertEmbedding.run(rowid, JSON.stringify(records.embeddings[index]));
      });
    });

    insert();
  }

  getChunkByChunkId(chunkId: string): ChunkRecord | null {
    const row = this.db
      .prepare(`
        SELECT
          chunk_id as chunkId,
          repo_path as repoPath,
          page_title as pageTitle,
          section_title as sectionTitle,
          section_slug as sectionSlug,
          canonical_url as canonicalUrl,
          raw_markdown as rawMarkdown,
          plain_text as plainText,
          token_count as tokenCount,
          source_commit_sha as sourceCommitSha,
          updated_at as updatedAt
        FROM chunks
        WHERE chunk_id = ?
      `)
      .get(chunkId) as ChunkRecord | undefined;

    return row ?? null;
  }

  getChunksForRepoPath(repoPath: string): ChunkRecord[] {
    return this.db
      .prepare(`
        SELECT
          chunk_id as chunkId,
          repo_path as repoPath,
          page_title as pageTitle,
          section_title as sectionTitle,
          section_slug as sectionSlug,
          canonical_url as canonicalUrl,
          raw_markdown as rawMarkdown,
          plain_text as plainText,
          token_count as tokenCount,
          source_commit_sha as sourceCommitSha,
          updated_at as updatedAt
        FROM chunks
        WHERE repo_path = ?
        ORDER BY id
      `)
      .all(repoPath) as ChunkRecord[];
  }

  searchVector(
    embedding: number[],
    limit: number,
    pathPrefix?: string,
  ): Array<{ chunkId: string; distance: number }> {
    const rows = this.db
      .prepare(`
        WITH vector_matches AS (
          SELECT
            chunk_rowid,
            distance
          FROM chunk_embeddings
          WHERE embedding MATCH ?
            AND k = ?
        )
        SELECT
          c.chunk_id as chunkId,
          vm.distance as distance
        FROM vector_matches vm
        JOIN chunks c ON c.id = vm.chunk_rowid
        WHERE (? IS NULL OR c.repo_path LIKE ?)
        ORDER BY vm.distance
        LIMIT ?
      `)
      .all(
        JSON.stringify(embedding),
        limit,
        pathPrefix ?? null,
        pathPrefix ? `${pathPrefix}%` : null,
        limit,
      ) as Array<{ chunkId: string; distance: number }>;

    return rows;
  }

  searchLexical(
    query: string,
    limit: number,
    pathPrefix?: string,
  ): Array<{ chunkId: string; rank: number }> {
    const ftsQuery = buildFtsQuery(query);
    if (!ftsQuery) {
      return [];
    }

    return this.db
      .prepare(`
        SELECT
          c.chunk_id as chunkId,
          bm25(chunks_fts) as rank
        FROM chunks_fts
        JOIN chunks c ON c.id = chunks_fts.rowid
        WHERE chunks_fts MATCH ?
          AND (? IS NULL OR c.repo_path LIKE ?)
        ORDER BY rank
        LIMIT ?
      `)
      .all(
        ftsQuery,
        pathPrefix ?? null,
        pathPrefix ? `${pathPrefix}%` : null,
        limit,
      ) as Array<{ chunkId: string; rank: number }>;
  }

  countChunks(): number {
    const row = this.db
      .prepare("SELECT COUNT(*) as count FROM chunks")
      .get() as { count: number };
    return row.count;
  }

  private ensureSchema(rebuild: boolean): void {
    if (rebuild) {
      this.db.exec(`
        DROP TABLE IF EXISTS chunk_embeddings;
        DROP TABLE IF EXISTS chunks_fts;
        DROP TABLE IF EXISTS chunks;
        DROP TABLE IF EXISTS documents;
        DROP TABLE IF EXISTS metadata;
      `);
    }

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS metadata (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS documents (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        repo_path TEXT NOT NULL UNIQUE,
        page_title TEXT NOT NULL,
        canonical_url TEXT NOT NULL,
        source_commit_sha TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        document_id INTEGER NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
        chunk_id TEXT NOT NULL UNIQUE,
        repo_path TEXT NOT NULL,
        page_title TEXT NOT NULL,
        section_title TEXT,
        section_slug TEXT,
        canonical_url TEXT NOT NULL,
        raw_markdown TEXT NOT NULL,
        plain_text TEXT NOT NULL,
        token_count INTEGER NOT NULL,
        source_commit_sha TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
        chunk_id UNINDEXED,
        page_title,
        section_title,
        plain_text,
        tokenize='porter unicode61'
      );
    `);

    const dimensionRow = this.db
      .prepare("SELECT value FROM metadata WHERE key = 'embedding_dimension'")
      .get() as { value?: string } | undefined;

    if (!dimensionRow) {
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
          chunk_rowid integer primary key,
          embedding float[${this.dimension}]
        );
      `);
      this.db
        .prepare("INSERT OR REPLACE INTO metadata (key, value) VALUES (?, ?)")
        .run("embedding_dimension", String(this.dimension));
      return;
    }

    const existingDimension = Number.parseInt(dimensionRow.value ?? "", 10);
    if (existingDimension !== this.dimension) {
      throw new Error(
        `Embedding dimension mismatch: database expects ${existingDimension}, configured ${this.dimension}. Re-run ingest with --rebuild or set OPENAI_EMBEDDING_DIMENSION correctly.`,
      );
    }

    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS chunk_embeddings USING vec0(
        chunk_rowid integer primary key,
        embedding float[${this.dimension}]
      );
    `);
  }
}

function normalizeSqliteInteger(value: number | bigint): bigint {
  return typeof value === "bigint" ? value : BigInt(value);
}

function loadSqliteVecExtension(db: Database.Database): void {
  const moduleObject = sqliteVec as Record<string, unknown>;

  const load = moduleObject.load;
  if (typeof load === "function") {
    load(db);
    return;
  }

  const loadablePath =
    (moduleObject.loadablePath as string | undefined) ??
    (typeof moduleObject.path === "string" ? moduleObject.path : undefined);

  if (typeof loadablePath === "string" && typeof db.loadExtension === "function") {
    db.loadExtension(loadablePath);
    return;
  }

  throw new Error(
    "Unable to load sqlite-vec. Verify the sqlite-vec package is installed for this platform.",
  );
}

function buildFtsQuery(query: string): string | null {
  const tokens = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]*/g)
    ?.filter((token) => token.length > 1 && !STOP_WORDS.has(token));

  if (!tokens || tokens.length === 0) {
    return null;
  }

  return tokens.map((token) => `${token}*`).join(" AND ");
}

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "do",
  "for",
  "how",
  "i",
  "in",
  "is",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
]);
