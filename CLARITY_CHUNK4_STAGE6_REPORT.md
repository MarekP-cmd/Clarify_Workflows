# Clarity Workflows — Chunk 4 Stage 6 report

Status: **Stage 6 complete; Chunk 4 remains unreleased.** The current product release remains v0.5.0. Stage 6 adds only bounded MCP transport around the completed local search and passage Core APIs. Desktop search UI, citation admission, workflow-context integration, embeddings, provider execution, sandboxing, hosted accounts, and packaging remain later work.

## Stage 6 boundary

Stage 6 exposes two private, read-only Streamable HTTP MCP tools:

- `search_clarity_workspace` translates explicit snake_case wire fields into the canonical Stage 1 plain-text query contract and executes the current revision-bound Stage 4 projection.
- `retrieve_search_passage` translates an explicit workspace/result/revision/content-hash request into the Stage 5 exact-chunk retrieval boundary.

The tools do not scan managed artifact paths, create a second search implementation, mutate the graph, admit citations, or alter workflow context. Unsupported and unextracted artifact bytes remain unavailable.

## Transport guarantees

- Tool inputs have bounded identifiers, query text, filters, page size, cursor, revision, digest, and passage-character limits.
- Search and passage outputs reuse the strict Stage 4/5 schemas and remain within the existing aggregate search-response budget.
- MCP human-readable content is metadata-only; the validated source passage exists once in `structuredContent` rather than being duplicated into an unbounded text channel.
- Search requires a ready projection at the authoritative workspace revision.
- Passage retrieval requires the exact result id, workspace revision, and indexed content hash; extracted artifacts are re-verified by managed-byte size and SHA-256 before return.
- Typed Core failures are surfaced as bounded MCP errors for stale/dirty/unbuilt projections, wrong hashes, removed sources, and integrity failures.
- Tool annotations mark both tools read-only, closed-world, and non-destructive.

## Acceptance evidence

| Gate | Result |
|---|---|
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage6` | Pass: 3/3 live MCP transport tests |
| `npm test` | Pass: 27 test files / 182 tests |
| `npm run verify` | Pass: full typecheck, build, browser, Chunk 2, Chunk 3, Chunk 4 Stages 1–6, launcher, and version gates |

The Stage 6 tests use temporary SQLite databases and test-only fixture records. No mock or seeded production data is added. The existing release remains v0.5.0; no archive or package was created.

## Explicitly deferred

Stage 6 does not add desktop search UI, MCP Apps search controls, citation admission into workflow context, source recommendation, embeddings, semantic ranking, provider calls, execution sandboxing, hosted authentication, or public distribution. The next authorized increment is Chunk 4 Stage 7, bounded citation admission, only after explicit authorization.
