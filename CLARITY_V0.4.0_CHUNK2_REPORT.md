# Clarity Workflows v0.4.0 — Chunk 2 release report

Date: 2026-08-11  
Chunk: 2 — Complete Human Graph Workspace  
Status: **Complete; source archive packaged and clean-extraction verification passed**

## Outcome

The source tree implements the Complete Human Graph Workspace on top of the unified Clarity Core delivered in v0.3.0. The end-to-end acceptance suite, release checks, source archive, and clean extraction have all passed. The packaged release is limited to Chunk 2 and does not expand its scope.

Production starts empty and contains no mock graph. The desktop and MCP server continue to use the same normalized SQLite Core. The new human workspace operates on that Core, and imports create explicitly unverified records rather than manufacturing trusted AI or workflow provenance.

## Scope authority and correction

The user's authoritative roadmap defines Chunk 2 as **Complete Human Graph Workspace**. The historical `CLARITY_V0.3.0_CHUNK1_REPORT.md` incorrectly labeled file ingestion as the next Chunk 2. That paragraph is superseded.

**Real File and Dataset Ingestion is Chunk 3 and was not implemented.** The application does not wire a native picker or file-drop handler into the workspace, copy selected bytes through a complete ingestion flow, extract document content, parse datasets, or expose extracted content to MCP. A dormant file-to-node helper and pre-existing artifact schema are not counted as ingestion.

## Source and baseline audit

The implementation began by extracting and auditing the attached v0.3.0 source archive. Its SHA-256 is:

```text
31bb38b4b4757b772b930464fb7d461bafcab699cdc375e35ca53dcf0a47ce4f
```

The attached source was not a Git worktree, so archive identity and content inspection—not commit history—are the provenance record.

The original source was tested before Chunk 2 edits with Node.js 24.14 and npm 11.9:

| Baseline check | Original v0.3.0 result |
|---|---:|
| `npm ci` | Pass; 382 packages |
| `npm run verify` | Pass |
| Root Vitest | 16 files, 75 tests pass |
| `npm run test:fire` | 3 tests pass, including 2,500 nodes |
| `npm run plugin:test` | 10 files, 42 tests pass |
| Shared desktop/MCP/restart E2E | Pass |
| MCP protocol surface | Pass; 8 tools |
| Desktop and widget browser viewports | Pass |
| Windows launcher assertions | Pass |
| Root production audit | 0 known vulnerabilities |
| Private runtime production audit | 0 known vulnerabilities |
| Mutation baseline | 1,065 mutants; 62.87% total / 76.51% covered; 0 errors/timeouts |

The audit confirmed that Electron and MCP already instantiated the same `WorkspaceStore`, resolved the same platform data path, used fresh SQLite reads, and persisted bidirectionally across restart. Independent-process probing also confirmed desktop/MCP visibility and durability. A clean Core had no seeded sleep workspace.

## Delivered implementation

### Human graph workspace

- Workspace create, rename, switch, archive, restore, and revision-checked delete.
- Side-project create, edit, archive, restore, and delete, with project filters and cross-project relationship styling.
- Create, edit, duplicate, delete, pin, and drag paper, book, dataset, code, question, hypothesis, dashboard, and project items.
- Status, priority, tags, description, provenance, project membership, and bounded positions.
- Directed relationship create, relabel, redirect, reverse, and delete.
- Human annotation add/edit/delete and read-only native AI/system annotations.
- Text, kind, status, priority, and side-project search/filtering.
- Undo/redo, multi-select deletion, current activity, and empty/conflict/archive states.
- Clarity workspace JSON and Schema.org + Clarity JSON-LD import/export.
- Keyboard/focus/dialog semantics and live error/status presentation for the complete workspace.

There are no fake production actions. The empty graph does not create a record until the operator submits valid values. Disabled actions correspond to enforced archive, workflow protection, conflict, busy, or 5,000-node capacity states.

### Shared Core and lifecycle hardening

- Monotonic workspace revisions and atomic human saves prevent a stale full-graph desktop snapshot from erasing a newer approved MCP result.
- The human API rejects creation or conversion to reserved workflow-managed node kinds and protects native/Core-managed evidence relationships, AI/system annotations, and authored workflow state. Imported-unverified records with a reserved kind do not become native workflow entities.
- Archived workspaces and archived side projects are restore-only at the Core boundary, not only in React.
- Renderer saves are serialized; switching and closing wait for the newest queued edit.
- Main/preload use a close-request/close-ready handshake so Electron does not destroy the window before the last save drains.
- Core mutations return the snapshot committed by their own transaction rather than a later racy reread.
- Workspace deletion records artifact cleanup as a validated database tombstone and retries only that directory after a failure.
- Portable imports create a new identity, mark nodes and annotations unverified, retain declared annotation authorship without trusting it, and omit artifacts/workflow authority.
- The database schema advances through migration 4, including workspace status/revision/activity, record origin, declared imported author, workflow evidence revision, and artifact cleanup state.

### Fixed private workflow preservation

