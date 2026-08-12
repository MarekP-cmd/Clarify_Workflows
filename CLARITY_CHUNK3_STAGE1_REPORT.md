# Clarity Workflows — Chunk 3 Stage 1 report

Date: 2026-08-11  
Chunk: 3 — Real File and Dataset Ingestion  
Stage: 1 — Ingestion foundation  
Status: **Implemented in the current development tree; Stage 2 and a Chunk 3 release are pending**

## Authority and split

The historical v0.3.0 Chunk 1 report called file ingestion the next Chunk 2. The authoritative roadmap correction assigns Complete Human Graph Workspace to Chunk 2 and Real File and Dataset Ingestion to Chunk 3. The user explicitly divided Chunk 3 into two stages:

1. **Stage 1 — ingestion foundation:** supported-format policy, native chooser/drop, managed byte-preserving copy, persisted extraction/content state, provenance, human UI, retry/error handling, and Core/renderer acceptance.
2. **Stage 2 — bounded read surface and release closure:** bounded MCP access to extracted content, cross-process/restart read-truthfulness, broader format acceptance where explicitly specified, and final packaging.

This report covers Stage 1 only. It does not claim Chunk 3 completion, grounded retrieval, embeddings, workflow composition, provider execution, sandboxing, hosted accounts, or public distribution.

## Delivered Stage 1 behavior

- Supported extraction formats are explicit: plain text, Markdown, CSV/TSV, JSON, JSON Lines, and source code.
- Electron exposes a native file chooser constrained to the supported extension set and a managed ingestion/retry bridge.
- Graph drop resolves the real local file through Electron's file utility boundary; the renderer never persists a browser `File` object or guessed bytes.
- Core copies source bytes into managed artifact storage with bounded source metadata, streaming byte count, SHA-256, temporary destination, final-size verification, and containment checks.
- A single Core transaction creates the human source node and artifact metadata. The node records `clarity://artifact/<id>` provenance and the artifact records the original name, MIME type, byte size, digest, and managed storage key.
- UTF-8 extraction is bounded to 16 MiB of source bytes and 2,000,000 extracted characters. Structured JSON and JSON Lines are parsed before they are marked extracted.
- Unsupported formats remain byte-stored with `extractionStatus: unsupported`, no extracted text, and an explicit UI message. Malformed or over-limit supported content is `failed` with a retryable error; it is never represented as readable content.
- The inspector shows file size, extraction state, errors, and a bounded preview. Retry re-reads managed bytes only after digest verification and updates durable activity/state.
- Migration 5 persists extraction status and extracted-content metadata in the unified SQLite Core. Electron and MCP continue to share the same Store/database boundary.

## Acceptance evidence

| Check | Stage 1 expectation |
|---|---|
| `plugin/test/ingestion.test.ts` | Explicit format detection, JSON/JSONL validation, extraction byte/character limits, real managed Markdown copy, digest/provenance, unsupported PDF bytes, retry, and restart hydration |
| `scripts/chunk3-stage1-browser-e2e.mjs` | Production renderer against real SQLite Store: chooser ingestion, extracted Markdown preview, unsupported PDF state without extracted text, managed-byte equality, and actual graph-drop ingestion |
| `npm run typecheck` / `npm run plugin:typecheck` | Renderer and Core contracts include extraction fields and the new bridge |
| `scripts/chunk2-electron-ipc-contract.mjs` | Shipped main/preload allowlist includes the chooser, ingest, and retry channels; schema version is 5 |
| `scripts/chunk2-concurrent-init-e2e.mjs` | Two real OS processes initialize a fresh schema-5 Core and apply migrations 1–5 safely |

The browser acceptance uses a production renderer build and a real temporary SQLite Store through an injected equivalent of the shipped bridge. It is not a mock production graph and does not claim native Electron-window automation in the display-less release container.

## Explicit non-goals for Stage 1

MCP extracted-content retrieval, embeddings, grounded search, workflow composition, provider execution, sandboxing, hosted/public operation, and final Chunk 3 packaging remain Stage 2 or later work. In particular, an unsupported or failed artifact is not exposed as if its bytes had been read.

## Next gate

Stage 2 must add the bounded MCP read surface and prove read-truthfulness across desktop, MCP, review, restart, and retry/integrity paths before a separately versioned Chunk 3 report or source archive can claim completion.

## Stage 1 verification result

The current development tree's full regression gate passed after the Stage 1 changes:

- `npm run verify` — pass; 19 root test files and 132 tests, production build/dist checks, browser compatibility, plugin smoke/E2E/package checks, Chunk 2 acceptance, Stage 1 browser acceptance, launcher, and version consistency.
- `npm run test:chunk3-stage1` — pass; schema 5, real SQLite, 3 durable nodes and 3 artifacts (2 extracted, 1 explicitly unsupported).
- `npm run test:fire` — pass; 3/3.
- `npm run plugin:test` — pass; 12 files and 72 tests.
- Production audits — pass; 0 known vulnerabilities in the root and private runtime package.

The full gate is evidence that Stage 1 did not regress the unified Core or the packaged Chunk 2 contract. It is not evidence that Stage 2 or the full Chunk 3 contract is complete.
