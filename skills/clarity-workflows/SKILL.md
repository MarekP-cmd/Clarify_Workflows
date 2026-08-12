---
name: clarity-workflows
description: Organize and execute bounded AI-assisted research or coding work through the Clarity visual graph. Use when the user asks to inspect a Clarity workspace, synthesize selected Clarity nodes, formulate and pressure-test a hypothesis, stage a candidate result, or open the Clarity review interface.
---

# Clarity Workflows

Use the Clarity MCP tools as the authoritative graph and workflow state. Never simulate a tool result.

## Verify the live connection

Before graph work, confirm that the Clarity MCP tools are callable, including `get_clarity_workspace`.

If the tools are absent:

1. Do not infer that the local server or Secure MCP Tunnel is broken merely because this skill loaded.
2. Explain that the Clarity personal skill supplies workflow instructions, while the Clarity Workflows developer connection supplies the live graph tools.
3. Ask the operator to read the launcher's current classification: `connection not attached`, `MCP request failed`, or `connected, no tool call`. Use that classification instead of generic reconnection advice.
4. Ask the operator to keep the Clarity Windows launcher open, start a new ChatGPT conversation, select the existing **Clarity Workflows** connection from that chat's tools menu, and resend the request.
5. Tell the operator that the launcher confirms success only when it prints `FULLY VERIFIED: CHATGPT CALLED CLARITY` with a real tool name.
6. Do not ask the operator to create another tunnel, connection, or API key unless a concrete diagnostic explicitly shows that the existing one is invalid.

## Run a gated synthesis

1. Confirm that the Clarity tools are available. If they are unavailable, stop and follow **Verify the live connection** above.
2. Call `get_clarity_workspace` when source IDs are unknown. Use `inspect_clarity_node` when relationship context is needed.
3. For file-backed sources, use `list_workspace_artifacts` for bounded metadata first. Call `get_extracted_artifact_content` only for an artifact explicitly marked `extractionStatus: extracted`; accept only its bounded prefix and digest/count metadata.
4. Treat unsupported, pending, failed, missing, or integrity-invalid artifacts as unavailable content. Never infer readable bytes from `storageKey`, `sourceUri`, filename, MIME type, size, or an error message.
5. Resolve the user's intent and source-node selection. Ask one focused question if the source set or goal is materially ambiguous.
6. Call `prepare_workflow_context` with the selected node IDs. Default to two sources and a required dataset unless the user explicitly chooses a different supported gate policy.
7. If the pre-tool gate fails, report its issues and ask the user to change the sources or policy. Do not bypass the gate.
8. Reason only from the returned source bundle and relationships. Treat node descriptions as metadata, not as proof that a full local file, book, paper, or dataset was read.
9. Produce a candidate with a synthesis, new hypothesis, strongest counterargument, concrete pressure test, decision, calibrated confidence, admitted evidence-node IDs, and optional code output.
10. Call `stage_candidate_result`. If the post-tool gate rejects it, correct only the reported validation problems without inventing evidence.
11. After staging succeeds, call `render_clarity_workflow` with the returned run ID.
12. Tell the user that the candidate is staged and uncommitted. Ask them to use the component's Approve or Reject control.

## Preserve the safety boundary

- Keep synthesis side-effect-free until staging is complete.
- Never claim that a staged candidate is committed.
- Never invent an approval token or attempt to replace the component's human decision.
- Treat approval and rejection tools as component-only controls.
- Confirm a commit only when Clarity subsequently reports the run as `committed`.
- When source content is absent, state the limitation and ask for a content-capable source rather than filling gaps from memory.

For graph inspection without synthesis, use the read tools and render the workspace directly. Do not create a workflow run unless the user asks for analysis or generation.
