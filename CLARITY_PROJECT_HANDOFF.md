# Clarity Workflows — durable project handoff

Current release: v0.6.0 — Chunk 4 Grounded Search, Retrieval and Provenance (Stages 1–8) source candidate, **PRE-PACKAGE GATE PASSED**  
Latest packaged source release: v0.5.0 — Chunk 3 Stage 2  
Handoff date: 2026-08-12  
Current release evidence: `CLARITY_V0.6.0_CHUNK4_REPORT.md`
Previous packaged-release evidence: `CLARITY_V0.5.0_CHUNK3_REPORT.md`
Latest stage evidence: `CLARITY_CHUNK4_STAGE8_REPORT.md`
Previous increments: `CLARITY_CHUNK4_STAGE7_REPORT.md`, `CLARITY_CHUNK4_STAGE6_REPORT.md`, `CLARITY_CHUNK4_STAGE5_REPORT.md`, `CLARITY_CHUNK4_STAGE4_REPORT.md`, `CLARITY_CHUNK4_STAGE3_REPORT.md`, `CLARITY_CHUNK4_STAGE2_REPORT.md`, `CLARITY_CHUNK4_STAGE1_REPORT.md`
Historical reports: `CLARITY_V0.4.0_CHUNK2_REPORT.md`, `CLARITY_CHUNK3_STAGE1_REPORT.md`

## Release decision

Chunk 4 Stages 1–8 form the bounded v0.6.0 release: search contract, durable projection, deterministic maintenance, plain-text query execution, exact passage retrieval, MCP transport, citation admission, and citation presentation. New end-to-end product work begins in Chunk 5; the exact automated evidence and compatibility limitations are recorded in `CLARITY_V0.6.0_CHUNK4_REPORT.md`.

Release closure uses two explicit states. **PRE-PACKAGE GATE PASSED** authorizes a private candidate ZIP only after the exact tree passes the complete local regression, mutation, audit, version, output, and allowlist gates. **RELEASE GATE PASSED** additionally requires both candidate extractions, native Electron on a display-capable host, and a real account-owned ChatGPT connection check. The final ZIP must contain the passed report and must itself repeat both extraction gates; publication is never authorized merely by creating an archive.

The Stage 1–8 reports remain historical incremental evidence. Their statements that Chunk 4 was unreleased and that a later Stage 9 required authorization were correct when written. The user's later release-closure direction defines Stages 1–8 as the bounded Chunk 4 package scope and moves subsequent product work to Chunk 5; the historical reports are not rewritten.

The work began from the attached `Clarity-Workflows-v0.3.0-Chunk1-Source.zip`, whose SHA-256 was independently recorded as:

```text
31bb38b4b4757b772b930464fb7d461bafcab699cdc375e35ca53dcf0a47ce4f
```

## Scope correction and authority

The user's authoritative eleven-chunk contract assigns **Complete Human Graph Workspace** to Chunk 2. The final paragraph of the historical v0.3.0 Chunk 1 report instead called file ingestion the next Chunk 2. That paragraph is incorrect and superseded; the report itself remains unchanged as a historical artifact.

**Real File and Dataset Ingestion is Chunk 3.** It was not implemented or claimed in v0.4.0. v0.5.0 completes the two authorized stages: managed ingestion/extraction plus a bounded MCP read surface. No surface may imply that Clarity extracted or read file bytes that were not explicitly ingested and parsed.

## Chunk 3 two-stage authorization

The user explicitly divided Chunk 3 into two bounded stages. This split supersedes the historical Chunk 1 report's old “next Chunk 2” label without changing the eleven-chunk roadmap.

### Stage 1 — ingestion foundation (implemented in this working tree)

- Define an explicit supported-format policy for plain text, Markdown, CSV/TSV, JSON, JSON Lines, and source code.
- Wire the native desktop chooser and graph file-drop path to the real Electron bridge.
- Copy selected bytes into managed artifact storage with byte-count, digest, size, and path-integrity checks; never use a renderer-side file path as persisted content.
- Persist artifact/content state and provenance in the unified SQLite Core.
- Extract only explicitly supported UTF-8 content within the bounded 16 MiB / 2,000,000-character Stage 1 limits. Unsupported formats remain byte-stored and explicitly unextracted; malformed or over-limit supported content is failed with a retryable state.
- Display source-file metadata, extraction status, error detail, and bounded previews in the human inspector. Provide retry and visible chooser/drop errors.
- Verify Core persistence, restart parity, managed-byte equality, unsupported-byte truthfulness, and production-renderer chooser/drop behavior against real SQLite.

Stage 1 intentionally does not add MCP extracted-content retrieval, embeddings, grounded search, workflow composition, provider execution, sandboxing, hosted accounts, or public distribution.

### Stage 2 — bounded read surface and release closure (implemented in v0.5.0)

