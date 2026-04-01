# GitHub Docs RAG

Local-first TypeScript project that ingests the public `github/docs` repository into a section-based SQLite RAG index and exposes it through an MCP server.

## Features

- Section-based chunking for GitHub Docs Markdown under `/content`
- Stable chunk IDs shaped like `content/...#section-slug`
- Canonical docs links when they can be derived from the content path
- Exact quote support from stored raw chunk Markdown
- Hybrid retrieval with SQLite FTS5 plus `sqlite-vec`
- MCP tools and resources for AI agents

## Requirements

- Node.js 20+
- `OPENAI_API_KEY` for embeddings and query-time search
- `git` available on `PATH`

## Quick start

```bash
npm install
npm run build
npm run ingest -- --pull
npm run query -- --q "How do I configure GitHub Actions secrets?"
npm run mcp
```

## Environment variables

- `OPENAI_API_KEY`: required for embeddings
- `OPENAI_EMBEDDING_MODEL`: defaults to `text-embedding-3-small`
- `GITHUB_DOCS_RAG_CACHE_DIR`: defaults to `.cache/github-docs-rag`
- `GITHUB_DOCS_RAG_DB_PATH`: defaults to `.cache/github-docs-rag/github-docs-rag.sqlite`
- `GITHUB_DOCS_RAG_SOURCE_DIR`: defaults to `.cache/github-docs-rag/github-docs`
- `GITHUB_DOCS_RAG_CONTENT_DIR`: optional override for ingesting a local content directory instead of cloning the upstream repo

## Commands

- `github-docs-rag ingest [--pull] [--rebuild]`
- `github-docs-rag query --q "<text>" [--top-k N] [--path-prefix content/actions/]`
- `github-docs-rag mcp`
