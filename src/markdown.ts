import GithubSlugger from "github-slugger";
import matter from "gray-matter";
import { toString } from "mdast-util-to-string";
import { unified } from "unified";
import remarkParse from "remark-parse";
import type { Heading, Root, RootContent } from "mdast";

import type { ChunkRecord, DocumentRecord } from "./types.js";
import { buildCanonicalUrl } from "./url.js";

interface MarkdownFragment {
  start: number;
  end: number;
  raw: string;
  plain: string;
  tokenCount: number;
}

interface SectionSeed {
  sectionTitle: string | null;
  sectionSlug: string | null;
  fragments: MarkdownFragment[];
}

const TARGET_TOKENS = 600;
const HARD_MAX_TOKENS = 900;

export function parseMarkdownDocument(params: {
  repoPath: string;
  markdown: string;
  sourceCommitSha: string;
  updatedAt: string;
}): {
  document: DocumentRecord;
  chunks: ChunkRecord[];
} {
  const { repoPath, markdown, sourceCommitSha, updatedAt } = params;
  const parsed = matter(markdown);
  const pageTitle = readPageTitle(parsed.data, repoPath);
  const body = parsed.content;
  const root = unified().use(remarkParse).parse(body) as Root;
  const sections = buildSections(body, root);

  const chunks = sections.flatMap((section) =>
    splitSectionIntoChunks({
      body,
      repoPath,
      pageTitle,
      sectionTitle: section.sectionTitle,
      sectionSlug: section.sectionSlug,
      fragments: section.fragments,
      sourceCommitSha,
      updatedAt,
    }),
  );

  const uniqueChunks = ensureUniqueChunkIds(chunks);

  return {
    document: {
      repoPath,
      pageTitle,
      canonicalUrl: buildCanonicalUrl(repoPath),
      sourceCommitSha,
      updatedAt,
    },
    chunks: uniqueChunks,
  };
}

function readPageTitle(data: Record<string, unknown>, repoPath: string): string {
  const title = data.title;
  if (typeof title === "string" && title.trim().length > 0) {
    return title.trim();
  }

  const fallback = repoPath.split("/").pop() ?? repoPath;
  return fallback.replace(/\.md$/, "");
}

function buildSections(body: string, root: Root): SectionSeed[] {
  const slugger = new GithubSlugger();
  const sections: SectionSeed[] = [];
  let introFragments: MarkdownFragment[] = [];
  let currentSection: SectionSeed | null = null;

  for (const node of root.children) {
    if (isChunkHeading(node)) {
      const fragment = fragmentFromNode(body, node);
      if (!fragment) {
        continue;
      }

      if (currentSection) {
        sections.push(currentSection);
      } else if (introFragments.length > 0) {
        sections.push({
          sectionTitle: null,
          sectionSlug: null,
          fragments: introFragments,
        });
        introFragments = [];
      }

      const sectionTitle = toString(node).trim();
      currentSection = {
        sectionTitle,
        sectionSlug: slugger.slug(sectionTitle),
        fragments: [fragment],
      };
      continue;
    }

    const fragment = fragmentFromNode(body, node);
    if (!fragment) {
      continue;
    }

    if (currentSection) {
      currentSection.fragments.push(fragment);
    } else {
      introFragments.push(fragment);
    }
  }

  if (currentSection) {
    sections.push(currentSection);
  } else if (introFragments.length > 0) {
    sections.push({
      sectionTitle: null,
      sectionSlug: null,
      fragments: introFragments,
    });
  }

  return sections;
}

function isChunkHeading(node: RootContent): node is Heading {
  return node.type === "heading" && (node.depth === 2 || node.depth === 3);
}

function fragmentFromNode(body: string, node: RootContent): MarkdownFragment | null {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  if (start == null || end == null || end <= start) {
    return null;
  }

  const raw = body.slice(start, end);
  const plain = markdownToPlainText(raw);

  return {
    start,
    end,
    raw,
    plain,
    tokenCount: estimateTokens(plain),
  };
}