- Expose only bounded, explicitly extracted content to MCP with size/count limits and relationally valid output.
- Prove that unextracted/unsupported bytes cannot be represented as readable content in desktop, MCP, or review surfaces.
- Add cross-process/restart parity for artifact extraction and bounded MCP access, including retry and integrity-failure paths.
- Complete broader dataset/file-format acceptance only where the format contract is explicit, then update the durable handoff/report and package a separately versioned Chunk 3 release.

Stage 2 is complete. It does not add embeddings, grounded search, workflow composition, provider execution, sandboxing, hosted accounts, or public distribution.

## Authoritative roadmap

| Chunk | Name | Current state |
|---:|---|---|
| 1 | Unified Clarity Core | Delivered in v0.3.0; preserved and hardened |
| 2 | Complete Human Graph Workspace | Implemented in v0.4.0; final acceptance controls completion |
| 3 | Real File and Dataset Ingestion | Delivered in v0.5.0 through the two authorized stages |
| 4 | Grounded Search, Retrieval and Provenance | Stages 1–8 implemented; exact v0.6.0 tree passed all local pre-package gates. Private candidate packaging/extractions are next; native host and real connection remain publication gates |
| 5 | Visual Workflow Composer | Not implemented |
| 6 | Two Gates + Pure Agent | Full product chunk not implemented; fixed private workflow remains |
| 7 | Real AI Execution | Not implemented |
| 8 | Dataset and Code Execution Sandbox | Not implemented |
| 9 | Full Clarity Inside ChatGPT | Not implemented; current ChatGPT surface is bounded read/stage/review |
| 10 | Hosted Public System and OAuth | Not implemented |
| 11 | Production Hardening and Public Release | Not implemented |

### Chunk 4 Stage 1 status

Stage 1 is complete as the contract/threat-model increment. `plugin/src/searchContract.ts` and `plugin/test/searchContract.test.ts` freeze the bounded plain-text query, result, passage, provenance, trust, freshness, UTF-8, and untrusted-source-data rules used by later stages. The explicit `npm run test:chunk4-stage1` gate is included in `npm run verify`.

At Stage 1 acceptance, the search index, retrieval, citation admission, and workflow integration were not yet implemented; Stages 2–8 provide those later bounded layers. Chunk 4 still does not add a desktop search control.

### Chunk 4 Stage 2 status

Stage 2 is complete as the durable-Core increment. Schema migration 6 adds the disposable `search_index_state`, `search_documents`, and `search_chunks` tables. `WorkspaceStore.replaceSearchIndex` atomically replaces a revision-bound projection only after strict document/chunk, source-existence, extraction-digest, trust, identity, and offset validation. Authoritative graph/annotation/artifact changes mark a built projection dirty; stale rebuilds cannot delete a newer projection. Restart hydration, failed replacement retention, and derived-row corruption isolation are covered by `plugin/test/searchIndex.test.ts` and the `npm run test:chunk4-stage2` gate.

Stage 2 by itself does not add index maintenance, query/retrieval, MCP tools, citation admission, or workflow integration; later Chunk 4 stages provide those bounded layers. Semantic ranking and desktop search UI remain deferred.

### Chunk 4 Stage 3 status

Stage 3 is complete as the deterministic-maintenance increment. `buildSearchIndexInput` derives canonical node, first-class annotation, and explicitly extracted-artifact documents from one authoritative `WorkspaceState`; `chunkSearchText` produces stable UTF-8-safe chunks with exact character, byte, and line spans. `WorkspaceStore.rebuildSearchIndex` verifies managed artifact size and SHA-256, records a bounded building/failed lifecycle, and revision-checks the atomic replacement so a failed or stale build retains the previous projection. Unsupported or incomplete extraction is excluded or fails closed. Restart, graph-edit dirty marking, deterministic generation, trailing-newline offsets, tamper retention, and incomplete-extraction paths are covered by `plugin/test/searchMaintenance.test.ts` and the `npm run test:chunk4-stage3` gate.

Stage 3 by itself does not add query/retrieval, MCP tools, citation admission, or workflow integration; later Chunk 4 stages provide those bounded layers. Semantic ranking, embeddings, provider calls, sandboxing, hosted accounts, and desktop search UI remain deferred.

### Chunk 4 Stage 4 status

Stage 4 is complete as the bounded query-execution increment. `WorkspaceStore.search`/`searchWorkspace` execute normalized plain-text queries without interpreting input as SQL/FTS syntax. The v0.6.0 release-closure path automatically builds or recovers an unbuilt, dirty, failed, or crash-interrupted disposable projection, coalesces concurrent in-process rebuild requests, and rechecks the caller's requested revision afterward. Results are returned only from a ready projection current for the authoritative workspace revision and use deterministic term scoring and tie-breaks, graph-derived filters, stable identities, exact provenance/trust, bounded snippets, UTF-8-safe match ranges, cursor pagination, and aggregate response-size validation. Imported-unverified content remains visibly untrusted. The explicit `npm run test:chunk4-stage4` gate is included in `npm run verify`.

