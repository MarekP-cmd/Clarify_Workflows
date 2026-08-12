# Clarity Workflows v0.6.0 — Chunk 4 release report

Status: **PRE-PACKAGE GATE PASSED — the exact v0.6.0 source tree passed the complete local source/rebuild suite, focused white-/black-/gray-box and element checks, Chromium compatibility, mutation threshold, dependency audits, version/output checks, and allowlist/secret/data audit. This authorizes a private candidate archive only; native Electron and real account-owned ChatGPT checks remain publication gates.**  
Scope: **Chunk 4 — Grounded Search, Retrieval and Provenance, bounded Stages 1–8.**  
Planned source release: `Clarity-Workflows-v0.6.0-Chunk4-Source.zip` with sibling SHA-256 and compiled-output hash manifests.

## Release decision

The v0.5.0 Chunk 3 archive remains the latest packaged release. The v0.6.0 source candidate combines the eight separately delivered Chunk 4 increments into one bounded scope:

1. search contract and threat model;
2. durable disposable search projection;
3. deterministic projection maintenance;
4. bounded plain-text query execution;
5. exact passage retrieval;
6. read-only MCP search/retrieval transport;
7. Core-refetched citation admission;
8. bounded citation presentation in the review component.

The historical stage reports accurately record the state at each stage and remain unchanged. The later release-closure direction defines Stages 1–8 as Chunk 4 and moves new product work to Chunk 5.

This report uses two non-circular milestones:

- **PRE-PACKAGE GATE PASSED** means the exact source tree has passed the complete local source/rebuild suite, focused white-/black-/gray-box and element checks, Chromium compatibility, mutation threshold, dependency audits, version checks, compiled-output checks, and allowlist/secret/data audit. It authorizes creation of a private release-candidate archive; it does not authorize publication.
- **RELEASE GATE PASSED** additionally requires the candidate archive to pass the untouched-inventory extraction and independent executable extraction, display-capable native Electron smoke, and real account-owned ChatGPT connection check. After recording that evidence, create a final archive containing the passed report and repeat both extraction gates against that exact final archive before publication.

## Delivered boundary

- Schema migration 6 stores only a disposable, rebuildable search projection. Authoritative workspace, annotation, artifact, workflow, and approval records remain in the unified SQLite Core.
- Search derives documents from current nodes, first-class annotations, and explicitly extracted artifacts. Unsupported or incomplete artifact extraction is not searchable content.
- A production search automatically activates or recovers an unbuilt, dirty, failed, or crash-interrupted projection, coalesces concurrent in-process rebuilds, and rechecks any requested workspace revision after the rebuild.
- Query input is bounded plain text, never SQL, FTS syntax, or an instruction channel. Results retain stable chunk identity, source offsets, content hash, trust, freshness, filters, bounded snippets, and cursor pagination.
- Exact passage retrieval requires result identity, the result's indexed workspace revision, and its exact content hash. A retained dirty projection may serve that exact passage only while the current authoritative source reconstructs the same chunk and trust; artifact-backed reads also re-check extraction metadata, managed-file size, SHA-256, and revision stability. Changed, removed, or tampered sources fail closed.
- The private MCP server exposes `search_clarity_workspace`, `retrieve_search_passage`, and `admit_search_citations` within a thirteen-tool surface.
- Citation admission re-fetches passages from Core, accepts no caller-supplied body or provenance, admits at most eight citations, and enforces aggregate character and UTF-8 byte budgets.
- Staging re-fetches every admitted citation before persisting its bounded presentation. Approval re-fetches every staged citation before commit; stale source text, trust, identity, or artifact bytes leave the run awaiting approval and prevent a result-node commit.
- The review widget treats normal MCP `isError` tool results as failures, clears its challenge-pending state, and can obtain a fresh challenge after the host sends a fresh workflow view.
- Staged candidates retain stable citation IDs and Core-generated bounded presentation snapshots. The review component renders previews with text-only DOM writes plus source, hash, offset, trust, policy, and truncation labels.

## Preserved trust and integrity rules

- Graph and artifact records are authoritative; projection rows are derived acceleration data, not evidence that bytes remain readable.
- Search returns results only from a ready projection current for the authoritative workspace revision. It may rebuild disposable state as part of the read path, but it never mutates authoritative graph content.
- An unbuilt, building, or failed projection cannot serve exact passage retrieval. Dirty status is not by itself authority or a denial: only an exact retained result whose indexed revision/hash, current canonical source, trust, and artifact integrity still match may be returned.
- Imported-unverified content remains visibly unverified through search, retrieval, admission, staging, and review.
- Source text is `untrusted-source-data` and must be treated as data rather than executable instructions.
- A citation preview is not a full passage, an instruction, an approval, or proof of a human gesture.
- Unsupported, pending, failed, missing, changed, or tampered artifact bytes cannot be represented as readable search or citation content.

