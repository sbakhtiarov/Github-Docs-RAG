const DOCS_BASE_URL = "https://docs.github.com/en";
const SOURCE_BASE_URL = "https://github.com/github/docs/blob/main";

export function buildCanonicalUrl(
  repoPath: string,
  sectionSlug?: string | null,
): string {
  const pageUrl = deriveDocsPageUrl(repoPath) ?? buildSourceBlobUrl(repoPath);
  return sectionSlug ? `${pageUrl}#${sectionSlug}` : pageUrl;
}

export function deriveDocsPageUrl(repoPath: string): string | null {
  if (!repoPath.startsWith("content/") || !repoPath.endsWith(".md")) {
    return null;
  }

  let relativePath = repoPath.slice("content/".length, -".md".length);

  if (relativePath === "index") {
    return DOCS_BASE_URL;
  }

  if (relativePath.endsWith("/index")) {
    relativePath = relativePath.slice(0, -"/index".length);
  }

  return `${DOCS_BASE_URL}/${relativePath}`;
}

export function buildSourceBlobUrl(repoPath: string): string {
  return `${SOURCE_BASE_URL}/${repoPath}`;
}