Stage 4 by itself does not add passage retrieval, MCP transport, or citation admission. Stages 5–8 add those bounded layers; desktop search UI, embeddings, provider calls, sandboxing, and hosted accounts remain deferred.

### Chunk 4 Stage 5 status

Stage 5 is complete as the bounded passage-retrieval increment. `WorkspaceStore.fetchSearchPassage`/`retrieveSearchPassage` resolve only a Stage 4 chunk result and require its exact indexed workspace revision and content hash. Unbuilt, building, and failed projections cannot serve passages. A dirty retained projection may serve an exact prior result only when the requested revision matches that chunk's provenance and the current authoritative source reconstructs the same chunk, hash, and trust; changed or removed sources fail closed. Extracted-artifact passages additionally require current extracted metadata, matching source digest, managed-byte size/SHA-256 integrity, and no revision change during verification. Returned passages have stable citation IDs, exact bounded UTF-8 counts, retained provenance, explicit untrusted-source-data policies, and authoritative trust metadata. The explicit `npm run test:chunk4-stage5` gate is included in `npm run verify`.

Stage 5 by itself does not add MCP transport or citation admission. Stages 6–8 add those bounded layers; desktop search UI, embeddings, provider calls, sandboxing, and hosted accounts remain deferred.

### Chunk 4 Stage 6 status

Stage 6 is complete as the bounded MCP transport increment. The private MCP server exposes read-only `search_clarity_workspace` and `retrieve_search_passage` tools over the Stage 4/5 Core APIs. Wire inputs use explicit snake_case fields and tight query, identifier, filter, cursor, hash, and passage limits; handlers translate them into the canonical search contract. Structured responses use the bounded result/passage schemas, while human-readable MCP content contains metadata-only summaries rather than a second unbounded source copy. Core activation and exact-passage rules are preserved over transport: search rebuilds disposable state when needed, while retrieval rejects unavailable projections, revision/hash conflicts, changed or removed sources, trust mismatch, and artifact-integrity failures. `plugin/test/searchMcpServer.test.ts` exercises the live Streamable HTTP boundary, tool metadata/count, search-to-passage flow, response-size bound, stale/hash denials, unbuilt retrieval denial, and malformed inputs. The explicit `npm run test:chunk4-stage6` gate is included in `npm run verify`.

Stage 6 by itself does not add citation admission or workflow citation integration. Stages 7–8 add those bounded layers; desktop search UI, embeddings, provider calls, sandboxing, and hosted accounts remain deferred.

### Chunk 4 Stage 7 status

Stage 7 is complete as the bounded citation-admission increment. `WorkflowService.admitSearchCitations` accepts only exact Stage 5 identity/revision/content-hash requests, re-fetches each passage through the authoritative Core, applies an eight-citation/100,000-character/400,000-byte aggregate budget, preserves trust and source-data policy labels, and stores stable citation ids. Candidate input may narrow the admitted ids, but arbitrary or non-admitted ids are rejected. Context revision changes invalidate the prepared context before admission, and all admission errors leave the context unchanged. The live MCP `admit_search_citations` tool is bounded, metadata-summary-only on the text channel, and does not accept caller-supplied passage bodies. Release closure adds another exact Core re-fetch at staging and again immediately before approval, so bytes or authoritative citation state changed after admission cannot be committed from a cached snapshot. `plugin/test/searchCitationAdmission.test.ts`, `plugin/test/chunk4ReleaseGrayBox.test.ts`, and the Chunk 4 release gates cover these separate boundaries.

Stage 7 by itself does not add citation rendering. Stage 8 adds bounded presentation; desktop search UI, embeddings, semantic ranking, provider calls, sandboxing, and hosted accounts remain deferred.

### Chunk 4 Stage 8 status

Stage 8 is complete as the bounded citation-presentation increment. A staged candidate stores only Core-generated presentation snapshots for the exact citations revalidated from its prepared context: a short UTF-8-safe preview, source title, stable citation id, content hash, workspace revision, chunk offsets, trust label, and explicit source-data/instruction policy. Caller-supplied presentation metadata is discarded at the workflow boundary. The `render_clarity_workflow` view exposes bounded snapshots with count/truncation metadata, and the private review widget renders them with source provenance and unverified/truncation treatment using text-only DOM writes. Normal MCP `isError` results now clear challenge-pending state; a fresh workflow view can trigger a truthful retry. The full passage remains available only through the exact Stage 5 retrieval contract; no preview is an instruction or approval proof.

The presentation bound is 8 citations per run, a 2,000-character/8,000-byte preview per citation, and the existing Stage 7 aggregate admission limits. `plugin/test/searchCitationPresentation.test.ts` covers live MCP prepare→search→admit→stage→render persistence, exact provenance/trust/policy labels, truncation, response-size bounds, and caller-forgery rejection. `plugin/test/widgetSecurity.test.ts` covers the bounded review-surface renderer and browser-storage/network safety. The explicit `npm run test:chunk4-stage8` gate is included in `npm run verify`.

