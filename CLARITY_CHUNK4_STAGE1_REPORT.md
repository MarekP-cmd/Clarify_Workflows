# Clarity Workflows — Chunk 4 Stage 1 report

Status: **Stage 1 complete; Chunk 4 remains unreleased and later stages have not started.**  
Current product release remains v0.5.0 — Chunk 3 Stage 2. No release version, database schema, MCP tool surface, or source package was changed by this stage.

## Stage 1 boundary

Chunk 4 is **Grounded Search, Retrieval and Provenance**. Stage 1 freezes the contract and threat model that later indexing, retrieval, desktop, and workflow-integration stages must implement.

This stage delivers:

- plain-text query normalization with Unicode-safe character limits;
- explicit source kinds (`node`, `annotation`, `artifact`) and search scopes;
- bounded result, snippet, passage, filter, and aggregate response budgets;
- immutable provenance fields for workspace revision, source identity, content hash, artifact SHA-256, extraction state, and character/byte/line offsets;
- trust labels that preserve human, approved-AI, native-AI, native-system, and imported-unverified distinctions;
- stale-result classification for workspace changes, source changes, source removal, and index rebuilds;
- UTF-8-safe text bounding and deterministic SHA-256 hashing helpers;
- an explicit policy that retrieved text is untrusted source data and never an instruction channel;
- contract and adversarial tests in `plugin/test/searchContract.test.ts`;
- the explicit `npm run test:chunk4-stage1` gate, included in `npm run verify`.

## Frozen contract values

| Boundary | Value |
|---|---:|
| Contract version | 1 |
| Query | 512 Unicode characters |
| Result page | 50 results |
| Filter IDs | 50 per filter |
| Search snippet | 2,000 Unicode characters / 8,000 UTF-8 bytes |
| Retrieved passage | 100,000 Unicode characters / 400,000 UTF-8 bytes |
| Match ranges | 32 per result |
| Search response target | 256,000 bytes |

These are contract ceilings, not renderer-only hints. Future adapters must enforce them before constructing FTS, lexical, or semantic queries.

## Threat-model decisions

- Search input is plain text. Stage 1 does not expose FTS operators, SQL, regular-expression syntax, or provider-specific query languages.
- Search text is normalized for Unicode form and layout whitespace only; source text is never silently rewritten to remove claims or instructions.
- Retrieved source text carries `contentPolicy: "untrusted-source-data"` and `instructionPolicy: "treat-source-text-as-data"`.
- Imported-unverified material remains visibly unverified and cannot become trusted merely by entering the search index.
- Artifact provenance is searchable only when extraction status is explicitly `extracted` and the managed-byte SHA-256 is present.
- Every later fetch must compare the recorded workspace revision and content hash before returning a passage.
- The search index will be derived/rebuildable state; SQLite Core remains authoritative.

## Acceptance evidence

| Check | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage1` | Pass: 9/9 contract/adversarial tests |
| Full `npm test -- --reporter=dot` after Stage 1 | Pass: 22 files / 146 tests |
| Full `npm run verify` | Pass; existing Chunk 2/3 gates remain green and version remains 0.5.0 |

## Explicitly deferred

Stage 1 does not add a search index, FTS/semantic ranking, retrieval MCP tools, desktop search UI, citation admission into `prepare_workflow_context`, embeddings, provider calls, workflow composition, sandboxing, hosted accounts, or public distribution. Those require later Chunk 4 stages and their own end-to-end acceptance.