- Prepared source contexts are tied to the workspace revision and fail stale after graph changes.
- A staged run records its evidence revision; approval cannot open after evidence changes.
- Approval challenge and decision inputs require explicit workspace identity and bind workspace, run, revision, run digest, and expiry.
- Result-ID collisions fail closed.
- Result placement and evidence relationship identity remain within shared schema bounds.
- Run/approval retention and public MCP output stay relationally consistent beyond 100 runs.
- Imported or legacy records cannot acquire native approval provenance through import.

The app-only approval tools depend on a compliant MCP host to separate component calls from model calls. This is an explicit client-mediated review boundary, not cryptographic proof of a human gesture against a modified raw MCP client.

## End-to-end acceptance design

| Acceptance | Required behavior |
|---|---|
| Direct shared-Core E2E | Human CRUD, live MCP read/stage/approve, stale-save rejection, archive/import/delete, restart durability |
| Production renderer → real Core | Visible workspace/project/item/relationship/annotation operations, drag/pin, filters, undo/redo, activity, JSON/JSON-LD, conflict/reload, live MCP mutation, restart |
| Shipped Electron IPC contract | Exact `electron/main.cjs` and `electron/preload.cjs` channels, structured errors, and delayed close-save acknowledgement under instrumented host APIs |
| Concurrent initialization | Two real Node OS processes released together onto one new SQLite file; one valid schema 1–4 migration chain; empty result |
| Full regression | Both typechecks/builds, Vitest, production browser/CSP checks, MCP smoke/E2E/package checks, launcher, fire test, mutation floor, audits, version consistency |

The renderer acceptance uses the production browser build and real SQLite `WorkspaceStore`; its injected bridge is an acceptance adapter, not mock persistence or mock production data. A live MCP server mutates the same database during the scenario, and fresh Store/MCP processes verify the final normalized graph after shutdown.

The release container cannot launch a native Electron window: it has no usable X display and blocks the AF_UNIX/ptrace routes needed to provide one, causing GTK to abort before app code. Native-window automation is therefore not claimed. The shipped main/preload files are exercised unchanged under instrumented Electron host APIs, and the production renderer/real-Core path is tested separately. A display-capable host should run a final manual native-window smoke before broader distribution.

## No-mock production-data evidence

- Production renderer has no seeded workspace and no `localStorage` persistence path.
- Both simultaneous fresh-Core initializer processes assert zero workspaces.
- Browser/Core acceptance asserts no artifacts were invented for Chunk 3.
- Test graphs live only in temporary test directories and are removed.
- Known bundled sleep-demo legacy data is refused rather than migrated into production.

## Final release verification

The main and supplemental checks below have passed on the final source tree and in a clean extraction of the final archive.

| Check | Final v0.4.0 result |
|---|---:|
| `npm ci` from clean extraction | Pass; 382 packages |
| `npm run verify` | Pass; 18/18 Vitest files, 129/129 tests; 2,043-module build; complete Chunk 2 suite pass |
| Two-process fresh-Core acceptance | Pass; schema 4, zero workspaces |
| Shipped main/preload IPC acceptance | Pass; 10 allowlisted channels, final revision 2 |
| Production renderer → SQLite/MCP/restart acceptance | Pass; final revision 5, 3 nodes, 3 edges, 1 annotation, 6 activities |
| `npm run test:fire` | Pass; 3/3 |
| `npm run plugin:test` | Pass; 11 files, 69/69 tests |
| Black-box + white-box diagnostics | Pass |
| `npm run test:mutation` | Pass; 1,445 mutants; 968 killed, 135 survived, 102 no-coverage, 0 timeouts/errors; 80.33% total / 87.76% covered |
| `npm audit --omit=dev` | Pass; 0 known vulnerabilities |
| `npm audit --omit=dev --prefix plugin/runtime-package` | Pass; 0 known vulnerabilities |
| Version-consistency and launcher gates | Pass |
| Forbidden production seed/storage scan | Pass; no runtime DB/log files, secrets, or compiled v0.3.0; storage/sleep matches limited to security assertions and rejection guards |
| Clean source-archive extraction + repeat verify | Pass; archive checksum, `npm ci` (382 packages), `npm run verify` (129/129), fire, plugin suite, audits, and forbidden-inventory scans all passed |
| Source archive digest sidecar | `Clarity-Workflows-v0.4.0-Chunk2-Source.zip.sha256`; generated after the final ZIP |

## Integration and packaging status

The account-owned ChatGPT connection observed during preparation still exposed an old sleep-demo package. This local release does not claim that connection was refreshed. An operator must install/refresh the v0.4.0 package and select it in a new conversation before an account-level tool call can count as evidence.

The source archive was created from the explicit allowlist in `CLARITY_PROJECT_HANDOFF.md` and passed clean extraction, installation, verification, audit, and inventory checks. Do not include `node_modules`, databases, artifacts, logs, credentials, account mappings, caches, or user data in any repackaging. The archive digest belongs in the sibling sidecar named above; embedding the final archive's digest in a report inside that same archive would be self-referential.