Stage 8 does not add desktop search controls, semantic ranking, embeddings, provider execution, sandboxing, hosted accounts, or workflow composition changes. Packaging remains subject to the v0.6.0 gates below.

## Product contract preserved

### One authoritative Core

Electron and MCP both instantiate `WorkspaceStore` against the same normalized SQLite database. Reads are fresh; there is no independent desktop JSON snapshot or MCP graph copy. Production has no `localStorage` persistence fallback and no seeded workspace. The known sleep-research demo is refused during legacy import.

The current database schema version is 6. Migration 5 adds persisted artifact extraction state and migration 6 adds only the disposable, rebuildable search projection (`search_index_state`, `search_documents`, and `search_chunks`) while preserving the one unified Core. Initialization and migrations are serialized across processes. The store enables WAL, full synchronous writes, foreign keys, bounded busy handling, immediate transactions, validation before commit, and corruption preservation before empty recovery.

Default database locations remain:

- Windows: `%LOCALAPPDATA%\Clarity Workflows\data\clarity.sqlite3`
- macOS: `~/Library/Application Support/Clarity Workflows/clarity.sqlite3`
- Linux: `$XDG_DATA_HOME/clarity-workflows/clarity.sqlite3`, or `~/.local/share/clarity-workflows/clarity.sqlite3`

`CLARITY_DATABASE_FILE` and `CLARITY_ARTIFACTS_DIR` are the development/test overrides.

### Complete human graph surface

| Area | Delivered behavior |
|---|---|
| Workspaces | Create, rename, switch, archive, restore, delete; empty onboarding; optimistic revision conflicts |
| Side projects | Create, edit, archive, restore, delete; filter and membership display; archived projects are restore-only |
| Work items | Create, edit, duplicate, delete, drag, pin; paper/book/dataset/code/question/hypothesis/dashboard/project kinds |
| Metadata | Description, provenance, status, priority, tags, side project, bounded positions |
| Relationships | Create, label, redirect, reverse, delete; directed presentation; dashed cross-project references |
| Annotations | Human add/edit/delete; AI/system read-only; imported declared authorship retained but unverified |
| Find and focus | Text search plus kind, status, priority, and side-project filters; select visible items |
| History | Undo/redo for local human graph changes; newest-first durable activity view |
| Interchange | Clarity workspace JSON and Schema.org + Clarity JSON-LD import/export |
| Accessibility | Labeled graph and controls, keyboard shortcuts, modal focus trap/restore, status/error live regions, semantic buttons/forms |

No production action creates a fake record. Empty-state items are created only after the operator submits real form values. Conditional disabled states correspond to enforced read-only, conflict, protection, or capacity boundaries; there is no decorative disabled feature placeholder.

### Trust and import semantics

| Record | Origin/trust | Mutation rule |
|---|---|---|
| Human-created node | `human` | Human metadata and position are editable unless an archive/conflict boundary applies |
| Approved workflow result | `approved-ai` | Workflow metadata and evidence relationships are protected; permitted human-local presentation/note changes do not rewrite its approval history |
| Imported node | `imported-unverified` | Imported content remains usable but is visibly unverified; import cannot assert `approved-ai` |
| Local human annotation | `local`, author `human` | Human-editable |
| Native AI/system annotation | Trusted native author | Read-only in the human workspace |
| Imported annotation | `imported-unverified`, effective author `human`, original value in `declaredAuthor` | Exact body is retained, attribution is displayed as declared/unverified, and no protected native authority is forged |

Portable import always creates a new workspace identity. It imports only the human graph document. It does not import artifacts, workflow definitions, runs, gates, approvals, trusted result identity, or activity authority.

### Concurrency, archives, and lifecycle

- Every workspace carries a monotonic revision. `saveHumanWorkspace` and deletion require the expected revision and fail with a structured conflict instead of overwriting newer MCP or desktop work.
- The renderer serializes queued saves. Switching workspaces and closing the window wait for the newest queued edit, not only the save that was in flight when the operation began.
- Main keeps the Electron window open until preload receives the renderer's close-ready acknowledgement after the final save drain.
- A conflicted local draft stays visible and is not silently replaced. The operator can export it, reload the authoritative workspace, and reconcile.
- Archived workspaces and side projects are restore-only in both UI and Core. A raw IPC caller cannot use the human API to modify records inside an archived project.
- The human API rejects creation or conversion to reserved workflow-managed node kinds and protects native/Core-managed result identity, evidence relationships, AI annotations, workflow definitions, runs, gates, and approvals. Imported-unverified records that merely use a reserved kind do not acquire native workflow authority and remain removable portable graph content.
- Workspace deletion records artifact cleanup transactionally. A failed filesystem cleanup remains as a validated tombstone and is retried on restart; the Core never scans arbitrary orphan directories after corruption recovery.

### Fixed private workflow safety

