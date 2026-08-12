// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CLARITY_INTEGRATION_STATUS_PATH,
  CLARITY_TOOL_COUNT,
  CLARITY_UI_URI,
  CLARITY_VERSION,
  startClarityPluginServer,
  type RunningClarityServer,
} from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'
import { populateFixtureWorkspace, SOURCE_IDS } from './fixtures.js'

const temporaryDirectories: string[] = []
const runningServers: RunningClarityServer[] = []
const clients: Client[] = []
const OPERATOR_NOTE = 'Exact desktop-authored note admitted to the bounded MCP context.'

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
  await Promise.all(runningServers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function startServerHarness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-plugin-mcp-'))
  temporaryDirectories.push(directory)
  const databasePath = path.join(directory, 'clarity.sqlite3')
  const store = new WorkspaceStore({ databasePath, artifactDirectory: path.join(directory, 'artifacts'), legacyJsonPaths: [] })
  await store.initialize()
  const workspace = await populateFixtureWorkspace(store)
  await store.mutate(workspace.id, (current) => {
    current.annotations.push({
      id: 'annotation-operator-mcp-context',
      workspaceId: current.id,
      nodeId: SOURCE_IDS.paper,
      author: 'human',
      body: OPERATOR_NOTE,
      createdAt: current.updatedAt,
      updatedAt: current.updatedAt,
    })
  })
  await store.close()
  const server = await startClarityPluginServer({
    dataFile: databasePath,
    host: '127.0.0.1',
    port: 0,
  })
  runningServers.push(server)
  return server
}

