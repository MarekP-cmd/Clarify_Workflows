// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startClarityPluginServer, type RunningClarityServer } from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'
import type {
  ClarityWorkspaceDocumentV1,
  HumanWorkspaceSaveInput,
  WorkspaceState,
} from '../src/types.js'

const temporaryDirectories: string[] = []
const stores: WorkspaceStore[] = []
const servers: RunningClarityServer[] = []
const clients: Client[] = []

afterEach(async () => {
  await Promise.all(clients.splice(0).map((client) => client.close().catch(() => undefined)))
  await Promise.all(servers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(stores.splice(0).map((store) => store.close().catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function structured<T>(result: unknown): T {
  return (result as { structuredContent: T }).structuredContent
}

function humanGraph(expectedRevision: number): HumanWorkspaceSaveInput {
  return {
    expectedRevision,
    name: 'Chunk 2 Human Graph',
    status: 'active',
    projects: [{
      id: 'project-human-graph',
      name: 'Human research project',
      description: 'A project created through the complete human workspace boundary.',
      status: 'active',
    }],
    nodes: [
      {
        id: 'paper-human-source',
        projectId: 'project-human-graph',
        kind: 'paper',
        title: 'Human evidence paper',
        description: 'Operator-authored source metadata for the Chunk 2 acceptance test.',
        schemaType: 'ScholarlyArticle',
        status: 'verified',
        tags: ['operator-source'],
        provenance: 'Created by the human operator during Chunk 2 acceptance',
        position: { x: 120, y: 180 },
        humanAnnotation: 'Use only the explicitly recorded source metadata.',
        priority: 'high',
        pinned: true,
        sourceUri: 'urn:clarity-test:paper-human-source',
      },
      {
        id: 'dataset-human-source',
        projectId: 'project-human-graph',
        kind: 'dataset',
        title: 'Human evidence dataset',
        description: 'Operator-authored dataset metadata for the Chunk 2 acceptance test.',
        schemaType: 'Dataset',
        status: 'verified',
        tags: ['operator-dataset'],
        provenance: 'Created by the human operator during Chunk 2 acceptance',
        position: { x: 480, y: 260 },
        evidenceCount: 1,
      },
    ],
    edges: [{
      id: 'edge-human-evidence',
      projectId: 'project-human-graph',
      source: 'paper-human-source',
      target: 'dataset-human-source',
      relation: 'tested by',
      color: '#4b86ef',
      dashed: false,
    }],
    annotations: [{
      id: 'annotation-human-evidence',
      nodeId: 'paper-human-source',
      author: 'human',
      body: 'This is a durable, first-class human annotation record.',
    }],
  }
}

function portableImport(): ClarityWorkspaceDocumentV1 {
  return {
    format: 'clarity-workspace',
    version: 1,
    exportedAt: '2026-08-11T12:00:00.000Z',
    name: 'Imported Human Workspace',
    status: 'archived',
    projects: [{
      id: 'project-imported',
      name: 'Imported project',
      description: 'Portable human project data.',
      status: 'archived',
    }],
    nodes: [{
      id: 'question-imported',
      projectId: 'project-imported',
      kind: 'question',
      title: 'Imported operator question',
      description: 'Portable human graph data.',
      schemaType: 'Question',
      status: 'candidate',
      tags: ['portable'],
      provenance: 'Imported from a human-owned Clarity document',
      position: { x: 50, y: 75 },
    }],
    edges: [],
    annotations: [{
      id: 'annotation-imported',
      nodeId: 'question-imported',
      author: 'human',
      body: 'Imported human note.',
    }],
  }
}

describe('Chunk 2 complete human graph workspace end to end', () => {
  it('persists human CRUD, blocks a stale desktop snapshot after MCP approval, and survives restart/import/archive/delete', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk2-human-e2e-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'clarity.sqlite3')
    const artifactDirectory = path.join(directory, 'artifacts')

    // An actual fresh Core is empty: test data is introduced only through the
    // same human-facing store boundary used by the Electron main process.
    const desktop = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    stores.push(desktop)
    await desktop.initialize()
    expect(await desktop.list()).toEqual([])
    await expect(desktop.read()).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' })

    const created = await desktop.create('Chunk 2 draft')
    expect(created).toMatchObject({ status: 'active', revision: 0, projects: [], nodes: [], edges: [] })
    expect(created.activities).toEqual([
      expect.objectContaining({ actor: 'human', action: 'created', entityType: 'workspace', entityId: created.id }),
    ])

    const staleHumanInput = humanGraph(created.revision)
    const humanSaved = await desktop.saveHumanWorkspace(created.id, staleHumanInput)
    expect(humanSaved).toMatchObject({
      name: 'Chunk 2 Human Graph',
      status: 'active',
      revision: 1,
    })
    expect(humanSaved.projects).toHaveLength(1)
    expect(humanSaved.nodes.map((node) => node.id).sort()).toEqual(['dataset-human-source', 'paper-human-source'])
    expect(humanSaved.edges).toEqual([expect.objectContaining({ id: 'edge-human-evidence', relation: 'tested by' })])
    expect(humanSaved.annotations).toEqual([
      expect.objectContaining({ id: 'annotation-human-evidence', author: 'human', workspaceId: created.id }),
    ])
    expect(humanSaved.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'updated', entityType: 'workspace', changedFields: ['name'] }),
      expect.objectContaining({ action: 'created', entityType: 'project', entityId: 'project-human-graph' }),
      expect.objectContaining({ action: 'created', entityType: 'node', entityId: 'paper-human-source' }),
      expect.objectContaining({ action: 'created', entityType: 'node', entityId: 'dataset-human-source' }),
      expect.objectContaining({ action: 'created', entityType: 'edge', entityId: 'edge-human-evidence' }),
      expect.objectContaining({ action: 'created', entityType: 'annotation', entityId: 'annotation-human-evidence' }),
    ]))

    // A byte-for-byte no-op save is not a fake edit: it creates neither a new
    // revision nor a misleading activity entry.
    const noOp = await desktop.saveHumanWorkspace(created.id, {
      expectedRevision: humanSaved.revision,
      name: humanSaved.name,
      status: humanSaved.status,
      projects: humanSaved.projects,
      nodes: humanSaved.nodes,
      edges: humanSaved.edges,
      annotations: humanSaved.annotations.filter((annotation) => annotation.author === 'human'),
    })
    expect(noOp.revision).toBe(humanSaved.revision)
    expect(noOp.activities).toEqual(humanSaved.activities)

    // Start a live MCP surface over a second SQLite connection to the exact
    // database currently held by the desktop store.
    const server = await startClarityPluginServer({
      databaseFile: databasePath,
      artifactDirectory,
      legacyJsonPaths: [],
      host: '127.0.0.1',
      port: 0,
    })
    servers.push(server)
    const client = new Client({ name: 'clarity-chunk2-human-e2e', version: '0.4.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
    clients.push(client)

    const fromMcp = structured<{ workspace: WorkspaceState }>(await client.callTool({
      name: 'get_clarity_workspace',
      arguments: { workspace_id: created.id },
    })).workspace
    expect(fromMcp).toMatchObject({ id: created.id, revision: humanSaved.revision })
    expect(fromMcp.projects).toEqual(humanSaved.projects)
    expect(fromMcp.annotations).toEqual(humanSaved.annotations)
    expect(fromMcp.activities).toEqual(humanSaved.activities)

    const prepared = structured<{ contextId: string }>(await client.callTool({
      name: 'prepare_workflow_context',
      arguments: {
        workspace_id: created.id,
        intent: 'Synthesize and pressure-test only the admitted human evidence nodes.',
        source_node_ids: ['paper-human-source', 'dataset-human-source'],
        gate_policy: { minimum_sources: 2, require_dataset: true },
      },
    }))
    const staged = structured<{ run: { id: string } }>(await client.callTool({
      name: 'stage_candidate_result',
      arguments: {
        context_id: prepared.contextId,
        title: 'Approved Chunk 2 result',
        synthesis: 'The admitted human paper and dataset metadata support a bounded test result without implying access to unrecorded file bytes.',
        hypothesis: 'The explicit human evidence relationship is suitable for a controlled follow-up test.',
        counterargument: 'The recorded metadata alone cannot establish the underlying result or causal direction.',
        pressure_test: 'Attach extractable source content later and compare the recorded claim against a held-out validation procedure.',
        decision: 'inconclusive',
        confidence: 0.54,
        evidence_node_ids: ['paper-human-source', 'dataset-human-source'],
      },
    }))
    const challenge = structured<{ approvalToken: string }>(await client.callTool({
      name: 'get_candidate_approval_challenge',
      arguments: { workspace_id: created.id, run_id: staged.run.id },
    }))
    const approved = structured<{ workspace: WorkspaceState; activeRun: { status: string } }>(await client.callTool({
      name: 'approve_candidate_result',
      arguments: { workspace_id: created.id, run_id: staged.run.id, approval_token: challenge.approvalToken },
    }))
    expect(approved.activeRun.status).toBe('committed')
    const committedNode = approved.workspace.nodes.find((node) => node.kind === 'result')
    expect(committedNode?.title).toBe('Approved Chunk 2 result')
    expect(approved.workspace.revision).toBeGreaterThan(humanSaved.revision)
    expect(approved.workspace.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ actor: 'ai', action: 'staged', entityType: 'workflow-run', entityId: staged.run.id }),
      expect.objectContaining({ actor: 'human', action: 'approved', entityType: 'approval' }),
    ]))

    // The exact stale desktop snapshot captured before MCP staging/approval
    // must be rejected before it can erase the committed result topology.
    await expect(desktop.saveHumanWorkspace(created.id, staleHumanInput))
      .rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    const afterStaleConflict = await desktop.read(created.id)
    expect(afterStaleConflict.nodes.some((node) => node.id === committedNode?.id)).toBe(true)
    expect(afterStaleConflict.runs.find((run) => run.id === staged.run.id)?.status).toBe('committed')
    expect(afterStaleConflict.approvals.find((approval) => approval.runId === staged.run.id)?.status).toBe('approved')

    // Even if a caller substitutes the latest revision into an old topology,
    // protected approved nodes and evidence edges still cannot be removed.
    await expect(desktop.saveHumanWorkspace(created.id, {
      ...staleHumanInput,
      expectedRevision: afterStaleConflict.revision,
    })).rejects.toMatchObject({ code: 'PROTECTED_STATE_CONFLICT' })

    const archived = await desktop.saveHumanWorkspace(created.id, {
      expectedRevision: afterStaleConflict.revision,
      name: afterStaleConflict.name,
      status: 'archived',
      projects: afterStaleConflict.projects.map((project) => ({ ...project, status: 'archived' })),
      nodes: afterStaleConflict.nodes,
      edges: afterStaleConflict.edges,
      annotations: afterStaleConflict.annotations.filter((annotation) => annotation.author === 'human'),
    })
    expect(archived.status).toBe('archived')
    expect(archived.projects[0].status).toBe('archived')
    expect(archived.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'updated', entityType: 'workspace', changedFields: ['status'] }),
      expect.objectContaining({ action: 'updated', entityType: 'project', entityId: 'project-human-graph', changedFields: ['status'] }),
    ]))

    const archivedFromMcp = structured<{ workspace: WorkspaceState }>(await client.callTool({
      name: 'get_clarity_workspace',
      arguments: { workspace_id: created.id },
    })).workspace
    expect(archivedFromMcp).toMatchObject({ status: 'archived', revision: archived.revision })

    await expect(desktop.saveHumanWorkspace(created.id, {
      expectedRevision: archived.revision,
      name: 'An archived workspace must not be renamed',
      status: 'archived',
      projects: archived.projects,
      nodes: archived.nodes,
      edges: archived.edges,
      annotations: archived.annotations.filter((annotation) => annotation.author === 'human'),
    })).rejects.toMatchObject({ code: 'WORKSPACE_ARCHIVED' })
    expect((await desktop.read(created.id))).toEqual(archived)

    const archivedPrepared = structured<{ contextId: string | null; preGate: { passed: boolean; issues: string[] } }>(await client.callTool({
      name: 'prepare_workflow_context',
      arguments: {
        workspace_id: created.id,
        intent: 'An archived workspace must remain read-only.',
        source_node_ids: ['paper-human-source', 'dataset-human-source'],
        gate_policy: { minimum_sources: 2, require_dataset: true },
      },
    }))
    expect(archivedPrepared.contextId).toBeNull()
    expect(archivedPrepared.preGate.passed).toBe(false)
    expect(archivedPrepared.preGate.issues).toContain('The workspace is archived and read-only until it is restored.')
    expect((await desktop.read(created.id))).toEqual(archived)

    const imported = await desktop.importWorkspaceDocument(portableImport())
    expect(imported.id).not.toBe(created.id)
    expect(imported).toMatchObject({ name: 'Imported Human Workspace', status: 'archived', revision: 0 })
    expect(imported.projects[0]).toMatchObject({ id: 'project-imported', workspaceId: imported.id })
    expect(imported.annotations[0]).toMatchObject({ id: 'annotation-imported', workspaceId: imported.id, author: 'human' })
    expect(imported).toMatchObject({ artifacts: [], workflowDefinitions: [], runs: [], gates: [], approvals: [] })
    expect(imported.activities).toEqual([
      expect.objectContaining({ actor: 'human', action: 'imported', entityType: 'workspace', entityId: imported.id }),
    ])

    await expect(desktop.deleteWorkspace(imported.id, imported.revision + 1))
      .rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    const deletedImport = await desktop.deleteWorkspace(imported.id, imported.revision)
    expect(deletedImport).toMatchObject({ workspaceId: imported.id, name: imported.name, deleted: true })
    await expect(desktop.read(imported.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })

    await client.close()
    clients.splice(clients.indexOf(client), 1)
    await server.close()
    servers.splice(servers.indexOf(server), 1)
    await desktop.close()
    stores.splice(stores.indexOf(desktop), 1)

    // A fresh process-equivalent Core instance must rehydrate the complete
    // human graph plus committed MCP history and archive/activity state.
    const restarted = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    stores.push(restarted)
    await restarted.initialize()
    const durable = await restarted.read(created.id)
    expect(durable).toMatchObject({ status: 'archived', revision: archived.revision })
    expect(durable.projects).toEqual(archived.projects)
    expect(durable.nodes).toEqual(archived.nodes)
    expect(durable.edges).toEqual(archived.edges)
    expect(durable.annotations).toEqual(archived.annotations)
    expect(durable.activities).toEqual(archived.activities)
    expect(durable.runs.find((run) => run.id === staged.run.id)?.status).toBe('committed')
    expect(durable.approvals.find((approval) => approval.runId === staged.run.id)?.status).toBe('approved')

    await restarted.deleteWorkspace(durable.id, durable.revision)
    await restarted.close()
    stores.splice(stores.indexOf(restarted), 1)

    const finalRestart = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    stores.push(finalRestart)
    await finalRestart.initialize()
    expect(await finalRestart.list()).toEqual([])
    await expect(finalRestart.read()).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' })
  })
})
