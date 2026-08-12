# Clarity Workflows — ChatGPT integration plan

## Target

Clarity exposes its current graph and guarded workflow tools inside ChatGPT, renders review UI, and persists a result only after human approval. Desktop and ChatGPT operate on one authoritative Core. The private-development path uses OpenAI Secure MCP Tunnel; the public path replaces the private tunnel and personal Platform credential with hosted, tenant-isolated infrastructure and OAuth.

## v0.6.0 — Chunk 4 release candidate

- Added a schema-6 disposable search projection derived from authoritative nodes, first-class annotations, and explicitly extracted artifacts.
- Added deterministic UTF-8-safe chunk generation with exact character, byte, and line spans plus revision-, digest-, source-, and trust-bound identities.
- Added bounded plain-text query execution with deterministic scoring, filters, snippets, pagination, aggregate response limits, and fail-closed freshness checks.
- Added exact passage retrieval bound to result identity, workspace revision, and content hash. Artifact-backed passages re-verify managed byte size and SHA-256 before return.
- Added the read-only `search_clarity_workspace` and `retrieve_search_passage` MCP tools and the bounded `admit_search_citations` workflow-context tool.
- Added at-most-eight citation admission with aggregate character/byte limits; Core re-fetches each passage and never accepts caller-supplied passage bodies or provenance.
- Added durable, Core-generated citation presentation snapshots with bounded previews, source identity, offsets, digest, trust, policy, and truncation state.
- Added text-only citation rendering in the private review component. Citation source text remains untrusted data and is neither an instruction nor approval proof.

The private connection now exposes thirteen tools. Chunk 4 does not add a desktop search control, embeddings, semantic ranking, provider execution, a workflow composer, sandboxing, hosted accounts, or public distribution. The automated browser gate covers bundled Chromium; Firefox/WebKit and native Electron-window behavior require separate host evidence before they can be claimed.

## v0.5.0 — Chunk 3 implementation (after v0.4.0 Chunk 2)

- Completed human workspace, side-project, node, relationship, and human-annotation operations in the Electron surface.
- Added priorities, tags, status, pinning, drag persistence, project/cross-project presentation, search, filters, undo/redo, and activity.
- Added portable Clarity JSON and Schema.org + Clarity JSON-LD import/export without importing workflow authority, artifacts, or trusted provenance.
- Added explicit `human`, `approved-ai`, and `imported-unverified` node origins plus unverified imported annotation attribution.
- Added optimistic workspace revisions, conflict recovery, queued-save draining, and a renderer-to-main close acknowledgement.
- Protected archived workspaces/projects and workflow-managed results, evidence, runs, gates, approvals, and annotations in the shared Core as well as the UI.
- Bound prepared context, staged evidence, and approval challenges to current workspace state so stale reviews fail closed.
- Added complete renderer-to-real-SQLite/MCP/restart acceptance, shipped main/preload contract acceptance, and a simultaneous two-OS-process initialization test.
- Kept fresh installations empty and production free of seeded or mock workspace data.
- Added managed file/dataset ingestion for explicitly supported UTF-8 formats, durable extraction state, bounded inspector previews, paginated artifact metadata, and bounded MCP reads only for extracted and integrity-valid content.
- Added cross-process MCP acceptance, restart/retry parity, and explicit denial for unsupported, failed, pending, missing, or tampered bytes.

Chunk 3 itself did not claim embeddings, grounded search, workflow composition, provider execution, sandboxing, hosted accounts, or public distribution. Chunk 4 subsequently adds only the bounded grounded-search and provenance path described above.

## v0.3.0 — Chunk 1 foundation

- Replaced the disconnected desktop/browser snapshot and MCP JSON store with one normalized SQLite Clarity Core.
- Made desktop and MCP processes resolve the same stable operating-system data path and read current committed state on each operation.
- Added durable workspace, project, node, edge, artifact, annotation, workflow-definition, run, gate, and approval entities with relational validation.
- Added transactional writes, foreign keys, WAL/full-synchronous durability, concurrent mutation serialization, corruption preservation, legitimate legacy import, explicit old-demo refusal, and byte-preserving managed artifact storage.
- Rewired Electron through an allowlisted isolated IPC bridge and removed production `localStorage` fallback and seeded graph data.
- Rewired all eight MCP tools to explicit workspace identity and the shared Core.
- Added a desktop → MCP → desktop round trip, including a human-approved ChatGPT commit, full shutdown, restart, and durable verification.

The `CLARITY_V0.3.0_CHUNK1_REPORT.md` boundary paragraph called file ingestion the next Chunk 2. That label was an error and is superseded by the authoritative roadmap below. The old report remains unchanged as historical evidence.

## Authoritative eleven-chunk roadmap

| Chunk | Name | State for the v0.6.0 candidate |
|---:|---|---|
| 1 | Unified Clarity Core | Delivered in v0.3.0; preserved and hardened |
| 2 | Complete Human Graph Workspace | Implemented in v0.4.0; release status is controlled by the Chunk 2 report |
| 3 | Real File and Dataset Ingestion | Delivered in v0.5.0 through Stage 1 + Stage 2 |
| 4 | Grounded Search, Retrieval and Provenance | Stages 1–8 implemented; v0.6.0 final release and clean-extraction gates pending |
| 5 | Visual Workflow Composer | Not implemented |
| 6 | Two Gates + Pure Agent | Productized designer/runtime chunk not implemented; the fixed private two-gate workflow remains from Chunk 1 |
| 7 | Real AI Execution | Not implemented |
| 8 | Dataset and Code Execution Sandbox | Not implemented |
| 9 | Full Clarity Inside ChatGPT | Not implemented; current ChatGPT surface is read/stage/review only |
| 10 | Hosted Public System and OAuth | Not implemented |
| 11 | Production Hardening and Public Release | Not implemented |

## Account-owned step that cannot be automated

ChatGPT requires the operator to review or refresh a developer connection and select it for a conversation. The launcher can open ChatGPT, bind the local package, copy the test prompt, and diagnose traffic, but it cannot silently grant access.

The account connection observed during v0.4.0 release preparation still exposed the old sleep-demo package. That external connection is not evidence for this local release until an operator refreshes it. The local acceptance suite validates the packaged MCP app and shared Core; it does not claim the account-owned connection was upgraded.

## Public release path

1. Deliver Chunks 5–9 without weakening explicit provenance, bounded context, two gates, or human approval.
2. Host the MCP service at stable HTTPS endpoints with tenant-isolated databases and object storage, backups, migrations, deletion/export workflows, logs, alerts, and rollback.
3. Add OAuth, least-privilege scopes, consent, token rotation/revocation, and server-side secret management.
4. Run prompt-injection, security, privacy, accessibility, compatibility, recovery, and load testing against a staging ChatGPT connection.
5. Register and bind the production MCP connection, submit through the supported ChatGPT review process, and operate a staged rollout.
6. Ship signed desktop installers and an update channel if the companion desktop remains part of the public product.

The private tunnel is a test transport, not the public architecture. Customers must not be required to create API keys, tunnel IDs, or developer connections.
