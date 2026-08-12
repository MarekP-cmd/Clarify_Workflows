# Clarity Workflows v0.5.0 — Chunk 3 release report

Status: release gate passed; source package created and clean-extraction verification passed.  
Scope: **Chunk 3 — Real File and Dataset Ingestion, Stage 1 + Stage 2 only**.  
Source release: `Clarity-Workflows-v0.5.0-Chunk3-Source.zip` (created only after the gate below is green).

## Authority and boundary

The user explicitly divided Chunk 3 into two stages. The historical v0.3.0 report's old “next Chunk 2” file-ingestion paragraph is superseded by the durable handoff: Chunk 2 is the Complete Human Graph Workspace, and Chunk 3 is ingestion.

Stage 1 supplies the native chooser/drop path, managed artifact copy, explicit UTF-8 format policy, extraction state, provenance, bounded human previews, retry, and managed-byte integrity checks.

Stage 2 supplies only:

- metadata-only artifact projections for the general workspace, node inspection, and paginated artifact listing;
- a read-only `get_extracted_artifact_content` tool that returns a bounded UTF-8 prefix only when Core records `extractionStatus: "extracted"` and the managed bytes still match their recorded size and SHA-256;
- structured denial for pending, unsupported, failed, missing, or integrity-invalid artifacts;
- review-surface labels that distinguish extracted content from stored-but-unreadable bytes;
- restart and separate-process acceptance for extraction, MCP reads, retry, and tampered-byte withholding.

Stage 2 does not add embeddings, grounded search, retrieval ranking, workflow composition, provider execution, sandboxing, hosted accounts, or public distribution. No production fixture or mock workspace is introduced.

## Core and truthfulness invariants

- Electron and MCP continue to open the same normalized SQLite Core and managed artifact directory.
- General graph/workspace output never includes `extractedText`; artifact pages expose metadata and extraction state only.
- Unsupported, pending, and failed formats have no readable MCP content path. Error text does not echo managed bytes.
- A content read re-verifies the managed file size and SHA-256 before returning persisted extracted text. Replaced, truncated, or missing bytes produce `ARTIFACT_INTEGRITY_MISMATCH` and no content.
- Content is bounded to at most 100,000 Unicode characters and 400,000 UTF-8 bytes per call. Pagination returns at most 100 artifact summaries per page; the workspace projection retains at most 200 summaries and reports truncation/count metadata.
- Unicode prefixes are cut on code-point boundaries and report total/returned character and byte counts plus `truncated`.
- Stage 1's explicit extraction ceiling remains 16 MiB / 2,000,000 characters. Unsupported formats remain stored bytes with `extractionStatus: "unsupported"`; they are not classified as extracted.

## Acceptance evidence

| Check | Required proof | Result |
|---|---|---|
| `plugin/test/mcpContent.test.ts` | Body stripping, Unicode-safe prefix, character/byte ceilings, and unsupported/failed denial helper | Pass |
| `plugin/test/chunk3Stage2.e2e.test.ts` | Real SQLite ingestion, live MCP workspace/list/content calls, no body in general views, unsupported denial, restart hydration, retry, and tampered-byte MCP denial | Pass |
| `scripts/chunk3-stage1-browser-e2e.mjs` | Production renderer chooser/drop and inspector extraction/unsupported states against real SQLite | Pass in the Stage 1 gate |
| `scripts/chunk3-stage2-browser-e2e.mjs` | Production renderer states, separate MCP OS process, bounded content read, widget review labels, SQLite restart, retry, and integrity denial | Pass |
| `npm run test:chunk3-stage2` | Fresh renderer/plugin builds followed by the Stage 2 browser gate | Pass in the clean extraction |
| `npm run test:chunk2` | Unified Core regression, concurrent migration, shipped IPC contract, human workspace, restart parity | Pass in the clean extraction |
| `npm run verify` | Typechecks, root/plugin tests, builds, browser compatibility, package checks, Chunk 2 + both Chunk 3 stages, launcher, version gate | Pass in the clean extraction: 21 root files / 137 tests; all chained gates green |

| `npm run test:fire` | Renderer graph/file-drop fire coverage | Pass: 3/3 |
| `npm run test:mutation` | Stryker threshold and regression sensitivity | Pass: 78.01% total; 1,018 killed, 171 survived, 116 no-coverage, 0 errors/timeouts |
| `npm audit --omit=dev` | Desktop runtime dependency audit | Pass: 0 vulnerabilities |
| `npm audit --omit=dev --prefix plugin/runtime-package` | Private MCP runtime dependency audit | Pass: 0 vulnerabilities |
| Clean extraction inventory and production scans | No databases, managed runtime data, credentials, stale archives, or forbidden browser state in the archive/compiled output | Pass: 137 source files; no forbidden paths; no stale `0.3.0`, `localStorage`, `sessionStorage`, or cookie strings |

The headless container cannot launch a native Electron window because no usable X display/AF_UNIX path is available. The automated claim is therefore limited to the production renderer against real SQLite, the exact shipped main/preload contract under instrumentation, and the separate-process MCP/SQLite acceptance above. A display-capable host should perform a final native-window smoke before wider distribution.

## Release and clean-extraction procedure

The explicit source allowlist recorded in `CLARITY_PROJECT_HANDOFF.md` was packaged as `Clarity-Workflows-v0.5.0-Chunk3-Source.zip` with the sibling `.sha256` sidecar. A fresh extraction reran `npm ci`, `npm run verify`, `npm run test:fire`, `npm run plugin:test`, both production audits, and the forbidden-inventory/secret/data scans successfully. The archive contains no node_modules, SQLite/database files, artifact/runtime data, credentials, caches, test output, or stale source archives.

The sidecar is generated after the archive rather than embedded in it, so the digest is not self-referential.