async function connectHarnessClient(server: RunningClarityServer) {
  const client = new Client({ name: 'clarity-plugin-tests', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
  clients.push(client)
  return client
}

async function startHarness() {
  const server = await startServerHarness()
  const client = await connectHarnessClient(server)
  return { server, client }
}

function structured<T>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent
}

describe('Clarity MCP server', () => {
  it('advertises focused tools, accurate safety annotations, and an MCP Apps resource', async () => {
    const { server, client } = await startHarness()
    const health = await fetch(`http://${server.host}:${server.port}/healthz`)
    expect(health.status).toBe(200)
    expect(await health.json()).toMatchObject({
      status: 'ok',
      version: CLARITY_VERSION,
      mcp: '/mcp',
      integration: CLARITY_INTEGRATION_STATUS_PATH,
      expectedToolCount: CLARITY_TOOL_COUNT,
    })

    const listed = await client.listTools()
    const names = listed.tools.map((tool) => tool.name)
    expect(names).toEqual(expect.arrayContaining([
      'get_clarity_workspace',
      'inspect_clarity_node',
      'list_workspace_artifacts',
      'get_extracted_artifact_content',
      'search_clarity_workspace',
      'retrieve_search_passage',
      'admit_search_citations',
      'prepare_workflow_context',
      'stage_candidate_result',
      'render_clarity_workflow',
      'get_candidate_approval_challenge',
      'approve_candidate_result',
      'reject_candidate_result',
    ]))

    expect(listed.tools.find((tool) => tool.name === 'get_clarity_workspace')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    })
    expect(listed.tools.find((tool) => tool.name === 'stage_candidate_result')?.annotations).toMatchObject({
      readOnlyHint: false,
      openWorldHint: false,
      destructiveHint: false,
    })
    expect(listed.tools.find((tool) => tool.name === 'approve_candidate_result')?._meta).toMatchObject({
      ui: { resourceUri: CLARITY_UI_URI, visibility: ['app'] },
    })

    const resource = await client.readResource({ uri: CLARITY_UI_URI })
    expect(resource.contents[0]?.mimeType).toBe('text/html;profile=mcp-app')
    expect(resource.contents[0]?.text).toContain('Clarity Workflows')
    expect(resource.contents[0]?.text).toContain("rpcRequest('ui/initialize'")
    expect(resource.contents[0]?.text).toContain("rpcRequest('tools/call'")
    expect(resource.contents[0]?.text).not.toContain('localStorage')
  })

  it('executes the complete protocol flow and keeps approval app-only', async () => {
    const { client } = await startHarness()
    const workspaceResult = await client.callTool({ name: 'get_clarity_workspace', arguments: {} })
    const workspace = structured<{ workspace: { id: string; nodes: unknown[]; edges: unknown[] } }>(workspaceResult).workspace
    const initialNodeCount = workspace.nodes.length

    const prepareResult = await client.callTool({
      name: 'prepare_workflow_context',
      arguments: {
        workspace_id: workspace.id,
        intent: 'Synthesize and pressure-test the storage hypothesis.',
        source_node_ids: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
        gate_policy: { minimum_sources: 2, require_dataset: true },
      },
    })
    const prepared = structured<{
      contextId: string
      preGate: { passed: boolean }
      sources: unknown[]
      annotations: Array<{ body: string }>
      annotationCount: number
      annotationsTruncated: boolean
    }>(prepareResult)
    expect(prepared.preGate.passed).toBe(true)
    expect(prepared.sources).toHaveLength(2)
    expect(prepared.annotations).toEqual([expect.objectContaining({ body: OPERATOR_NOTE })])
    expect(prepared.annotationCount).toBe(1)
    expect(prepared.annotationsTruncated).toBe(false)

    const stageResult = await client.callTool({
      name: 'stage_candidate_result',
      arguments: {
        context_id: prepared.contextId,
        title: 'Storage congestion result',
        synthesis: 'The selected synthetic paper and dataset support a bounded association between storage and congestion outcomes.',
        hypothesis: 'Targeted storage dispatch reduces peak congestion for the tested fixture conditions.',
        counterargument: 'Demand composition may explain the observed association without a storage-driven effect.',
        pressure_test: 'Stratify by demand regime and compare held-out congestion outcomes against a no-storage baseline.',
        decision: 'mixed',
        confidence: 0.68,
        evidence_node_ids: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
        code_output: 'Fit a deterministic interaction model against the admitted fixture rows.',
      },
    })
    const staged = structured<{ run: { id: string; status: string }; postGate: { passed: boolean } }>(stageResult)
    expect(staged.postGate.passed).toBe(true)
    expect(staged.run.status).toBe('awaiting_approval')

    const renderResult = await client.callTool({
      name: 'render_clarity_workflow',
      arguments: { workspace_id: workspace.id, run_id: staged.run.id },
    })
    const rendered = structured<{ activeRun: { status: string }; workspace: { nodes: unknown[] } }>(renderResult)
    expect(rendered.activeRun.status).toBe('awaiting_approval')
    expect(rendered.workspace.nodes).toHaveLength(initialNodeCount)

    const challengeResult = await client.callTool({
      name: 'get_candidate_approval_challenge',
      arguments: { workspace_id: workspace.id, run_id: staged.run.id },
    })
    const challenge = structured<{ approvalToken: string }>(challengeResult)
    expect(challenge.approvalToken.length).toBeGreaterThan(20)

    const approvalResult = await client.callTool({
      name: 'approve_candidate_result',
      arguments: { workspace_id: workspace.id, run_id: staged.run.id, approval_token: challenge.approvalToken },
    })
    const approved = structured<{ activeRun: { status: string }; workspace: { nodes: unknown[] } }>(approvalResult)
    expect(approved.activeRun.status).toBe('committed')
    expect(approved.workspace.nodes).toHaveLength(initialNodeCount + 1)
  })

  it('returns bounded tool errors for invalid identifiers', async () => {
    const { client } = await startHarness()
    const result = await client.callTool({
      name: 'inspect_clarity_node',
      arguments: { node_id: 'does-not-exist' },
    })
    expect(result.isError).toBe(true)
    expect((result.content[0] as { text: string }).text).toContain('NODE_NOT_FOUND')
  })

  it('keeps bounded run and approval output relationally valid after more than twenty runs', async () => {
    const { server, client } = await startHarness()
    const workspace = await server.service.getWorkspace()
    for (let index = 0; index < 21; index += 1) {
      const prepared = await server.service.prepareContext({
        workspaceId: workspace.id,
        intent: `Bounded MCP output run ${index}.`,
        sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
        policy: { minimumSources: 2, requireDataset: true },
      })
      await server.service.stageCandidate(prepared.contextId!, {
        title: `Bounded candidate ${index}`,
        synthesis: 'The admitted fixture evidence supports a bounded candidate used to validate relational MCP output truncation.',
        hypothesis: 'Run and approval output remain internally consistent under bounded retrieval.',
        counterargument: 'Naive independent array truncation can create invalid foreign-key references.',
        pressureTest: 'Create more than twenty runs, fetch through MCP, and validate every approval against a returned run.',
        decision: 'mixed',
        confidence: 0.5,
        evidenceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      })
    }

    const result = await client.callTool({ name: 'get_clarity_workspace', arguments: { workspace_id: workspace.id } })
    expect(result.isError).not.toBe(true)
    const bounded = structured<{ workspace: { runs: Array<{ id: string }>; approvals: Array<{ runId: string }> } }>(result).workspace
    expect(bounded.runs).toHaveLength(20)
    expect(bounded.approvals).toHaveLength(20)
    const runIds = new Set(bounded.runs.map((run) => run.id))
    expect(bounded.approvals.every((approval) => runIds.has(approval.runId))).toBe(true)
  })

  it('reports real MCP traffic and completed tool calls for the one-click verifier', async () => {
    const server = await startServerHarness()
    const before = await fetch(server.integrationUrl).then((response) => response.json()) as {
      phase: string
      mcpRequests: number
      toolCalls: number
      toolCallAttempts: number
      failedToolCalls: number
      lastToolName: string | null
    }
    expect(before.phase).toBe('local_ready')
    expect(before.mcpRequests).toBe(0)
    expect(before.toolCalls).toBe(0)
    expect(before.toolCallAttempts).toBe(0)
    expect(before.failedToolCalls).toBe(0)

    const client = await connectHarnessClient(server)
    await client.listTools()
    const connected = await fetch(server.integrationUrl).then((response) => response.json()) as {
      phase: string
      expectedToolCount: number
      mcpRequests: number
      successfulMcpRequests: number
      toolCalls: number
      toolCallAttempts: number
      failedToolCalls: number
    }
    expect(connected.phase).toBe('mcp_reached')
    expect(connected.expectedToolCount).toBe(CLARITY_TOOL_COUNT)
    expect(connected.mcpRequests).toBeGreaterThan(0)
    expect(connected.successfulMcpRequests).toBeGreaterThan(0)
    expect(connected.toolCalls).toBe(0)
    expect(connected.toolCallAttempts).toBe(0)

    const failedResult = await client.callTool({
      name: 'inspect_clarity_node',
      arguments: { node_id: 'does-not-exist' },
    })
    expect(failedResult.isError).toBe(true)

    const failed = await fetch(server.integrationUrl).then((response) => response.json()) as {
      phase: string
      toolCallObserved: boolean
      toolCallFailureObserved: boolean
      toolCalls: number
      toolCallAttempts: number
      failedToolCalls: number
      lastToolName: string | null
      lastFailedToolName: string | null
    }
    expect(failed.phase).toBe('tool_failed')
    expect(failed.toolCallObserved).toBe(false)
    expect(failed.toolCallFailureObserved).toBe(true)
    expect(failed.toolCalls).toBe(0)
    expect(failed.toolCallAttempts).toBe(1)
    expect(failed.failedToolCalls).toBe(1)
    expect(failed.lastToolName).toBeNull()
    expect(failed.lastFailedToolName).toBe('inspect_clarity_node')

    await client.callTool({ name: 'get_clarity_workspace', arguments: {} })

    const after = await fetch(server.integrationUrl).then((response) => response.json()) as {
      status: string
      version: string
      phase: string
      toolCallObserved: boolean
      mcpRequests: number
      successfulMcpRequests: number
      toolCalls: number
      toolCallAttempts: number
      failedToolCalls: number
      lastToolName: string | null
      lastToolCallAt: string | null
    }
    expect(after.status).toBe('ok')
    expect(after.version).toBe(CLARITY_VERSION)
    expect(after.phase).toBe('tool_called')
    expect(after.toolCallObserved).toBe(true)
    expect(after.mcpRequests).toBeGreaterThan(before.mcpRequests)
    expect(after.successfulMcpRequests).toBeGreaterThan(0)
    expect(after.toolCalls).toBe(before.toolCalls + 1)
    expect(after.toolCallAttempts).toBe(2)
    expect(after.failedToolCalls).toBe(1)
    expect(after.lastToolName).toBe('get_clarity_workspace')
    expect(after.lastToolCallAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
  })
})
