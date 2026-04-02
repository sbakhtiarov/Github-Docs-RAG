# GitHub Docs RAG

Local-first TypeScript project that ingests the public `github/docs` repository into a section-based SQLite RAG index and exposes it through an MCP server.

## Features

- Section-based chunking for GitHub Docs Markdown under `/content`
- Stable chunk IDs shaped like `content/...#section-slug`
- Canonical docs links when they can be derived from the content path
- Exact quote support from stored raw chunk Markdown
- Hybrid retrieval with SQLite FTS5 plus `sqlite-vec`
- MCP over stdio for local agent integrations
- MCP over Streamable HTTP at `http://localhost:3000/mcp`

## Requirements

- Node.js 20+
- `OPENAI_API_KEY` for embeddings and query-time search
- `git` available on `PATH`
- Docker and Docker Compose for the containerized workflow

## Local quick start

```bash
npm install
npm run build
npm run ingest -- --pull
npm run query -- --q "How do I configure GitHub Actions secrets?"
npm run mcp
```

For the HTTP MCP server:

```bash
npm run mcp:http
```

## Docker workflow

Create a `.env` file or export the required variables:

```bash
OPENAI_API_KEY=your-key-here
OPENAI_EMBEDDING_MODEL=text-embedding-3-small
OPENAI_EMBEDDING_DIMENSION=1536
```

Build and ingest the docs index:

```bash
docker compose up rag-ingest
```

Start the HTTP MCP API:

```bash
docker compose up rag-mcp
```

The MCP endpoint will be available at `http://localhost:3000/mcp`.

To rebuild the index later without tying ingestion to API startup:

```bash
docker compose run --rm rag-ingest
```

Persistent data lives in the named `rag-cache` volume, which stores:

- The cloned `github/docs` repo
- The SQLite RAG database
- Any cached ingest artifacts under `/app/.cache/github-docs-rag`

## Environment variables

- `OPENAI_API_KEY`: required for embeddings
- `OPENAI_EMBEDDING_MODEL`: defaults to `text-embedding-3-small`
- `OPENAI_EMBEDDING_DIMENSION`: defaults to `1536`
- `GITHUB_DOCS_RAG_CACHE_DIR`: defaults to `.cache/github-docs-rag`
- `GITHUB_DOCS_RAG_DB_PATH`: defaults to `.cache/github-docs-rag/github-docs-rag.sqlite`
- `GITHUB_DOCS_RAG_SOURCE_DIR`: defaults to `.cache/github-docs-rag/github-docs`
- `GITHUB_DOCS_RAG_CONTENT_DIR`: optional override for ingesting a local content directory instead of cloning the upstream repo
- `MCP_HTTP_HOST`: defaults to `0.0.0.0`
- `MCP_HTTP_PORT`: defaults to `3000`
- `MCP_HTTP_PATH`: defaults to `/mcp`

## Commands

- `github-docs-rag ingest [--pull] [--rebuild]`
- `github-docs-rag query --q "<text>" [--top-k N] [--path-prefix content/actions/]`
- `github-docs-rag mcp`
- `github-docs-rag mcp-http`