The current thirteen-tool ChatGPT app still enforces the Chunk 1 private workflow while adding bounded search, exact retrieval, and citation admission:

1. Prepare bounded source context through an adjustable pre-tool gate.
2. Reason without mutating the graph.
3. Stage a candidate through the post-tool ontology/evidence gate.
4. Render the review UI.
5. Approve and commit, or reject without topology mutation.

Prepared context is bound to the workspace revision. A staged run records its evidence revision. Approval challenges are short-lived and bound to workspace ID, run ID, current revision, run digest, and evidence state. Any intervening mutation makes review stale. A result-ID collision fails closed. Run and approval retention remains relationally valid beyond 100 runs.

The approval tool is marked app-only and a compliant MCP host keeps it unavailable to the model. This is a client-mediated human-review boundary, not cryptographic attestation of a physical click against a deliberately modified raw MCP client. Do not describe it as stronger than that.

## Acceptance boundary

| Evidence | What it proves | Boundary |
|---|---|---|
| `plugin/test/chunk2HumanWorkspace.e2e.test.ts` | Human Core save, live MCP read/stage/approve, stale desktop protection, archive, import, delete, close/restart durability | Direct Core + live MCP |
| `scripts/chunk2-browser-core-e2e.mjs` | Visible production renderer CRUD, drag/pin, projects, relationships, annotations, filters, undo/redo, exports/import, conflict/reload, live MCP, full restart | Production renderer → real SQLite Core; direct injected bridge uses the same Core API, not mock persistence |
| `scripts/chunk2-electron-ipc-contract.mjs` | Exact shipped main/preload channel allowlist, structured errors, imports/deletes, and delayed close-save acknowledgement | Unchanged `electron/main.cjs` + `electron/preload.cjs` under instrumented Electron host APIs |
| `scripts/chunk2-concurrent-init-e2e.mjs` | Two independent Node OS processes cross one barrier, initialize a fresh shared SQLite file, apply schema 1–5 once, and leave a valid empty Core | Real OS processes + SQLite |
| `plugin/test/sharedCore.e2e.test.ts` | Desktop/MCP bidirectional visibility, approval commit, shutdown, and restart | Unified Core regression |
| `plugin/test/ingestion.test.ts` | Explicit format policy, bounded extraction, managed-byte integrity, unsupported-byte state, retry, and restart hydration | Chunk 3 Stage 1 Core boundary |
| `scripts/chunk3-stage1-browser-e2e.mjs` | Production renderer chooser/drop controls against a real SQLite Store; extracted Markdown, unsupported PDF bytes, managed-copy equality, and durable artifact counts | Chunk 3 Stage 1 renderer/Core boundary; injected bridge, not native-window automation |
| `plugin/test/chunk3Stage2.e2e.test.ts` | Live MCP artifact listing/content calls, body stripping, unsupported denial, restart hydration, retry, and tampered-byte integrity denial | Chunk 3 Stage 2 Core + live MCP boundary |
| `scripts/chunk3-stage2-browser-e2e.mjs` | Production renderer extraction/unsupported states, separate MCP OS process, bounded content read, review resource labels, SQLite restart, retry, and tampered-byte denial | Chunk 3 Stage 2 renderer + separate MCP process + real SQLite |
| `plugin/test/searchIndex.test.ts` | Schema 6 search projection migration, stable document/chunk identity, graph/artifact provenance, dirty/rebuild transitions, stale replacement rejection, restart/corruption isolation, and bound/trust checks | Chunk 4 Stage 2 durable model; no search transport |
| `plugin/test/searchMaintenance.test.ts` | Deterministic source derivation/chunking, UTF-8/line offsets, extracted-artifact integrity, failed-build retention, revision conflicts, dirty/rebuild generation, and restart parity | Chunk 4 Stage 3 maintenance; no query/retrieval transport |
| `plugin/test/searchExecution.test.ts` | Bounded plain-text query execution, deterministic scoring, scope/source/project/node/artifact/trust filters, pagination, snippets, response limits, freshness conflicts, injection safety, and imported trust | Chunk 4 Stage 4 local query boundary; no passage/retrieval transport |
| `plugin/test/searchRetrieval.test.ts` | Bounded node/annotation/artifact passage fetch, stable citations, content-hash and revision binding, Unicode limits, artifact re-verification, policy labels, and imported trust | Chunk 4 Stage 5 local passage boundary; no MCP transport or citation admission |
| `plugin/test/searchMcpServer.test.ts` | Live Streamable HTTP MCP search and passage tools, bounded wire inputs/outputs, tool metadata/count, search-to-fetch flow, stale/hash/unbuilt denials, and malformed-input handling | Chunk 4 Stage 6 MCP transport; no desktop UI or citation admission |
| `plugin/test/searchCitationAdmission.test.ts` | Live prepare→admit→stage citation flow, Core re-fetch/hash binding, stable run citation ids, stale context invalidation, aggregate limits, and forged-text rejection | Chunk 4 Stage 7 citation admission; no desktop citation UI or provider execution |
| `plugin/test/searchCitationPresentation.test.ts` | Live Core-generated citation preview snapshots, exact provenance/trust/policy labels, truncation/response bounds, run persistence, and forged-metadata rejection | Chunk 4 Stage 8 bounded citation presentation |
| `plugin/test/widgetSecurity.test.ts` | Review widget citation section, text-only rendering, bounded/unverified labels, MCP Apps bridge, and no browser persistence/remote fetch | Chunk 4 Stage 8 review presentation; no native-window automation |
| `plugin/test/searchCitationIntegrity.whitebox.test.ts` | Citation schema/source-kind invariants, Unicode/UTF-8 preview bounds, run revision/workspace binding, legacy compatibility, and missing typed-source rejection | White-box durable-schema boundary; no live MCP or browser |
| `plugin/test/chunk4ReleaseBlackBox.e2e.test.ts` | Managed Markdown ingestion, Store close/reopen, automatic first-search indexing, live MCP search/retrieve/admit/stage/render, and service-level challenge/approval | One black-box journey; not a separate OS restart, tamper test, widget/app transport, or native Electron test |
| `plugin/test/chunk4ReleaseGrayBox.test.ts` | Managed-byte race injection at staging/approval, selected-source gate, one-shot prepared-context race, and atomic sibling-run closure | Direct Store/WorkflowService gray-box boundary; no live MCP, browser, or native Electron |
| `scripts/browser-compat.mjs` | Production renderer and raw review widget responsive flows in bundled Chromium, including simulated MCP `isError` challenge recovery and citation rendering | Simulated widget host; not real ChatGPT, Firefox, WebKit, SQLite persistence, or native Electron |

