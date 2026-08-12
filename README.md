# Clarity Workflows

Clarity Workflows is a human-first visual workgraph for AI-assisted research and coding. Papers, books, datasets, code, questions, hypotheses, dashboards, projects, annotations, workflow runs, gates, and approvals are explicit graph entities rather than a chat transcript.

## v0.6.0 — Chunk 4: Grounded Search, Retrieval and Provenance

This release keeps the unified SQLite Clarity Core, the complete human-authored workspace, and managed file ingestion from Chunks 1–3. Chunk 4 adds a bounded local search and citation path without adding embeddings, provider execution, or a second source of truth:

- derive a disposable, revision-bound search projection from authoritative nodes, annotations, and explicitly extracted artifacts;
- execute bounded deterministic plain-text searches with filters, pagination, snippets, provenance, freshness, and trust labels;
- retrieve an exact passage only by stable result identity, workspace revision, and content hash;
- re-check managed artifact size and SHA-256 before returning artifact-backed passage text;
- expose search, exact passage retrieval, and citation admission through the private MCP connection;
- admit at most eight Core-refetched citations into prepared workflow context under aggregate character and byte limits;
- persist only Core-generated, bounded citation presentation snapshots on staged candidates;
- render citation title, preview, offsets, digest, trust, policy, and truncation state with text-only DOM writes in the review component.

Chunk 3's managed ingestion remains in force: unsupported, pending, failed, missing, or tampered artifact bytes cannot become readable search passages or citations. Search text is always untrusted source data and is never interpreted as an instruction.

The inherited human workspace remains available:

- create, rename, archive, restore, switch, and delete workspaces;
- create, edit, archive, restore, and delete side projects;
- create, edit, duplicate, delete, pin, and drag eight human work-item kinds;
- set status, priority, tags, provenance, description, project, and position;
- create, relabel, redirect, reverse, and delete directed relationships;
- see side-project membership and dashed cross-project references;
- add, edit, and delete human annotations while keeping AI/system annotations read-only;
- search and filter by text, kind, status, priority, and side project;
- undo and redo human graph changes and inspect durable activity;
- import and export portable Clarity JSON and Schema.org + Clarity JSON-LD;
- reconcile optimistic revision conflicts without overwriting the operator's local draft.

A clean installation starts with zero workspaces. Production does not seed a demonstration graph or fall back to browser storage. Imported records are marked `imported-unverified`; an import cannot manufacture approved-AI provenance, workflow runs, approvals, gates, or artifacts. Actions become unavailable only when an enforced boundary applies, such as an archived workspace/project, protected workflow evidence, a revision conflict, or the graph capacity limit.

## Run the desktop application from source

Requirements: Node.js 22.13 or newer and npm.

```bash
npm ci
npm run desktop
```

The first launch asks the operator to create an empty workspace. Desktop and MCP processes resolve the same database by default:

- Windows: `%LOCALAPPDATA%\Clarity Workflows\data\clarity.sqlite3`
- macOS: `~/Library/Application Support/Clarity Workflows/clarity.sqlite3`
- Linux: `$XDG_DATA_HOME/clarity-workflows/clarity.sqlite3`, or `~/.local/share/clarity-workflows/clarity.sqlite3`

Set `CLARITY_DATABASE_FILE` and optionally `CLARITY_ARTIFACTS_DIR` to use explicit development paths.

## Run the private ChatGPT connection on Windows

The private-test source bundle has one operator-facing launcher:

`START CLARITY WORKFLOWS.bat`

It validates a compatible local Node runtime, downloads checksummed official Node and tunnel runtimes when required, installs the lockfile-pinned production packages, tests the MCP flow, starts the configured OpenAI tunnel, reuses the Windows-user-encrypted tunnel credential when one exists, opens ChatGPT, and waits for a real successful Clarity tool call. Keep the launcher running and select the existing **Clarity Workflows** connection in that conversation.

