# Clarity Workflows — Chunk 4 Stage 2 report

Status: **Stage 2 complete; Chunk 4 remains unreleased and indexing, retrieval, UI, and workflow stages have not started.**  The current product release remains v0.5.0 — Chunk 3 Stage 2.

## Stage 2 boundary

Stage 2 implements only the durable, rebuildable SQLite model behind grounded search. It does not rank, search, retrieve, cite, expose MCP tools, or add a desktop search surface.

The stage delivers:

- schema migration 6 with one disposable `search_index_state` row per workspace;
- durable `search_documents` rows bound to a workspace revision, source kind/id, content digest, optional managed-artifact SHA-256, extraction metadata, source URI, and trust metadata;
- durable `search_chunks` rows with stable document/sequence IDs, bounded text, exact character/UTF-8-byte counts, character/byte/line offsets, source identity, artifact digest, workspace revision, and trust metadata;
- deterministic IDs derived from workspace/source identity and document/sequence identity;
- explicit index lifecycle state (`unbuilt`, `dirty`, `building`, `ready`, `failed`), generation, indexed revision, rebuild request time, last successful build time, bounded error detail, and row counts;
- atomic replacement through `WorkspaceStore.replaceSearchIndex`, with optimistic revision checks and source existence, extracted-artifact digest, and trust-authority checks;
- automatic dirty marking when authoritative graph, annotation, or artifact extraction state changes;
- restart hydration and corruption isolation: invalid derived rows fail closed as `SEARCH_INDEX_CORRUPT`, while authoritative graph reads remain available;
- strict limits of 75,000 documents, 200,000 chunks, and 16,000 characters / 64,000 UTF-8 bytes per chunk;
- a dedicated `npm run test:chunk4-stage2` gate included in `npm run verify`.

The projection is intentionally not part of `WorkspaceState`, public MCP output, or the ten-tool workflow surface. A later index-maintenance stage will derive it from Core records and managed extracted bytes; no search result is valid merely because a row exists.

## Integrity and trust rules

- A rebuild must name the exact current workspace revision. A stale rebuild is rejected before old rows are deleted.
- Node and annotation documents must preserve the Core-derived trust label; imported-unverified records cannot be laundered into approved-AI or native author labels.
- Artifact documents require `extractionStatus: "extracted"`, an extraction format, and the current managed-byte SHA-256. Unsupported, pending, failed, missing, or changed bytes cannot enter this searchable model.
- Chunk IDs and provenance are cross-checked against the document identity, workspace revision, trust, text digest, and exact offsets.
- Rebuild replacement occurs inside one immediate SQLite transaction. Validation or constraint failure leaves the prior projection intact.
- The index is derived state. Core graph mutations advance the authoritative workspace revision and mark a previously built projection dirty; they never rewrite history through index rows.

## Acceptance evidence

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage1` | Pass: 9/9 contract/adversarial tests |
| `npm run test:chunk4-stage2` | Pass: 7/7 migration, persistence, stale-rebuild, restart/corruption, trust, bound, and stable-ID tests |
| `npm test -- --reporter=dot` | Pass after Stage 2 source changes; existing workspace, ingestion, workflow, and Chunk 3 tests remain green |

Tests use temporary SQLite/artifact directories and real managed file ingestion; no production workspace, fixture, or mock persistence is injected.

## Explicitly deferred

Stage 2 does not add index maintenance/chunk generation from workspace records, lexical or semantic search, passage retrieval, citation admission, retrieval MCP tools, desktop search UI, ChatGPT workflow context integration, embeddings, provider calls, sandboxing, hosted accounts, or a release package. Those remain later bounded stages of Chunk 4.