The release environment could not launch a native Electron window because it exposed no usable X display and blocked the AF_UNIX/ptrace paths needed to supply one. Native Electron invocation aborted in GTK before application code. Therefore the automated claim is deliberately limited to the production renderer against real Core, the exact shipped main/preload contract under instrumentation, and real multi-process Core behavior. Run a final native-window smoke test on a display-capable Windows/macOS/Linux host before wider distribution.

### Verification provenance and current candidate

The packaged v0.5.0 release evidence remains recorded in `CLARITY_V0.5.0_CHUNK3_REPORT.md`. The eight Chunk 4 stage reports retain the focused counts and boundaries that passed when each increment was accepted; they are historical evidence, not a substitute for rerunning the combined v0.6.0 tree.

The settled v0.6.0 tree passed `npm run verify`: root 32 files / 205 tests plus every included Chunk 2/3/4, browser, package, launcher, version, white-box 37/37, black-box 1/1, and gray-box 3/3 gate. The independent focused white-box/concurrency/path selection passed 7 files / 65 tests; Stage 4 passed 12/12, Stage 5 passed 11/11, and Stages 6–8 passed 3/3 each. `npm run test:fire` passed 1 file / 3 tests; `npm run plugin:test` passed 25 files / 145 tests; black-box diagnostics passed typed-failure accounting and chunked HTTP 413 denial.

Bundled Chromium 149.0.7827.0 passed all renderer/widget viewports with typed challenge-error recovery, two challenge calls, one approval, one citation card, and final committed status. The element gate passed widget security 1/1 and the instrumented Electron IPC contract at schema 6 / 13 channels / final revision 2. `npm run version:test`, `npm run verify:dist`, plugin structural verification, and the Windows launcher check passed. The final runtime was Node.js 24.14.0, npm 11.9.0, Linux 6.18.35 x86_64, `@sparticuz/chromium` 149.0.0, and Electron 43.3.0.

Mutation passed its 60% floor after 2,353 mutants were instrumented: 1,362 killed, 411 survived, 236 had no coverage, the overall score was 67.79%, the covered score was 76.82%, and no mutant timed out or errored. Both production dependency audits reported 0 vulnerabilities.

The virtual handoff allowlist resolves to 173 files: 43 compiled outputs (7 renderer, 36 plugin), 0 missing files, 0 allowlisted symlinks, and 0 forbidden or unexpected files after excluding declared working outputs. This is a source-tree audit, not evidence for an archive that does not yet exist.

The exact v0.6.0 source tree is **PRE-PACKAGE GATE PASSED**. That authorizes creation and clean-extraction verification of a private candidate only. Native Electron, Firefox, WebKit, a real account-owned ChatGPT connection, candidate packaging, and both clean extractions remain uncompleted at this report checkpoint; Firefox and WebKit are compatibility gaps, while native Electron and the real connection are explicit publication gates.

No acceptance fixture is production data. Tests use temporary directories and delete them. A fresh production Core is explicitly asserted to contain zero workspaces and zero artifacts.

## External ChatGPT connection state

The local v0.6.0 candidate and its tests do not silently refresh an account-owned ChatGPT connection. An operator must refresh/rebind the developer connection, inspect its thirteen tools and component, select it in a new conversation, and complete a real tool call before using that account as integration evidence. Local health or MCP smoke results are not evidence that the account-owned connection was upgraded.

