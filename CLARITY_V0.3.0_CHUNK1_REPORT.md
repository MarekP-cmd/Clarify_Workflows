# Clarity Workflows v0.3.0 — Chunk 1 completion report

Date: 2026-08-11

## Outcome

Chunk 1 is implemented and verified. The Electron desktop application and the ChatGPT MCP server now use one authoritative, normalized SQLite Clarity Core. A clean installation starts empty. The old demonstration workspace is not production data and is refused during legacy import.

This is the durable integration foundation for the complete Clarity product. It is not yet a signed/public product release and does not claim the later file-understanding or full visual workflow-builder features.

## Delivered

### Shared Clarity Core

- One database for workspaces, projects, nodes, edges, artifacts, annotations, workflow definitions, workflow runs, gate definitions, and approval records.
- Stable default data paths on Windows, macOS, and Linux, with explicit development overrides.
- SQLite WAL mode, full synchronous writes, foreign keys, bounded busy timeout, immediate write transactions, and rollback on validation failure.
- Fresh cross-process reads: no independent desktop/MCP snapshot caches.
- Legitimate v1 import with one-time migration; known bundled demonstration data is rejected.
- Corrupt database preservation before recovery to an empty Core.
- Managed artifact copies with SHA-256 digest, size, MIME metadata, traversal defense, and transactional metadata commit.

### Desktop

- Empty first-run onboarding and workspace creation.
- Workspace switching.
- Draggable graph nodes and editable relationships.
- Question and hypothesis creation.
- Connected-node inspector, pinning, and human annotations.
- Schema.org + Clarity JSON-LD export.
- Debounced saves with pointer-up/page-hide flushes and visible save state.
- Electron sandbox, context isolation, disabled renderer Node integration, denied new windows/navigation/permissions, and an allowlisted preload IPC surface.
- No production browser-storage fallback and no seeded workspace.

### ChatGPT MCP app

- Eight schema-described tools for workspace read, node inspection, bounded context preparation, candidate staging, workflow rendering, approval challenge, approval, and rejection.
- Explicit workspace identity throughout tool and run paths.
- Adjustable pre-tool gate.
- Side-effect-free candidate staging.
- Post-tool ontology/evidence gate.
- Short-lived component-only approval challenge.
- Human approval required before graph commit; rejection leaves topology unchanged.
- Embedded CSP-contained graph/review UI.
- Loopback server hardening, bounded request bodies, CORS policy, optional bearer authentication, rate limiting, and observable integration diagnostics.

## Executable acceptance proof

`plugin/test/sharedCore.e2e.test.ts` proves the required round trip:

1. a desktop store creates a real workspace and graph;
2. a live MCP client reads the exact graph;
3. a second desktop connection writes while MCP stays online;
4. MCP immediately observes the desktop change;
5. MCP prepares context, stages a result, obtains a human-review challenge, and commits after approval;
6. desktop, MCP client, and server all close;
7. a fresh desktop process reopens the database and sees both the human edit and approved AI result, including committed run and approval records.

## Verification results

| Check | Result |
|---|---:|
| TypeScript desktop build | Pass |
| TypeScript MCP build | Pass |
| Vitest files | 16/16 pass |
| Vitest assertions | 75/75 pass |
| Shared desktop/MCP/restart E2E | Pass |
| MCP protocol smoke | Pass, 8 tools |
| Two gates + approval E2E | Pass |
| Invalid approval defense | Pass |
| Production renderer/CSP check | Pass |
| Chromium desktop viewports | Pass at 1280×720, 1440×900, 1920×1080 |
| Chromium ChatGPT component viewports | Pass at 390×844, 760×900, 1200×900 |
| Browser create/annotate/reload flow | Pass |
| 2,500-node fire test | Pass |
| Windows launcher/security assertions | Pass |
| Production dependency audit | 0 known vulnerabilities |
| Private MCP runtime dependency audit | 0 known vulnerabilities |
| Mutation test | 1,065 mutants; 62.87% total / 76.51% covered score; 0 timeouts/errors |

The mutation-test release floor is now 60%, so a future regression below this measured baseline fails the command. Surviving mutants are recorded in `reports/mutation/mutation.json`; they are test-strengthening work, not hidden as a perfect score.

## Reproducibility corrections made during release testing

- The declared Playwright dependency was missing; it is now pinned and a packaged headless Chromium runtime is available for the compatibility command.
- TypeScript 7 was incompatible with Stryker 9.6's configuration preprocessor; TypeScript is pinned to 5.9.3 and both application builds still pass.
- MCP builds previously retained deleted generated files; the build now cleans the exact `plugin/dist` directory before compilation, and release verification rejects a stale seed module.
- The minimum Node runtime is 22.13.0, matching unflagged availability of the built-in SQLite module.
- Release checks reject the old sleep-research prototype strings in the production renderer.

## Commands

```bash
npm install
npm run verify
npm run test:mutation
npm audit --omit=dev
```

Desktop development launch:

```bash
npm run desktop
```

Private ChatGPT server development launch:

```bash
npm run plugin:start
```

## Boundary for Chunk 2

The next chunk should implement real desktop file ingestion as one complete vertical slice: native file chooser and drag/drop, managed artifact copy, text extraction for an explicitly supported first set of formats, provenance and content-state UI, bounded source retrieval through MCP, and tests proving ChatGPT cannot claim access to unextracted bytes.

The full gate/workflow designer, general ChatGPT topology editing, conflict UI, hosted accounts/OAuth, sync, installers, and public marketplace release remain separate chunks after that foundation.
