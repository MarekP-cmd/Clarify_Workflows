# Clarity Workflows — Chunk 4 Stage 7 report

Status: **Stage 7 complete; Chunk 4 remains unreleased.** The current product release remains v0.5.0. Stage 7 adds only bounded citation admission from verified search passages into ephemeral workflow contexts and staged-run metadata. Desktop citation UI, embeddings, provider execution, sandboxing, hosted accounts, and packaging remain later work.

## Stage 7 boundary

Stage 7 adds the private MCP tool `admit_search_citations` and the corresponding Core service boundary. A caller supplies only a prepared context id plus exact Stage 5 passage requests: result id, expected workspace revision, expected content hash, and a character bound. Clarity Core re-fetches every passage from the authoritative SQLite projection; caller-supplied passage bodies and provenance are never accepted.

Admitted passages are returned in the bounded prepared workflow context with their stable citation id, full chunk provenance, trust metadata, and explicit untrusted-source-data/instruction policy labels. When a candidate is staged, all admitted citation ids are recorded on the durable candidate unless the caller explicitly selects a subset. No source content is interpreted as instructions, and no graph mutation occurs during admission itself.

## Safety and bounds

- A prepared context admits at most 8 citations.
- Aggregate admitted passage content is capped at 100,000 Unicode characters and 400,000 UTF-8 bytes.
- Each passage remains governed by the Stage 5 100,000-character/400,000-byte bound.
- Every passage must match the prepared context's workspace id and exact revision.
- Search result ids and content hashes are revalidated by Core; wrong hashes, stale indexes, removed sources, and managed-artifact integrity failures fail closed.
- Context revision changes invalidate the prepared context before admission and leave no partial citation set.
- Stable citation ids are the only citation references persisted on staged runs; arbitrary caller ids and caller text are rejected.
- MCP structured output carries the bounded passages once; the human-readable MCP text channel is a metadata-only summary.

## Acceptance evidence

| Gate | Result |
|---|---|
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage7` | Pass: 3/3 live prepare→admit→stage, stale/hash, and boundary tests |
| `npm test` | Pass: 28 test files / 185 tests |
| `npm run verify` | Pass: full typecheck, renderer/plugin build, browser, Chunk 2, Chunk 3, Chunk 4 Stages 1–7, launcher, and version gates |

Tests use temporary SQLite databases and test-only fixture records. No production seed or mock production data was added. The existing release remains v0.5.0; no archive or package was created.

## Explicitly deferred

Stage 7 does not add desktop search or citation presentation, citation ranking, embeddings, semantic retrieval, provider calls, execution sandboxing, hosted authentication, workflow composition changes beyond citation references, or public distribution. The next increment must be explicitly authorized and scoped before implementation.