## Compatibility boundary

The automated compatibility claim is intentionally narrow:

- The current post-fix `npm run test:browser` gate passed bundled Chromium 149 at desktop viewports 1280×720, 1440×900, and 1920×1080 and widget viewports 390×844, 760×900, and 1200×900.
- The committed Chromium fixture includes bounded citation rendering and a simulated MCP Apps host that returns one typed challenge error, sends a fresh view, then accepts an approval. It is not a real ChatGPT connection and does not exercise the production MCP server as the widget host.
- The loopback renderer flow uses the intentionally ephemeral browser adapter. Real persistence, restart, and managed-artifact integrity are covered by separate Core/renderer suites.
- Firefox and WebKit have not been run and are not claimed as tested or supported by this report.
- Electron 43.3.0 contains Chromium 150 and Node 24.18.1 in the audited environment, and its embedded runtime exposes `node:sqlite`.
- The shipped `electron/main.cjs` and `electron/preload.cjs` contract is tested under instrumented host APIs. That is not a native `BrowserWindow` launch.
- The headless container has no usable display/AF_UNIX path. A display-capable host must complete native Electron smoke before release.

The declared minimum Node.js 22.13.0 passed earlier compatibility, IPC-contract, and thirteen-tool MCP checks. The final pre-package run used Node.js 24.14.0, npm 11.9.0, Linux 6.18.35 x86_64, bundled Chromium 149.0.7827.0 (`@sparticuz/chromium` 149.0.0), and Electron 43.3.0.

## Test boundaries and current gate state

No single test is treated as end-to-end proof of restart, integrity, browser app transport, and native Electron behavior.

| Evidence | What it covers | What it does not cover | Current status |
|---|---|---|---|
| Focused white-box/concurrency selection | `searchExecution`, `searchRetrieval`, `chunk4ReleaseGrayBox`, `workflowService`, `workflowService.paths`, `schema.paths`, and `searchCitationIntegrity.whitebox`: schema/path invariants, exact-passage semantics, disposable-index and workflow races, citation integrity | Live browser, native Electron | **Pass: 7 files / 65 tests** |
| `plugin/test/chunk4ReleaseBlackBox.e2e.test.ts` | Real managed Markdown ingestion, Store close/reopen, automatic first-search indexing, live MCP search/retrieve/admit/stage/render, then service-level challenge and approval | Separate OS-process restart, tamper denial, widget/MCP Apps transport, native Electron | **Pass: 1/1** |
| `plugin/test/chunk4ReleaseGrayBox.test.ts` | Managed-byte tamper races before/within staging and approval, source-gate denial, one-shot context race, and sibling-run closure | Live MCP/browser/native Electron | **Pass: 3/3** |
| Chunk 4 Stage 4–8 focused gates | Query 12/12; retrieval 11/11; MCP transport 3/3; citation admission 3/3; citation presentation/widget 3/3 | These are separate layer gates, not one native/app E2E claim | **Pass: 32/32** |
| `scripts/browser-compat.mjs` | Production renderer and raw review widget in Chromium, responsive overflow, text-only citation display, simulated typed MCP error recovery and approval | Firefox, WebKit, native Electron, real ChatGPT/app transport, real SQLite persistence | **Pass: Chromium 149; final status committed; one citation card** |
| Chunk 2/3 Core/browser suites and `searchMaintenance.test.ts` | Real SQLite durability, explicit separate-process paths where named, restart recovery, and managed-artifact integrity paths | They are separate evidence, not part of the Chunk 4 black-box chain | **Pass in final aggregate run** |
| Element integration: widget security + browser + `scripts/chunk2-electron-ipc-contract.mjs` | Widget source/security 1/1, Chromium component flow, exact shipped main/preload API with schema 6 and 13 IPC channels | Native `BrowserWindow`, Firefox/WebKit, real ChatGPT | **Pass** |

## Final current-tree pre-package evidence

