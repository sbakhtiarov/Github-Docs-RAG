import type { AppConfig } from "./config.js";
import { RagDatabase } from "./database.js";
import type { EmbeddingProvider, SearchOptions, SearchResult } from "./types.js";

export async function searchGithubDocs(
  config: AppConfig,
  provider: EmbeddingProvider,
  query: string,
  options?: SearchOptions,
): Promise<SearchResult[]> {
  const database = new RagDatabase(config.dbPath, provider.dimension);
  try {
    const [embedding] = await provider.embed([query]);
    if (!embedding) {
      return [];
    }

    const vectorMatches = database.searchVector(
      embedding,
      Math.max((options?.topK ?? 5) * 4, 20),
      options?.pathPrefix,
    );
    const lexicalMatches = database.searchLexical(
      query,
      Math.max((options?.topK ?? 5) * 4, 20),
      options?.pathPrefix,
    );

    const scored = new Map<
      string,
      {
        chunk: SearchResult;
        score: number;
      }
    >();

    vectorMatches.forEach((match, index) => {
      const chunk = database.getChunkByChunkId(match.chunkId);
      if (!chunk) {
        return;
      }

      const vectorScore = 1 / (index + 1);
      upsertScore(scored, {
        chunkId: chunk.chunkId,
        repoPath: chunk.repoPath,
        pageTitle: chunk.pageTitle,
        sectionTitle: chunk.sectionTitle,
        url: chunk.canonicalUrl,
        score: vectorScore * 0.4,
        quote: chooseQuote(chunk.rawMarkdown, query),
        rawMarkdown: chunk.rawMarkdown,
        plainText: chunk.plainText,
      });
    });

    lexicalMatches.forEach((match, index) => {
      const chunk = database.getChunkByChunkId(match.chunkId);
      if (!chunk) {
        return;
      }

      const lexicalScore = 1 / (index + 1);
      upsertScore(scored, {
        chunkId: chunk.chunkId,
        repoPath: chunk.repoPath,
        pageTitle: chunk.pageTitle,
        sectionTitle: chunk.sectionTitle,
        url: chunk.canonicalUrl,
        score: lexicalScore * 0.6,
        quote: chooseQuote(chunk.rawMarkdown, query),
        rawMarkdown: chunk.rawMarkdown,
        plainText: chunk.plainText,
      });
    });

    return [...scored.values()]
      .sort((left, right) => right.score - left.score)
      .slice(0, options?.topK ?? 5)
      .map((entry) => ({
        ...entry.chunk,
        score: Number(entry.score.toFixed(6)),
      }));
  } finally {
    database.close();
  }
}

function upsertScore(
  scored: Map<string, { chunk: SearchResult; score: number }>,
  chunk: SearchResult,
): void {
  const existing = scored.get(chunk.chunkId);
  if (!existing) {
    scored.set(chunk.chunkId, { chunk, score: chunk.score });
    return;
  }

  existing.score += chunk.score;
}

export function chooseQuote(rawMarkdown: string, query: string): string {
  const terms = query
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9_-]*/g)
    ?.filter((term) => term.length > 1) ?? [];

  const paragraphs = rawMarkdown
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph.length > 0);

  const bestParagraph =
    paragraphs
      .map((paragraph) => ({
        paragraph,
        score: terms.reduce((count, term) => {
          return count + (paragraph.toLowerCase().includes(term) ? 1 : 0);
        }, 0),
      }))
      .sort((left, right) => right.score - left.score)[0]?.paragraph ??
    rawMarkdown.trim();

  if (bestParagraph.length <= 500) {
    return bestParagraph;
  }

  const firstTerm = terms.find((term) =>
    bestParagraph.toLowerCase().includes(term),
  );
  if (!firstTerm) {
    return bestParagraph.slice(0, 500);
  }

  const index = bestParagraph.toLowerCase().indexOf(firstTerm);
  const start = Math.max(0, index - 120);
  const end = Math.min(bestParagraph.length, start + 500);
  return bestParagraph.slice(start, end);
}
