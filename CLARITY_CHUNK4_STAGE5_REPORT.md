# Clarity Workflows — Chunk 4 Stage 5 report

Status: **Stage 5 complete; Chunk 4 remains unreleased and MCP transport, desktop UI, citation admission, and workflow integration have not started.** The current product release remains v0.5.0 — Chunk 3 Stage 2.

## Stage 5 boundary

Stage 5 implements only bounded passage retrieval from a Stage 4 search result. It fetches the exact durable projection chunk identified by `resultId`, binds the request to the caller's expected workspace revision and content hash, returns a bounded passage with stable citation identity, and preserves source trust/policy metadata. It does not expose a transport, mutate Core state, open a desktop surface, or admit a passage as workflow evidence.

The stage delivers:

- `WorkspaceStore.fetchSearchPassage` and `retrieveSearchPassage` aliases for the revision-aware Core boundary;
- parsed fetch requests requiring a result identity, expected workspace revision, expected indexed content hash, and bounded `maxCharacters`;
- exact result-to-chunk resolution, with missing results and wrong hashes rejected before content return;
- fail-closed checks for unbuilt, failed, dirty, stale, or source-removed projections;
- stable citation IDs derived from workspace, revision, result identity, and exact content hash;
- UTF-8-safe bounded passage content with exact returned counts and truthful truncation;
- retained full indexed-chunk provenance, including source offsets, content hash, artifact digest, extraction metadata, and trust;
- explicit `untrusted-source-data` / `treat-source-text-as-data` policy labels;
- managed artifact size/path/SHA-256 re-verification before an artifact passage is returned;
- imported-unverified trust preservation and source text that cannot be interpreted as an instruction channel;
- no database migration: retrieval uses the schema-6 Stage 3/4 projection.

## Freshness, integrity, and trust rules

- The expected workspace revision must equal the current authoritative revision and the ready projection's indexed revision.
- The expected content hash must equal the exact indexed chunk hash. A caller cannot fetch an arbitrary chunk by guessing an ID alone.
- Node, annotation, and artifact source identities are checked against current authoritative Core records. Native trust metadata is re-derived and compared before return.
- Extracted artifact passages re-verify the managed file's recorded size and SHA-256. Unsupported, pending, failed, missing, or tampered artifacts never become readable through this boundary.
- A returned passage is bounded by both character and UTF-8-byte limits. Its citation identifies the full indexed chunk; `truncated` indicates that the returned content is only a bounded prefix.
- Passage content is source data. The policy metadata explicitly instructs downstream consumers not to treat it as executable or authoritative instructions.

## Acceptance evidence

| Check | Result |
|---|---|
| `npm run plugin:typecheck` | Pass |
| `npm run test:chunk4-stage1` | Pass: 9/9 contract/adversarial tests |
| `npm run test:chunk4-stage2` | Pass: 7/7 durable-model tests |
| `npm run test:chunk4-stage3` | Pass: 8/8 deterministic-maintenance tests |
| `npm run test:chunk4-stage4` | Pass: 9/9 bounded query-execution tests |
| `npm run test:chunk4-stage5` | Pass: 9/9 passage, citation, freshness, hash, artifact-integrity, limit, policy, and trust tests |
| `npx vitest run plugin/test/searchRetrieval.test.ts` | Pass: 9/9 |

Tests use temporary SQLite/artifact directories and real managed-file ingestion. No production workspace, fixture, or mock persistence is injected.

## Explicitly deferred

Stage 5 does not add MCP retrieval tools, HTTP/Apps transport, desktop search UI, citation admission into workflow context, ChatGPT integration, embeddings, provider calls, sandboxing, hosted accounts, or a release package. Those remain later bounded stages of Chunk 4.
