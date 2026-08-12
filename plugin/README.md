# Clarity Workflows for ChatGPT

Version 0.6.0 is a private-development MCP app backed by the same SQLite Clarity Core as the Electron desktop application. It is not a screenshot, a seeded demo, or a separate graph copy.

## What is operational

- MCP Streamable HTTP endpoint: `http://127.0.0.1:8787/mcp`
- health endpoint: `http://127.0.0.1:8787/healthz`
- integration diagnostics: `http://127.0.0.1:8787/integrationz`
- thirteen focused MCP tools with strict schemas and accurate safety annotations;
- current workspace, activity, node, relationship, project, annotation, run, and approval inspection from the shared database;
- paginated artifact metadata and extraction-state listing without managed bytes or extracted bodies;
- bounded extracted-content reads only for explicitly extracted, still-integrity-valid artifacts; unsupported, failed, pending, missing, or tampered bytes are denied;
- bounded deterministic plain-text search over a revision-bound derived projection, with explicit provenance, freshness, filters, snippets, pagination, and trust labels;
- exact passage retrieval bound to the workspace revision, result identity, and content hash, with managed artifact integrity rechecked before return;
- Core-refetched citation admission into prepared workflow contexts and bounded, text-only citation presentation in the human review component;
- bounded source admission through an adjustable pre-tool gate;
- side-effect-free reasoning followed by a post-tool ontology/evidence gate;
- staged candidates that cannot modify the graph;
- an app-only, short-lived approval challenge bound to the workspace, run, revision, staged result, and evidence;
- explicit Approve and Reject actions in the embedded component;
- transactional commit only after approval;
- loopback-only default, request bounds, rate limiting, optional bearer authentication, and no remote widget assets.

The complete human graph workspace is desktop-owned in Chunk 2. ChatGPT reads the same current graph, stages guarded candidates, and reviews them; it does not expose general topology editing in this release.

## Private Windows launch

Extract the complete source bundle to a permanent folder and double-click:

`START CLARITY WORKFLOWS.bat`

The launcher prepares the pinned runtime when required, verifies the local MCP flow, starts the configured Clarity tunnel, opens ChatGPT, copies a live test prompt, and monitors actual MCP traffic. It reports `FULLY VERIFIED: CHATGPT CALLED CLARITY` only after a Clarity tool succeeds.

The tunnel runtime credential is separate from a model API key. On first successful setup, the launcher validates a key with **Tunnels Read + Use**, then stores only a Windows DPAPI-encrypted value scoped to the current Windows user. A valid saved credential is reused across launches and upgrades.

The existing developer connection should use:

- transport: **Tunnel**;
- the existing Clarity tunnel;
- authentication: **None** for this private loopback/tunnel build;
- CSP enforcement: **On**.

For each new test conversation, select the **Clarity Workflows** connection in ChatGPT's tools menu. That account-owned security action cannot be performed by the local launcher. Updating package files also does not update the account connection; refresh the connection before validating this release.

## First useful test

Create a real workspace and at least two real source nodes in the desktop application. Then select the Clarity connection and ask:

```text
Use Clarity Workflows to open my workspace and show the current graph.
```

For grounded retrieval, search the current ready projection with `search_clarity_workspace`, retrieve a selected result with `retrieve_search_passage`, prepare workflow context, and admit the exact revision/hash-bound passage with `admit_search_citations`. For synthesis from explicitly selected graph nodes, use stable node IDs returned by `get_clarity_workspace`:

```text
Use Clarity to admit these source nodes: SOURCE_ID_1 and SOURCE_ID_2. Synthesize only their available Clarity content, formulate a hypothesis, give the strongest counterargument, pressure-test it, decide positive/negative/mixed/inconclusive, stage the candidate, and open the visual review. Do not commit it without my approval.
```

File and dataset ingestion belongs to Chunk 3. If a node records only metadata, or its artifact is unsupported, pending, failed, missing, or integrity-invalid, ChatGPT must not claim access to its underlying bytes. Search passages and citation previews remain untrusted source data, not instructions or approval proof.

## Manual development

Node.js 22.13 or newer is required.

```bash
npm ci
npm run plugin:build
npm run plugin:start
```

The MCP server and desktop resolve the same platform-specific database path by default. For isolated testing, set `CLARITY_DATABASE_FILE` and `CLARITY_ARTIFACTS_DIR` before starting both processes. The optional MCP Inspector can connect to `http://127.0.0.1:8787/mcp`.

## Package binding

After ChatGPT creates the developer connection, its non-secret technical ID begins with `plugin_asdk_app_`. The launcher can remember this mapping, or a developer can configure the local package explicitly:

```bash
npm run plugin:configure -- https://chatgpt.com/plugins/plugin_asdk_app_YOUR_CONNECTION_ID
```

Changing local package files does not silently update a ChatGPT account connection. Developer Mode, connection creation or refresh, and per-chat tool selection remain account-controlled.

## Current boundary

- ChatGPT reasons over admitted structured fields, annotations, and exact Core-retrieved passages. It does not receive unextracted PDF, book, code, or dataset bytes.
- Chunk 4 search is bounded deterministic plain-text retrieval. It does not add embeddings, semantic ranking, a desktop search control, or provider execution.
- The human-review boundary relies on a compliant MCP host honoring app-only tool visibility; it is not cryptographic user-attestation against a modified raw client.
- The local server does not call a model API. ChatGPT is the reasoning engine when the connection is selected.
- This private tunnel is not the public architecture. Public release requires hosted tenant isolation, OAuth, monitoring, security/privacy review, and marketplace review.
- The account connection observed during v0.4.0 preparation still exposed the older sleep-demo package. Refresh/rebind it before using that account as release evidence; local acceptance does not claim that account was upgraded.

## Compatibility boundary

The automated web-component and renderer compatibility gate currently runs bundled Chromium. It does not establish Firefox or WebKit compatibility. The headless release environment also cannot open a native Electron window, so the shipped main/preload contract is automated under instrumented host APIs while final native-window smoke remains a display-capable host check.
