# Clarity Workflows — Chunk 4 Stage 3 report

Status: **Stage 3 complete; Chunk 4 remains unreleased and lexical search, retrieval, citation, UI, and workflow stages have not started.** The current product release remains v0.5.0 — Chunk 3 Stage 2.

## Stage 3 boundary

Stage 3 implements only deterministic maintenance of the disposable SQLite search projection. It derives canonical source documents and UTF-8-safe chunks from one authoritative `WorkspaceState` snapshot, verifies managed bytes for explicitly extracted artifacts, and atomically publishes the projection only for the snapshot's current workspace revision.

The stage delivers:

- `buildSearchIndexInput`, a pure deterministic builder over nodes, first-class annotations, and explicitly extracted managed artifacts;
- canonical node text that includes bounded human-visible metadata, exact annotation bodies, and extracted artifact text without treating source text as instructions;
- stable document and chunk IDs, deterministic source ordering, exact code-point and UTF-8-byte offsets, and line spans that handle trailing newlines without inventing an extra searchable line;
- bounded document/chunk capacity enforcement before SQLite replacement;
- `WorkspaceStore.rebuildSearchIndex`, which marks a build in progress, verifies every extracted artifact's managed path, size, and SHA-256, builds from the captured revision, and delegates to the revision-checked atomic replacement boundary;
- failed-build state with bounded error detail while retaining the prior projection for retry; revision conflicts leave the newer dirty state authoritative;
- restart parity and deterministic generation/content identity after graph edits and rebuilds;
- explicit exclusion of unsupported, pending, failed, or incomplete artifact extraction state.

Stage 3 adds no new database migration: it uses the schema-6 Stage 2 projection tables. It does not add ranking, lexical/semantic query execution, retrieval, MCP search/fetch tools, desktop search UI, citation admission, workflow-context integration, embeddings, provider calls, sandboxing, hosted accounts, or a release package.

## Integrity and trust rules

- The graph and artifact metadata remain authoritative. A search projection row is never evidence that bytes were extracted or verified.
- A rebuild captures one workspace revision. The final replacement rejects a newer revision before deleting old rows.
- Managed artifact bytes are checked against the persisted size and SHA-256 before extracted text is indexed. Tampering, missing files, and unreadable files fail closed.
- Only artifacts with `extractionStatus: "extracted"`, an extraction format, and persisted extracted text enter the projection. Unsupported or incomplete extraction is omitted or produces a typed failed rebuild; it is never represented as searchable content.
- Node, annotation, and artifact trust metadata is derived from the authoritative Core record and copied into every chunk provenance record. Imported-unverified content cannot be relabeled as approved or native authority.
- Failed builds preserve the previous documents/chunks and record a bounded error. A later operator retry can rebuild from the latest revision.

## Acceptance evidence

| Check | Result |
|---|---|
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage2` | Pass: 7/7 durable-model tests; trailing-newline line-span validation remains explicit |
| `npm run test:chunk4-stage3` | Pass: 8/8 deterministic builder, Unicode/UTF-8 offsets, dirty/rebuild/restart, tamper, incomplete extraction, typed conflict, and bounded-input tests |
| `npx vitest run plugin/test/searchIndex.test.ts plugin/test/searchMaintenance.test.ts` | Pass: 15/15 |

Tests use temporary SQLite/artifact directories and real managed-file ingestion. No production workspace, fixture, or mock persistence is injected.

## Explicitly deferred

Stage 3 does not add search query execution, ranking, passage fetch, pagination, retrieval MCP tools, desktop search UI, citation admission, workflow context integration, embeddings, provider calls, sandboxing, hosted accounts, or a release package. Those remain later bounded stages of Chunk 4.
