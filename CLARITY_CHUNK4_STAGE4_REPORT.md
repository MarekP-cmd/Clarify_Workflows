# Clarity Workflows — Chunk 4 Stage 4 report

Status: **Stage 4 complete; Chunk 4 remains unreleased and passage retrieval, citation admission, transport, UI, and workflow stages have not started.** The current product release remains v0.5.0 — Chunk 3 Stage 2.

## Stage 4 boundary

Stage 4 implements only bounded local plain-text query execution over the Stage 3 durable projection. It does not read managed artifact bytes, mutate Core state, expose an MCP tool, add a desktop search surface, or admit search output as workflow evidence.

The stage delivers:

- `WorkspaceStore.search` and `searchWorkspace`, a read-only Core boundary that requires a ready projection indexed at the current authoritative workspace revision;
- plain-text query normalization with bounded Unicode/control-character handling and no SQL or FTS query interpretation;
- deterministic term matching and scoring over durable chunks, with source-kind ordering as the tie-breaker;
- scope, source-kind, node, project, artifact, and trust filters resolved against authoritative graph membership rather than duplicated projection metadata;
- stable chunk result identities, authoritative chunk provenance, trust metadata, and page-local ranks;
- bounded snippets and UTF-8-safe, snippet-relative match ranges capped at 32 ranges;
- cursor pagination with a truthful total count and bounded result pages;
- aggregate response-size validation through the Stage 1 search contract;
- fail-closed `SEARCH_INDEX_NOT_READY`, `SEARCH_INDEX_STALE`, and revision-conflict behavior;
- injection-safe behavior: query text remains ordinary source-search input and is never interpolated into SQL, SQLite FTS, or instructions;
- imported-unverified trust preservation in search results.

Stage 4 adds no database migration. It uses the schema-6 derived projection and Stage 3 maintenance boundary. It does not add passage retrieval, source-content fetching, MCP search/fetch tools, desktop search UI, citation admission, workflow-context integration, embeddings, provider calls, sandboxing, hosted accounts, or a release package.

## Freshness and trust rules

- Search is allowed only when `search_index_state.status` is `ready` and `indexedRevision === workspace.revision`.
- A caller-supplied `expectedWorkspaceRevision` is checked before query execution; stale callers receive a structured conflict rather than an older result page.
- Every result carries the exact chunk provenance and authoritative trust metadata persisted by Stage 3. The query path does not infer approval from text.
- A source filter for nodes also resolves linked annotations/artifacts through the authoritative node relationship. Project filters are similarly resolved from live graph membership.
- Search never opens managed artifact paths. Artifact readability remains a later bounded passage/retrieval stage and continues to require explicit extraction and integrity checks.
- Source text is treated as untrusted data. It is returned only as bounded snippets and is not executed or interpreted as instructions.

## Acceptance evidence

| Check | Result |
|---|---|
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage1` | Pass: 9/9 contract/adversarial tests |
| `npm run test:chunk4-stage2` | Pass: 7/7 durable-model tests |
| `npm run test:chunk4-stage3` | Pass: 8/8 deterministic-maintenance tests |
| `npm run test:chunk4-stage4` | Pass: 9/9 query, filter, pagination, snippet, freshness, injection, and trust tests |
| `npx vitest run plugin/test/searchContract.test.ts plugin/test/searchExecution.test.ts` | Pass: 18/18 |

Tests use temporary SQLite/artifact directories and real managed-file ingestion. No production workspace, fixture, or mock persistence is injected.

## Explicitly deferred

Stage 4 does not add passage fetch, citation IDs for workflow admission, retrieval MCP tools, desktop search UI, ChatGPT context integration, lexical/semantic ranking beyond the bounded deterministic score, embeddings, provider calls, sandboxing, hosted accounts, or a release package. Those remain later bounded stages of Chunk 4.