## Verification and release commands

Run on the exact settled source tree with Node.js 22.13 or newer for the pre-package gate, then repeat from the executable candidate extraction:

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

`npm run verify` includes the Chunk 2 suite, both Chunk 3 gates, all eight Chunk 4 stage gates, the release white-/black-/gray-box suites, browser compatibility, launcher/package checks, and `npm run version:test`. The element gate additionally composes the widget security suite, Chromium fixture, and instrumented Electron IPC contract. Do not replace `npm ci` with an unlocked dependency install for release evidence. Record exact test counts, mutation score, audit results, runtime matrix, Chromium version, and native-window limitation in the release report.

### Browser and Electron compatibility boundary

- `npm run test:browser` launches bundled Chromium only. It covers the production renderer at 1280×720, 1440×900, and 1920×1080 plus the raw review widget at 390×844, 760×900, and 1200×900. The current fixture also checks bounded citation display and recovery after a simulated MCP `isError` challenge result.
- The loopback renderer compatibility flow uses the intentionally ephemeral browser adapter. Real SQLite behavior is covered separately by the Chunk 2/3 browser-Core suites.
- The widget compatibility host is simulated in-page. It is not a real MCP server, ChatGPT connection, or account integration check.
- Firefox and WebKit are not part of the current automated gate and must not be claimed as tested browsers without separate evidence.
- The shipped Electron main/preload channel and security contract is tested under instrumented host APIs. That is not a native BrowserWindow launch.
- The headless release environment cannot supply the required display/AF_UNIX path. A display-capable release host must perform the final native Electron smoke, including file-URL assets, preload availability, SQLite initialization, chooser/drop, save/close, restart, and an empty first-run Core.

## Source-release packaging contract

Do not stage any archive while the report says **PRE-PACKAGE GATE PENDING**. After it says **PRE-PACKAGE GATE PASSED**, create a private `Clarity-Workflows-v0.6.0-Chunk4-Source.candidate.zip` from a fresh staging directory using the explicit allowlist below. That candidate exists only to run the archive, clean-extraction, native-host, and real-connection release gates. It is not publishable.

Only after those candidate gates pass may the report change to **RELEASE GATE PASSED**. Then recreate the staging tree with the passed report, create the final `Clarity-Workflows-v0.6.0-Chunk4-Source.zip`, and repeat both extraction gates against that exact final ZIP. This two-pass procedure avoids requiring an archive to contain a status that could only have been established by testing a different archive.

Include:

- `.codex-plugin/plugin.json`;
- root source/configuration: `package.json`, `package-lock.json`, TypeScript/Vite/Vitest/Stryker configs, `index.html`, launcher batch file, and current documentation;
- `assets/`, `electron/`, `scripts/`, `skills/`, and `src/`;
- `plugin/src/`, `plugin/test/`, `plugin/scripts/`, `plugin/public/`, `plugin/runtime-package/`, `plugin/tsconfig.json`, and `plugin/README.md`;
- fresh `dist/` and `plugin/dist/` produced by the final verified build so the private Windows launcher remains operable.

Exclude:

- all `node_modules/`, caches, temporary directories, source archives, and test outputs;
- `.git/`, `.agents/`, `.codex/`, `.app.json`, environment files, credentials, tunnel profiles, encrypted keys, integration mappings, and logs;
- SQLite files and sidecars, artifact/data/runtime directories, corruption backups, screenshots, and user content;
- `*.tsbuildinfo`, `.stryker-tmp/`, `coverage/`, `reports/`, mutation output, and stale build files not recreated by the final build.

### Exact staging and verification procedure

Use two independent extractions. The first remains untouched for archive inventory and packaged-build verification. The second is allowed to gain `node_modules`, build metadata, and test output while executing the release suite. This avoids treating files created by the verification commands as if they had shipped in the archive.

1. From the verified source root, create a new `mktemp -d` staging parent and a child named `Clarity-Workflows-v0.6.0-Chunk4-Source`.
2. Copy only these root files into that child:

   ```text
   .app.json.example
   .gitignore
   CHATGPT_INTEGRATION_PLAN.md
   CLARITY_CHUNK3_STAGE1_REPORT.md
   CLARITY_CHUNK4_STAGE1_REPORT.md
   CLARITY_CHUNK4_STAGE2_REPORT.md
   CLARITY_CHUNK4_STAGE3_REPORT.md
   CLARITY_CHUNK4_STAGE4_REPORT.md
   CLARITY_CHUNK4_STAGE5_REPORT.md
   CLARITY_CHUNK4_STAGE6_REPORT.md
   CLARITY_CHUNK4_STAGE7_REPORT.md
   CLARITY_CHUNK4_STAGE8_REPORT.md
   CLARITY_PROJECT_HANDOFF.md
   CLARITY_V0.3.0_CHUNK1_REPORT.md
   CLARITY_V0.4.0_CHUNK2_REPORT.md
   CLARITY_V0.5.0_CHUNK3_REPORT.md
   CLARITY_V0.6.0_CHUNK4_REPORT.md
   READ ME FIRST.txt
   README.md
   START CLARITY WORKFLOWS.bat
   index.html
   package.json
   package-lock.json
   stryker.conf.json
   tsconfig.json
   tsconfig.app.json
   vite.config.ts
   vitest.config.ts
   ```