function splitSectionIntoChunks(params: {
  body: string;
  repoPath: string;
  pageTitle: string;
  sectionTitle: string | null;
  sectionSlug: string | null;
  fragments: MarkdownFragment[];
  sourceCommitSha: string;
  updatedAt: string;
}): ChunkRecord[] {
  const {
    body,
    repoPath,
    pageTitle,
    sectionTitle,
    sectionSlug,
    sourceCommitSha,
    updatedAt,
  } = params;

  const fragments = expandOversizedFragments(params.fragments);
  const grouped = groupFragments(fragments);
  const baseChunkId = sectionSlug ? `${repoPath}#${sectionSlug}` : `${repoPath}#intro`;

  return grouped.map((group, index) => {
    const groupStart = group[0]?.start ?? 0;
    const groupEnd = group[group.length - 1]?.end ?? groupStart;
    const rawMarkdown = body.slice(groupStart, groupEnd).trim();
    const plainText = markdownToPlainText(rawMarkdown);
    const chunkId =
      grouped.length === 1
        ? baseChunkId
        : `${baseChunkId}:part-${String(index + 1).padStart(2, "0")}`;

    return {
      chunkId,
      repoPath,
      pageTitle,
      sectionTitle,
      sectionSlug,
      canonicalUrl: buildCanonicalUrl(repoPath, sectionSlug),
      rawMarkdown,
      plainText,
      tokenCount: estimateTokens(plainText),
      sourceCommitSha,
      updatedAt,
    };
  });
}

function expandOversizedFragments(fragments: MarkdownFragment[]): MarkdownFragment[] {
  const expanded: MarkdownFragment[] = [];
  for (const fragment of fragments) {
    if (fragment.tokenCount <= HARD_MAX_TOKENS) {
      expanded.push(fragment);
      continue;
    }

    expanded.push(...splitRawFragment(fragment));
  }
  return expanded;
}

function splitRawFragment(fragment: MarkdownFragment): MarkdownFragment[] {
  const segments = splitRawString(fragment.raw);
  let cursor = fragment.start;
  return segments.map((raw) => {
    const start = cursor;
    const end = start + raw.length;
    cursor = end;
    const plain = markdownToPlainText(raw);
    return {
      start,
      end,
      raw,
      plain,
      tokenCount: estimateTokens(plain),
    };
  });
}

function splitRawString(raw: string): string[] {
  const pieces: string[] = [];
  let cursor = 0;

  while (cursor < raw.length) {
    const remaining = raw.slice(cursor);
    if (estimateTokens(markdownToPlainText(remaining)) <= HARD_MAX_TOKENS) {
      pieces.push(remaining);
      break;
    }

    const targetChars = TARGET_TOKENS * 4;
    const hardChars = HARD_MAX_TOKENS * 4;
    const searchWindow = raw.slice(cursor, Math.min(raw.length, cursor + hardChars));

    const blankLine = searchWindow.lastIndexOf("\n\n", targetChars);
    const lineBreak = searchWindow.lastIndexOf("\n", targetChars);
    const boundary =
      blankLine > 0
        ? cursor + blankLine + 2
        : lineBreak > 0
          ? cursor + lineBreak + 1
          : Math.min(raw.length, cursor + hardChars);

    if (boundary <= cursor) {
      pieces.push(raw.slice(cursor, Math.min(raw.length, cursor + hardChars)));
      cursor = Math.min(raw.length, cursor + hardChars);
      continue;
    }

    pieces.push(raw.slice(cursor, boundary));
    cursor = boundary;
  }

  return pieces.filter((piece) => piece.trim().length > 0);
}

function groupFragments(fragments: MarkdownFragment[]): MarkdownFragment[][] {
  const groups: MarkdownFragment[][] = [];
  let current: MarkdownFragment[] = [];
  let currentTokens = 0;

  for (const fragment of fragments) {
    const nextTokens = currentTokens + fragment.tokenCount;
    const shouldSplit =
      current.length > 0 &&
      (nextTokens > TARGET_TOKENS || currentTokens >= TARGET_TOKENS);

    if (shouldSplit) {
      groups.push(current);
      current = [fragment];
      currentTokens = fragment.tokenCount;
      continue;
    }

    current.push(fragment);
    currentTokens = nextTokens;
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}

function ensureUniqueChunkIds(chunks: ChunkRecord[]): ChunkRecord[] {
  const counts = new Map<string, number>();

  return chunks.map((chunk) => {
    const nextCount = (counts.get(chunk.chunkId) ?? 0) + 1;
    counts.set(chunk.chunkId, nextCount);

    if (nextCount === 1) {
      return chunk;
    }

    return {
      ...chunk,
      chunkId: `${chunk.chunkId}:dup-${String(nextCount).padStart(2, "0")}`,
    };
  });
}

export function markdownToPlainText(markdown: string): string {
  const tree = unified().use(remarkParse).parse(markdown) as Root;
  const blockText = tree.children
    .map((node) => toString(node).trim())
    .filter((value) => value.length > 0)
    .join("\n\n");

  return (blockText || toString(tree)).replace(/\n{3,}/g, "\n\n").trim();
}

export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}