All entries below were rerun after the final search-recovery, revision-binding, artifact-integrity, context-consumption, sibling-closure, schema, and widget fixes settled. `npm run verify` passed the root suite at 32 files / 205 tests and every included Chunk 2–4, browser, package, launcher, version, and release-family gate. Independent plugin and fire aggregates, black-box diagnostics, mutation, dependency audits, output verification, and allowlist scans also passed.

| Gate | Current-tree status |
|---|---|
| Root and plugin TypeScript checks | **Pass** |
| Focused white-box/concurrency selection | **Pass: 7 files / 65 tests** |
| Black-box / gray-box release suites | **Pass: 1/1 and 3/3** |
| Stage 4 / 5 / 6 / 7 / 8 focused suites | **Pass: 12/12, 11/11, 3/3, 3/3, 3/3** |
| Full `npm run verify` | **Pass: root 32 files / 205 tests; all included Chunk 2–4, browser, package, launcher, version, white-/black-/gray-box gates passed** |
| `npm run test:fire` and `npm run plugin:test` | **Pass: 1 file / 3 tests and 25 files / 145 tests** |
| Black-box diagnostics | **Pass: typed failure accounting and chunked HTTP 413 denial** |
| Chromium compatibility/element flow | **Pass: Chromium 149; widget security 1/1; typed error recovery; IPC schema 6 / 13 channels** |
| v0.6.0 version consistency | **Pass on current documentation/runtime surfaces** |
| Current prebuilt renderer/package verification | **Pass: renderer + 6 local assets; plugin structural package check** |
| Exact virtual allowlist audit | **Pass: 173 files, 43 compiled outputs, 0 missing, 0 symlinks, 0 forbidden/unexpected** |
| Root and runtime-package production audits | **Pass: 0 vulnerabilities in both production dependency trees** |
| Mutation threshold | **Pass: 2,353 instrumented; 1,362 killed, 411 survived, 236 no coverage; 67.79% overall / 76.82% covered versus 60% floor; 0 timeouts/errors** |
| Firefox/WebKit | Not run; no claim |
| Native Electron window | Not run; display-capable host required |
| Real account-owned ChatGPT connection | Not run for this candidate |
| Private source candidate and two clean extractions | Not yet created; creation is now authorized by this passed pre-package gate |

## Pre-package verification gate

Run on the exact source tree after all release fixes settle:

```bash
npm ci
npm run verify:dist
node plugin/scripts/verify-package.mjs
npm run version:test
node plugin/scripts/smoke.mjs
npm run verify
npm run test:fire
npm run plugin:test
npm run test:mutation
npm audit --omit=dev
npm audit --omit=dev --prefix plugin/runtime-package
```

Also complete the exact allowlist, forbidden-file, symlink, secret/data, stale-version, and compiled-output audits defined in `CLARITY_PROJECT_HANDOFF.md`. Record exact test counts, mutation score, audits, runtime matrix, Chromium result, inventory count, and compiled-output hashes before changing this status to **PRE-PACKAGE GATE PASSED**.

## Packaging and release gate

Only a **PRE-PACKAGE GATE PASSED** tree may be staged as a private archive candidate. The explicit allowlist in `CLARITY_PROJECT_HANDOFF.md` includes current and historical documentation, source/configuration, assets, Electron files, scripts, skills, tests, the raw widget, runtime lock package, and fresh `dist/` plus `plugin/dist/` output. It excludes dependencies, credentials, mappings, databases, artifacts, logs, caches, mutation/coverage output, build metadata, incoming archives, and user content.

Use two independent extractions of the same candidate ZIP:

1. Keep the first extraction untouched. Verify the one-top-level-directory rule, safe ZIP entry names, exact allowlist, absence of symlinks and forbidden files, secret/data scans, and the pre-recorded hashes of every packaged file in `dist/` and `plugin/dist/`.
2. Use the second extraction for `npm ci` and all executable gates. Verify packaged outputs before `npm run verify` rebuilds them, then run the complete source/rebuild suite.

Complete native Electron and real account-owned ChatGPT checks against the candidate. If all release gates pass, record exact evidence and change this report to **RELEASE GATE PASSED**, build a final archive containing that report, and repeat both extraction gates against that exact final ZIP. Generate the final SHA-256 sidecar only after the final ZIP exists. Publish nothing while this report says pending or pre-package only.

## Explicitly deferred

Chunk 4 does not add a desktop search control, embeddings, semantic ranking, external model/provider calls, a visual workflow composer, dataset/code execution, sandboxing, hosted tenant accounts, OAuth, signed installers, auto-update, or public marketplace distribution. Those capabilities require later authorized chunks and their own acceptance boundaries.
