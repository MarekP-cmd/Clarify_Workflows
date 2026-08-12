import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import {
  CLARITY_TOOL_COUNT,
  CLARITY_UI_URI,
  CLARITY_VERSION,
  startClarityPluginServer,
} from '../dist/server.js'
import { createTemporaryTestWorkspace, TEST_SOURCE_IDS } from './test-fixture.mjs'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-plugin-e2e-'))
let running
let client

function structured(result) {
  assert(result && typeof result === 'object' && 'structuredContent' in result)
  return result.structuredContent
}

async function status() {
  const response = await fetch(running.integrationUrl)
  assert.equal(response.status, 200)
  return response.json()
}

try {
  const databaseFile = await createTemporaryTestWorkspace(temporaryDirectory)
  running = await startClarityPluginServer({
    databaseFile,
    artifactDirectory: path.join(temporaryDirectory, 'artifacts'),
    legacyJsonPaths: [],
    host: '127.0.0.1',
    port: 0,
  })

  const local = await status()
  assert.equal(local.version, CLARITY_VERSION)
  assert.equal(local.phase, 'local_ready')
  assert.equal(local.expectedToolCount, CLARITY_TOOL_COUNT)
  assert.equal(local.toolCallObserved, false)

  client = new Client({ name: 'clarity-chatgpt-e2e', version: CLARITY_VERSION })
  await client.connect(new StreamableHTTPClientTransport(new URL(running.mcpUrl)))

  const listed = await client.listTools()
  assert.equal(listed.tools.length, CLARITY_TOOL_COUNT)
  const approveTool = listed.tools.find((tool) => tool.name === 'approve_candidate_result')
  assert.deepEqual(approveTool?._meta?.ui?.visibility, ['app'])

  const protocolConnected = await status()
  assert.equal(protocolConnected.phase, 'mcp_reached')
  assert(protocolConnected.successfulMcpRequests > 0)

  const resource = await client.readResource({ uri: CLARITY_UI_URI })
  assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app')
  assert.match(resource.contents[0]?.text ?? '', /Clarity Workflows/)

  const workspaceResult = await client.callTool({ name: 'get_clarity_workspace', arguments: {} })
  const initialWorkspace = structured(workspaceResult).workspace
  const initialNodeCount = initialWorkspace.nodes.length

  const prepareResult = await client.callTool({
    name: 'prepare_workflow_context',
    arguments: {
      workspace_id: initialWorkspace.id,
      intent: 'Synthesize and pressure-test the storage hypothesis before producing a bounded coding recommendation.',
      source_node_ids: [TEST_SOURCE_IDS.paper, TEST_SOURCE_IDS.dataset],
      gate_policy: { minimum_sources: 2, require_dataset: true },
    },
  })
  const prepared = structured(prepareResult)
  assert.equal(prepared.preGate.passed, true)
  assert.equal(prepared.sources.length, 2)

  const stageResult = await client.callTool({
    name: 'stage_candidate_result',
    arguments: {
      context_id: prepared.contextId,
      title: 'E2E storage congestion result',
      synthesis: 'The admitted synthetic paper and dataset support a bounded association between storage availability and congestion outcomes.',
      hypothesis: 'Targeted storage dispatch reduces peak congestion for the tested fixture conditions.',
      counterargument: 'Demand composition may explain the association without a storage-driven causal effect.',
      pressure_test: 'Stratify by demand regime and compare held-out congestion outcomes against a no-storage baseline.',
      decision: 'mixed',
      confidence: 0.68,
      evidence_node_ids: [TEST_SOURCE_IDS.paper, TEST_SOURCE_IDS.dataset],
      code_output: 'Fit a deterministic interaction model with held-out validation against the fixture rows.',
    },
  })
  const staged = structured(stageResult)
  assert.equal(staged.postGate.passed, true)
  assert.equal(staged.run.status, 'awaiting_approval')

  const rendered = structured(await client.callTool({
    name: 'render_clarity_workflow',
    arguments: { workspace_id: initialWorkspace.id, run_id: staged.run.id },
  }))
  assert.equal(rendered.activeRun.status, 'awaiting_approval')
  assert.equal(rendered.workspace.nodes.length, initialNodeCount)

  const challenge = structured(await client.callTool({
    name: 'get_candidate_approval_challenge',
    arguments: { workspace_id: initialWorkspace.id, run_id: staged.run.id },
  }))
  assert(challenge.approvalToken.length > 20)

  const invalidApproval = await client.callTool({
    name: 'approve_candidate_result',
    arguments: { workspace_id: initialWorkspace.id, run_id: staged.run.id, approval_token: 'invalid-human-approval-token' },
  })
  assert.equal(invalidApproval.isError, true)
  assert.match(invalidApproval.content[0]?.text ?? '', /INVALID_APPROVAL/)

  const afterInvalidApproval = structured(await client.callTool({
    name: 'get_clarity_workspace',
    arguments: {},
  })).workspace
  assert.equal(afterInvalidApproval.nodes.length, initialNodeCount)

  const approved = structured(await client.callTool({
    name: 'approve_candidate_result',
    arguments: { workspace_id: initialWorkspace.id, run_id: staged.run.id, approval_token: challenge.approvalToken },
  }))
  assert.equal(approved.activeRun.status, 'committed')
  assert.equal(approved.workspace.nodes.length, initialNodeCount + 1)

  const complete = await status()
  assert.equal(complete.phase, 'tool_called')
  assert.equal(complete.toolCallObserved, true)
  assert.equal(complete.lastToolName, 'approve_candidate_result')
  assert.equal(complete.toolCalls, 7)
  assert.equal(complete.failedToolCalls, 1)
  assert.equal(complete.toolCallAttempts, 8)

  console.log(
    `Clarity end-to-end test passed: ${listed.tools.length} tools, MCP Apps UI, two gates, invalid-approval defense, and human-approved graph commit.`,
  )
} finally {
  await client?.close().catch(() => undefined)
  await running?.close().catch(() => undefined)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
