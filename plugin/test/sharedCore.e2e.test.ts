// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startClarityPluginServer, type RunningClarityServer } from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'
import { fixtureEdges, fixtureNodes, SOURCE_IDS } from './fixtures.js'

const temporaryDirectories: string[] = []
const runningServers: RunningClarityServer[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
  await Promise.all(runningServers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function structured<T>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent
}

describe('shared Clarity Core end to end', () => {
  it('keeps desktop and ChatGPT on the same durable graph in both directions', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-shared-core-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'clarity.sqlite3')
    const artifactDirectory = path.join(directory, 'artifacts')

    // This connection represents the Electron main process creating a real graph.
    const desktop = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    await desktop.initialize()
    const created = await desktop.create('Operator Workspace')
    const desktopGraph = await desktop.replaceGraph(created.id, fixtureNodes, fixtureEdges)
    await desktop.close()

    // This server represents the separately running ChatGPT MCP process.
    const server = await startClarityPluginServer({ databaseFile: databasePath, artifactDirectory, legacyJsonPaths: [], host: '127.0.0.1', port: 0 })
    runningServers.push(server)
    const client = new Client({ name: 'clarity-shared-core-e2e', version: '0.4.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
    clients.push(client)

    const opened = structured<{ workspace: typeof desktopGraph }>(await client.callTool({
      name: 'get_clarity_workspace',
      arguments: { workspace_id: created.id },
    })).workspace
    expect(opened.nodes).toEqual(desktopGraph.nodes)
    expect(opened.edges).toEqual(desktopGraph.edges)

    // A second desktop connection changes the database while MCP remains live.
    const liveDesktop = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    await liveDesktop.initialize()
    const staleHumanSnapshot = await liveDesktop.mutate(created.id, (workspace) => {
      workspace.nodes.push({
        id: 'question-operator-created',
        kind: 'question',
        title: 'Which scenario should be tested next?',
        description: 'A human-authored work item added after ChatGPT connected.',
        schemaType: 'Question',
        status: 'candidate',
        tags: [],
        provenance: 'Created by the human operator in the desktop application',
        position: { x: 720, y: 320 },
      })
    })
    await liveDesktop.close()

    const refreshed = structured<{ workspace: { nodes: Array<{ id: string }> } }>(await client.callTool({
      name: 'get_clarity_workspace',
      arguments: { workspace_id: created.id },
    })).workspace
    expect(refreshed.nodes.map((node) => node.id)).toContain('question-operator-created')

    const prepared = structured<{ contextId: string }>(await client.callTool({
      name: 'prepare_workflow_context',
      arguments: {
        workspace_id: created.id,
        intent: 'Synthesize and pressure-test the admitted reliability evidence.',
        source_node_ids: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
        gate_policy: { minimum_sources: 2, require_dataset: true },
      },
    }))
    const staged = structured<{ run: { id: string } }>(await client.callTool({
      name: 'stage_candidate_result',
      arguments: {
        context_id: prepared.contextId,
        title: 'Reliability candidate',
        synthesis: 'The admitted synthetic paper and dataset support a bounded relationship between storage and reliability outcomes.',
        hypothesis: 'Targeted storage dispatch may reduce peak congestion under the admitted fixture conditions.',
        counterargument: 'Demand composition could explain the observed relationship without a storage-driven effect.',
        pressure_test: 'Stratify by demand regime and compare held-out outcomes against a no-storage baseline.',
        decision: 'mixed',
        confidence: 0.68,
        evidence_node_ids: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      },
    }))
    const challenge = structured<{ approvalToken: string }>(await client.callTool({
      name: 'get_candidate_approval_challenge',
      arguments: { workspace_id: created.id, run_id: staged.run.id },
    }))
    await client.callTool({
      name: 'approve_candidate_result',
      arguments: { workspace_id: created.id, run_id: staged.run.id, approval_token: challenge.approvalToken },
    })

    // The human editor still holds the pre-approval graph. Its stale save must
    // fail before it can erase the newly approved result or its evidence edges.
    const staleDesktop = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    await staleDesktop.initialize()
    await expect(staleDesktop.saveHumanWorkspace(created.id, {
      expectedRevision: staleHumanSnapshot.revision,
      name: staleHumanSnapshot.name,
      status: staleHumanSnapshot.status,
      projects: staleHumanSnapshot.projects,
      nodes: staleHumanSnapshot.nodes,
      edges: staleHumanSnapshot.edges,
      annotations: staleHumanSnapshot.annotations.filter((annotation): annotation is typeof annotation & { author: 'human' } => annotation.author === 'human'),
    })).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    const afterConflict = await staleDesktop.read(created.id)
    expect(afterConflict.nodes.some((node) => node.kind === 'result' && node.title === 'Reliability candidate')).toBe(true)
    expect(afterConflict.runs.find((run) => run.id === staged.run.id)?.status).toBe('committed')
    expect(afterConflict.approvals.find((approval) => approval.runId === staged.run.id)?.status).toBe('approved')
    await staleDesktop.close()

    await client.close()
    clients.splice(clients.indexOf(client), 1)
    await server.close()
    runningServers.splice(runningServers.indexOf(server), 1)

    // A fresh desktop process sees the ChatGPT commit after both processes restart.
    const restartedDesktop = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    await restartedDesktop.initialize()
    const finalWorkspace = await restartedDesktop.read(created.id)
    expect(finalWorkspace.nodes.map((node) => node.id)).toContain('question-operator-created')
    expect(finalWorkspace.nodes.some((node) => node.kind === 'result' && node.title === 'Reliability candidate')).toBe(true)
    expect(finalWorkspace.runs.find((run) => run.id === staged.run.id)?.status).toBe('committed')
    expect(finalWorkspace.approvals.find((approval) => approval.runId === staged.run.id)?.status).toBe('approved')
    await restartedDesktop.close()
  })
})