3. Copy only these directories, preserving their relative paths:

   ```text
   .codex-plugin
   assets
   electron
   scripts
   skills
   src
   dist
   plugin/dist
   plugin/public
   plugin/runtime-package
   plugin/scripts
   plugin/src
   plugin/test
   ```

   Also copy `plugin/README.md` and `plugin/tsconfig.json`. `dist/` and `plugin/dist/` must be the fresh outputs produced by the final verified build.

4. Reject the staging tree if its inventory contains `node_modules`, `.app.json`, `.env*`, `.git`, `.agents`, `.codex`, `*.sqlite*`, `*.db`, `*.log`, `*.dpapi`, `*.tsbuildinfo`, `.stryker-tmp`, `coverage`, `reports`, artifact/data/user-runtime directories, caches, incoming archives, symlinks, or files outside the allowlist. The allowlisted `plugin/runtime-package/` lock manifest is not user runtime data. Repeat the production scan for secret-value patterns, sleep-demo content outside explicit rejection/negative-test paths, browser persistence outside security assertions/comments, and stale product versions in current runtime/compiled surfaces. Historical reports may retain their historical versions.
5. From inside the staging child, record a sorted SHA-256 manifest for every file in `dist/` and `plugin/dist/`; keep that manifest beside the archive rather than inside it. These are the prebuilt artifacts used by the private Windows launcher and must be verified before any clean-extraction build overwrites them.
6. Create a deterministic-metadata private ZIP named `Clarity-Workflows-v0.6.0-Chunk4-Source.candidate.zip` with the single staging child as its top-level directory. Reject absolute paths, `..` traversal, duplicate entries, backslash traversal, and additional top-level children. Do not overlay it on an older connector or source archive.
7. In the output directory, create and verify a candidate digest with:

   ```bash
   sha256sum Clarity-Workflows-v0.6.0-Chunk4-Source.candidate.zip > Clarity-Workflows-v0.6.0-Chunk4-Source.candidate.zip.sha256
   ```

8. Extract the verified candidate ZIP into a first new temporary directory. Before installing or building anything, verify the exact allowlist, forbidden inventory, one-top-level-directory rule, absence of symlinks, secret/data scans, and the recorded `dist/`/`plugin/dist/` file hashes. Keep this extraction untouched.
9. Extract the same verified candidate ZIP into a second new temporary directory. Enter its one top-level source directory, run `npm ci`, and verify the packaged outputs before any rebuild:

   ```bash
   npm ci
   npm run verify:dist
   node plugin/scripts/verify-package.mjs
   npm run version:test
   node plugin/scripts/smoke.mjs
   ```

10. In the second extraction, run the full source/rebuild gate:

   ```bash
   npm run verify
   npm run test:fire
   npm run plugin:test
   npm run test:mutation
   npm audit --omit=dev
   npm audit --omit=dev --prefix plugin/runtime-package
   ```

11. Repeat the production-data and secret-value scans after the tests. Do not apply the untouched-archive ban on generated `node_modules`, build metadata, or test output to this second working extraction; the first extraction is the archive-hygiene evidence.
12. Complete the display-capable native Electron smoke and refresh/select the account-owned ChatGPT connection for a real thirteen-tool call against the candidate. If any gate fails, keep the report at pre-package status and do not publish.
13. If every candidate gate passes, record exact evidence and change the report to **RELEASE GATE PASSED**. Recreate the staging tree from that final source and generate `Clarity-Workflows-v0.6.0-Chunk4-Source.zip`. Repeat the inventory, hash, two-extraction, and executable checks described in steps 4–11, substituting the final ZIP name and without recreating the candidate. Generate `Clarity-Workflows-v0.6.0-Chunk4-Source.zip.sha256` only after that final ZIP exists. Publish the final ZIP, its compiled-output hash manifest, and its verified `.sha256` sidecar only if the repeated gates pass. A failed final-archive check invalidates the passed status; return the report to **PRE-PACKAGE GATE PENDING** before another candidate cycle.

This is a source release, not a Windows connector overlay, signed installer, or public deployment.

## Next authorized work: Chunk 5 only

Chunk 4 Stages 1–8 define the bounded v0.6.0 release candidate. Once its final gate and package pass, any product increment must be explicitly authorized and scoped as **Chunk 5 — Visual Workflow Composer**. Do not fold embeddings, provider execution, sandboxing, hosted accounts, or public distribution into the Chunk 4 release closure.