The connection exposes thirteen tools covering workspace/node inspection, bounded artifact metadata/content reads, bounded search and exact passage retrieval, citation admission, context preparation, candidate staging, workflow rendering, and explicit approve/reject review. The Clarity skill supplies workflow rules; the MCP connection supplies live access to the authoritative Core. A skill alone cannot read the database, and local readiness is not reported as successful ChatGPT integration.

Changing this local package does not update an account-owned ChatGPT connection. A developer must refresh that connection and select it in each new conversation. See [plugin/README.md](plugin/README.md).

## Safety and trust boundaries

The built-in workflow remains two gates around a pure reasoning step:

1. The pre-tool gate admits explicit source IDs into bounded context.
2. ChatGPT drafts without mutating the graph.
3. The post-tool gate checks ontology, evidence, decision, confidence, counterargument, and pressure test.
4. A staged candidate becomes an `approved-ai` result only after explicit component review.

Prepared context is bound to the workspace revision. Approval is bound to the workspace, run, staged-result digest, evidence revision, and a short lifetime; intervening graph changes invalidate it. Workflow-managed results and evidence relationships cannot be rewritten through the human workspace API.

The component-only approval boundary is enforced by the compliant MCP host hiding app-only tools from the model. It is a client-mediated human-review boundary, not cryptographic proof of a physical user gesture against a deliberately modified raw MCP client.

## Verification

```bash
npm run verify
npm run test:fire
npm run plugin:test
npm run test:mutation
npm audit --omit=dev
npm audit --omit=dev --prefix plugin/runtime-package
```

`npm run verify` runs both typechecks and builds, renderer and Core regressions, the Chromium compatibility gate, MCP protocol tests, package checks, launcher checks, version consistency, the complete Chunk 2 and Chunk 3 acceptance suites, and all eight Chunk 4 stage gates. `npm run test:chunk2` separately covers:

- two real Node OS processes initializing one fresh SQLite Core;
- the shipped `electron/main.cjs` and `electron/preload.cjs` contract through instrumented host APIs;
- the production renderer performing visible human graph operations against real SQLite, observing a live MCP mutation, handling a stale-revision conflict, reloading, importing/exporting, and surviving full Core/MCP restart.

The automated browser gate currently covers bundled Chromium, not Firefox or WebKit. The headless release environment also cannot open a native Electron window because it provides no usable X display or AF_UNIX/ptrace path. Native-window smoke testing therefore remains a manual host check; these limitations do not replace the production-renderer, real-Core, or shipped-IPC acceptance tests and must not be reported as multi-browser or native-window coverage. Exact release-candidate evidence and remaining gates are recorded in [CLARITY_V0.6.0_CHUNK4_REPORT.md](CLARITY_V0.6.0_CHUNK4_REPORT.md).

## Scope and sequence

The authoritative delivery sequence assigns **Complete Human Graph Workspace** to Chunk 2, **Real File and Dataset Ingestion** to Chunk 3, and **Grounded Search, Retrieval and Provenance** to Chunk 4. The old boundary paragraph in the historical [Chunk 1 report](CLARITY_V0.3.0_CHUNK1_REPORT.md) is superseded. v0.6.0 closes the eight bounded Chunk 4 increments: contract, durable projection, maintenance, query execution, passage retrieval, MCP transport, citation admission, and citation presentation.

Chunk 4 does not add a desktop search control, semantic or embedding ranking, provider execution, execution sandboxes, hosted accounts/OAuth, signed installers, or public distribution. Later chunks add the visual workflow composer and those broader product capabilities. The durable roadmap and operator handoff are in [CLARITY_PROJECT_HANDOFF.md](CLARITY_PROJECT_HANDOFF.md).

## Versioned ChatGPT skills

The adapted ChatGPT `grill-me`, `grilling`, `to-spec`, and `wayfinder` skills are versioned with this project under [`skills/`](skills/). Their behavior is documented in [`docs/skills/grill-me.md`](docs/skills/grill-me.md), [`docs/skills/to-spec.md`](docs/skills/to-spec.md), and [`docs/skills/wayfinder.md`](docs/skills/wayfinder.md).
