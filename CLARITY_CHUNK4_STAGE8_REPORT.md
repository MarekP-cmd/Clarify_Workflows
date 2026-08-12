# Clarity Workflows — Chunk 4 Stage 8 report

Status: **Stage 8 complete; Chunk 4 remains unreleased.** The current product release remains v0.5.0. Stage 8 adds bounded citation presentation to the private workflow review surface. It does not add a desktop search control, embeddings, provider execution, sandboxing, hosted accounts, or a package.

## Stage 8 boundary

Stage 8 turns the exact citations admitted in Stage 7 into a small, durable review projection. When a candidate is staged, Clarity Core reconstructs each selected citation presentation from the already Core-refetched `SearchPassage`; it does not accept caller-supplied preview text, title, provenance, trust, or policy. The persisted presentation contains:

- the stable citation id and source title;
- a UTF-8-safe preview capped at 2,000 Unicode characters and 8,000 bytes;
- original passage counts and an explicit truncation flag;
- workspace revision, content hash, source identity, chunk id, and character/byte offsets;
- trust metadata and the `untrusted-source-data` / `treat-source-text-as-data` policies.

The review view exposes at most eight such presentations with `citationCount` and `citationsTruncated` metadata. The widget renders the preview using `textContent`, labels unverified/truncated material, and never treats a citation as an instruction or approval proof. Exact full-passage access remains governed by the Stage 5 revision/hash-bound retrieval contract.

## Acceptance evidence

| Gate | Result |
|---|---|
| `npm run typecheck` | Pass |
| `npm run plugin:typecheck` | Pass |
| `npm run build` | Pass; renderer bundle is warning-free |
| `npm run test:chunk4-stage8` | Pass: 3/3 live presentation and widget-security tests |
| `npm test -- --reporter=dot` | Pass: 29 test files / 187 tests |

The Stage 8 live test uses a temporary SQLite database, rebuilds the real search projection, exercises the Streamable HTTP MCP path, stages a candidate, and renders the authoritative workflow view. It proves exact Core-generated title/hash/offset/trust/policy metadata, UTF-8 preview counts, truncation, durable run equality, a sub-50,000-byte rendered view, and rejection of caller-forged presentation metadata. The widget test checks the MCP Apps bridge, text-only citation rendering, unverified labels, and the absence of browser persistence or remote network fetches.

No production seed or mock production data was added. Fixture records are created only in temporary test databases and are removed during teardown. The v0.5.0 release remains unchanged and no archive was created.

## Explicitly deferred

Stage 8 does not add desktop search controls, citation ranking, semantic/embedding retrieval, provider calls, execution sandboxing, hosted authentication, workflow composition, native-window automation, or public distribution. The next increment requires explicit authorization as Chunk 4 Stage 9.
