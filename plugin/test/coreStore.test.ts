// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { CLARITY_DATABASE_SCHEMA_VERSION, WorkspaceStore } from '../src/store.js'
import type { LegacyWorkspaceV1 } from '../src/types.js'
import { fixtureCandidate, fixtureEdges, fixtureNodes } from './fixtures.js'

const temporaryDirectories: string[] = []
const stores: WorkspaceStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close().catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-core-store-'))
  temporaryDirectories.push(directory)
  return directory
}

function createStore(
  directory: string,
  legacyJsonPaths: string[] = [],
  removeArtifactDirectory?: (directory: string) => Promise<void>,
) {
  const store = new WorkspaceStore({
    databasePath: path.join(directory, 'clarity.sqlite3'),
    artifactDirectory: path.join(directory, 'artifacts'),
    legacyJsonPaths,
    removeArtifactDirectory,
  })
  stores.push(store)
  return store
}

function legacyWorkspace(overrides: Partial<LegacyWorkspaceV1> = {}): LegacyWorkspaceV1 {
  return {
    version: 1,
    id: 'legacy-operator-workspace',
    name: 'Imported Operator Workspace',
    schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
    nodes: structuredClone(fixtureNodes),
    edges: structuredClone(fixtureEdges),
    runs: [],
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('Clarity Core SQLite store', () => {
  it('starts empty and shares authoritative graph changes across independent desktop/MCP connections and restarts', async () => {
    const directory = await createDirectory()
    const desktopStore = createStore(directory)
    const mcpStore = createStore(directory)
    await desktopStore.initialize()
    await mcpStore.initialize()

    expect(await desktopStore.list()).toEqual([])
    await expect(desktopStore.read()).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' })

    const workspace = await desktopStore.create('Operator Workspace')
    await desktopStore.replaceGraph(workspace.id, fixtureNodes, fixtureEdges)
    const fromMcp = await mcpStore.read(workspace.id)
    expect(fromMcp.name).toBe('Operator Workspace')
    expect(fromMcp.nodes.map((node) => node.id).sort()).toEqual(fixtureNodes.map((node) => node.id).sort())

    await mcpStore.mutate(workspace.id, (current) => {
      current.nodes[0].humanAnnotation = 'Added through the second Clarity Core connection.'
    })
    expect((await desktopStore.read(workspace.id)).nodes[0].humanAnnotation).toContain('second Clarity Core connection')

    await desktopStore.close()
    stores.splice(stores.indexOf(desktopStore), 1)
    const reopened = createStore(directory)
    await reopened.initialize()
    expect((await reopened.read(workspace.id)).nodes).toHaveLength(fixtureNodes.length)
  })

  it('rolls back an invalid graph replacement without losing the previous graph', async () => {
    const directory = await createDirectory()
    const store = createStore(directory)
    const workspace = await store.create('Rollback Workspace')
    await store.replaceGraph(workspace.id, fixtureNodes, fixtureEdges)
    const before = await store.read(workspace.id)

    await expect(store.replaceGraph(workspace.id, fixtureNodes, [
      ...fixtureEdges,
      { id: 'dangling-edge', source: fixtureNodes[0].id, target: 'missing-node', relation: 'invalid' },
    ])).rejects.toThrow(/missing node/i)

    const after = await store.read(workspace.id)
    expect(after.nodes).toEqual(before.nodes)
    expect(after.edges).toEqual(before.edges)
  })

  it('imports a legitimate v1 workspace once but refuses the bundled demonstration workspace', async () => {
    const importedDirectory = await createDirectory()
    const legacyPath = path.join(importedDirectory, 'workspace.json')
    await writeFile(legacyPath, JSON.stringify(legacyWorkspace()), 'utf8')
    const importedStore = createStore(importedDirectory, [legacyPath])
    await importedStore.initialize()
    const summaries = await importedStore.list()
    expect(summaries).toHaveLength(1)
    expect(summaries[0].name).toBe('Imported Operator Workspace')
    expect((await importedStore.read(summaries[0].id)).version).toBe(2)

    const demoDirectory = await createDirectory()
    const demoPath = path.join(demoDirectory, 'workspace.json')
    await writeFile(demoPath, JSON.stringify(legacyWorkspace({
      id: 'clarity-default',
      name: 'Clarity Workflows — Research Graph',
    })), 'utf8')
    const demoStore = createStore(demoDirectory, [demoPath])
    await demoStore.initialize()
    expect(await demoStore.list()).toEqual([])
  })

  it('retries a corrected legacy file at the same path when its digest changes', async () => {
    const directory = await createDirectory()
    const legacyPath = path.join(directory, 'workspace.json')
    await writeFile(legacyPath, '{ malformed legacy json', 'utf8')
    const first = createStore(directory, [legacyPath])
    await first.initialize()
    expect(await first.list()).toEqual([])
    await first.close()
    stores.splice(stores.indexOf(first), 1)

    await writeFile(legacyPath, JSON.stringify(legacyWorkspace()), 'utf8')
    const corrected = createStore(directory, [legacyPath])
    await corrected.initialize()
    expect(await corrected.list()).toEqual([expect.objectContaining({ id: 'legacy-operator-workspace', name: 'Imported Operator Workspace' })])
  })

  it('copies real bytes into managed artifact storage and persists their immutable digest', async () => {
    const directory = await createDirectory()
    const sourcePath = path.join(directory, 'operator-notes.txt')
    const contents = 'Actual operator-owned bytes for the Clarity Core artifact test.\n'
    await writeFile(sourcePath, contents, 'utf8')
    const store = createStore(directory)
    const workspace = await store.create('Artifact Workspace')
    await store.replaceGraph(workspace.id, [fixtureNodes[0]], [])

    const artifact = await store.addArtifactFromFile(workspace.id, sourcePath, {
      nodeId: fixtureNodes[0].id,
      mimeType: 'text/plain',
    })
    expect(artifact.sha256).toBe(createHash('sha256').update(contents).digest('hex'))
    expect(await readFile(store.resolveArtifactPath(artifact), 'utf8')).toBe(contents)
    expect((await store.read(workspace.id)).artifacts).toEqual([artifact])
  })

  it('serializes concurrent mutations without stale-cache overwrite', async () => {
    const directory = await createDirectory()
    const first = createStore(directory)
    const second = createStore(directory)
    const workspace = await first.create('Concurrent Workspace')
    await Promise.all(Array.from({ length: 20 }, (_, index) => (
      (index % 2 ? first : second).mutate(workspace.id, (current) => {
        const timestamp = new Date(Date.parse(current.createdAt) + index + 1).toISOString()
        current.projects.push({
          id: `project-${index}`,
          workspaceId: current.id,
          name: `Project ${index}`,
          description: 'Concurrent mutation fixture',
          status: 'active',
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      })
    )))
    expect((await first.read(workspace.id)).projects).toHaveLength(20)
    expect((await second.read(workspace.id)).projects).toHaveLength(20)
  })

  it('migrates a schema-v1 database to active revisioned workspaces with durable activity storage', async () => {
    const directory = await createDirectory()
    const original = createStore(directory)
    const created = await original.create('Migration Target')
    await original.replaceGraph(created.id, fixtureNodes, fixtureEdges)
    const legacyRunTimestamp = new Date(Date.parse(created.createdAt) + 1_000).toISOString()
    await original.mutate(created.id, (workspace) => {
      workspace.runs.push({
        id: 'run-pre-chunk2-pending',
        workspaceId: workspace.id,
        contextId: 'context-without-evidence-revision',
        intent: 'This pending review must not survive migration as actionable.',
        sourceNodeIds: fixtureCandidate.evidenceNodeIds,
        status: 'awaiting_approval',
        preGate: { passed: true, issues: [] },
        postGate: { passed: true, issues: [] },
        candidate: fixtureCandidate,
        createdAt: legacyRunTimestamp,
        updatedAt: legacyRunTimestamp,
      })
      workspace.approvals.push({
        id: 'approval-pre-chunk2-pending',
        workspaceId: workspace.id,
        runId: 'run-pre-chunk2-pending',
        status: 'pending',
        createdAt: legacyRunTimestamp,
        updatedAt: legacyRunTimestamp,
      })
    })
    await original.close()
    stores.splice(stores.indexOf(original), 1)

    const databasePath = path.join(directory, 'clarity.sqlite3')
    const legacyDatabase = new DatabaseSync(databasePath)
    legacyDatabase.exec(`
      DROP TABLE artifact_cleanup;
      DROP TABLE search_chunks;
      DROP TABLE search_documents;
      DROP TABLE search_index_state;
      ALTER TABLE artifacts DROP COLUMN extraction_status;
      ALTER TABLE artifacts DROP COLUMN extraction_format;
      ALTER TABLE artifacts DROP COLUMN extracted_text;
      ALTER TABLE artifacts DROP COLUMN extracted_byte_count;
      ALTER TABLE artifacts DROP COLUMN extracted_character_count;
      ALTER TABLE artifacts DROP COLUMN extracted_line_count;
      ALTER TABLE artifacts DROP COLUMN extracted_at;
      ALTER TABLE artifacts DROP COLUMN extraction_error;
      DROP TABLE activities;
      ALTER TABLE nodes DROP COLUMN origin;
      ALTER TABLE annotations DROP COLUMN declared_author;
      ALTER TABLE annotations DROP COLUMN origin;
      ALTER TABLE workflow_runs DROP COLUMN evidence_revision;
      ALTER TABLE workspaces DROP COLUMN revision;
      ALTER TABLE workspaces DROP COLUMN status;
      DELETE FROM schema_migrations WHERE version IN (2, 3, 4, 5, 6);
    `)
    legacyDatabase.close()

    const migratedStore = createStore(directory)
    await migratedStore.initialize()
    const migrated = await migratedStore.read(created.id)
    expect(migrated.status).toBe('active')
    expect(migrated.revision).toBe(1)
    expect(migrated.runs).toEqual([expect.objectContaining({ id: 'run-pre-chunk2-pending', status: 'rejected', evidenceRevision: undefined })])
    expect(migrated.approvals).toEqual([expect.objectContaining({ runId: 'run-pre-chunk2-pending', status: 'rejected', decidedBy: 'migration-unverified' })])
    expect(migrated.activities).toEqual([expect.objectContaining({ action: 'rejected', entityId: 'run-pre-chunk2-pending' })])
    expect((await migratedStore.list())[0]).toMatchObject({ status: 'active', revision: 1 })

    const verifiedDatabase = new DatabaseSync(databasePath, { readOnly: true })
    const migration = verifiedDatabase.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }
    verifiedDatabase.close()
    expect(migration.version).toBe(CLARITY_DATABASE_SCHEMA_VERSION)
  })

  it('atomically saves the human workspace, preserves protected state, records exact diffs, and rejects stale writes', async () => {
    const directory = await createDirectory()
    const store = createStore(directory)
    const created = await store.create('Human Workspace')
    const graph = await store.replaceGraph(created.id, fixtureNodes, fixtureEdges)
    const protectedTimestamp = new Date(Date.parse(graph.updatedAt) + 1).toISOString()
    const protectedState = await store.mutate(created.id, (workspace) => {
      workspace.nodes.find((node) => node.id === fixtureNodes[0].id)!.aiAnnotation = 'Protected inline AI annotation.'
      workspace.annotations.push(
        { id: 'annotation-ai', workspaceId: workspace.id, nodeId: fixtureNodes[0].id, author: 'ai', body: 'Protected AI note.', createdAt: protectedTimestamp, updatedAt: protectedTimestamp },
        { id: 'annotation-system', workspaceId: workspace.id, nodeId: fixtureNodes[1].id, author: 'system', body: 'Protected system note.', createdAt: protectedTimestamp, updatedAt: protectedTimestamp },
      )
      workspace.workflowDefinitions.push({
        id: 'workflow-protected', workspaceId: workspace.id, name: 'Protected workflow', revision: 1, status: 'active', specification: { mode: 'test' }, createdAt: protectedTimestamp, updatedAt: protectedTimestamp,
      })
      workspace.gates.push({
        id: 'gate-protected', workspaceId: workspace.id, name: 'Protected gate', kind: 'pre', enabled: true, rules: { minimumSources: 2 }, createdAt: protectedTimestamp, updatedAt: protectedTimestamp,
      })
      workspace.runs.push({
        id: 'run-protected', workspaceId: workspace.id, contextId: 'context-protected', intent: 'Preserve the workflow record.', sourceNodeIds: fixtureCandidate.evidenceNodeIds,
        status: 'rejected', preGate: { passed: true, issues: [] }, postGate: { passed: true, issues: [] }, candidate: fixtureCandidate,
        createdAt: protectedTimestamp, updatedAt: protectedTimestamp,
      })
      workspace.approvals.push({
        id: 'approval-protected', workspaceId: workspace.id, runId: 'run-protected', status: 'rejected', decidedBy: 'human', decidedAt: protectedTimestamp,
        createdAt: protectedTimestamp, updatedAt: protectedTimestamp,
      })
    })
    const protectedSnapshot = {
      workflowDefinitions: structuredClone(protectedState.workflowDefinitions),
      runs: structuredClone(protectedState.runs),
      gates: structuredClone(protectedState.gates),
      approvals: structuredClone(protectedState.approvals),
    }
    const firstNodeBefore = protectedState.nodes.find((node) => node.id === fixtureNodes[0].id)!
    const secondNodeBefore = protectedState.nodes.find((node) => node.id === fixtureNodes[1].id)!

    const editedNodes = structuredClone(protectedState.nodes)
    editedNodes.find((node) => node.id === fixtureNodes[0].id)!.title = 'Human-edited paper title'
    editedNodes.find((node) => node.id === fixtureNodes[0].id)!.aiAnnotation = 'Attempted overwrite from the renderer'
    editedNodes.find((node) => node.id === fixtureNodes[1].id)!.aiAnnotation = 'Attempted fabricated AI annotation'
    const saved = await store.saveHumanWorkspace(created.id, {
      expectedRevision: protectedState.revision,
      name: 'Renamed Human Workspace',
      status: 'archived',
      projects: [],
      nodes: editedNodes,
      edges: protectedState.edges,
      annotations: [{ id: 'annotation-human', nodeId: fixtureNodes[0].id, body: 'Durable human note.' }],
    })

    expect(saved.revision).toBe(protectedState.revision + 1)
    expect(saved.status).toBe('archived')
    const firstNodeAfter = saved.nodes.find((node) => node.id === fixtureNodes[0].id)!
    const secondNodeAfter = saved.nodes.find((node) => node.id === fixtureNodes[1].id)!
    expect(firstNodeAfter.createdAt).toBe(firstNodeBefore.createdAt)
    expect(firstNodeAfter.updatedAt).not.toBe(firstNodeBefore.updatedAt)
    expect(secondNodeAfter.updatedAt).toBe(secondNodeBefore.updatedAt)
    expect(firstNodeAfter.aiAnnotation).toBe('Protected inline AI annotation.')
    expect(secondNodeAfter.aiAnnotation).toBeUndefined()
    expect(saved.annotations.map((annotation) => annotation.author).sort()).toEqual(['ai', 'human', 'system'])
    expect(saved.workflowDefinitions).toEqual(protectedSnapshot.workflowDefinitions)
    expect(saved.runs).toEqual(protectedSnapshot.runs)
    expect(saved.gates).toEqual(protectedSnapshot.gates)
    expect(saved.approvals).toEqual(protectedSnapshot.approvals)
    expect(saved.activities).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'updated', entityType: 'workspace', changedFields: ['name', 'status'] }),
      expect.objectContaining({ action: 'updated', entityType: 'node', entityId: fixtureNodes[0].id, changedFields: ['title'] }),
      expect.objectContaining({ action: 'created', entityType: 'annotation', entityId: 'annotation-human' }),
    ]))

    await expect(store.saveHumanWorkspace(created.id, {
      expectedRevision: protectedState.revision,
      name: 'Stale destructive save',
      status: 'active',
      projects: [], nodes: [], edges: [], annotations: [],
    })).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    expect((await store.read(created.id)).nodes.find((node) => node.id === fixtureNodes[0].id)?.title).toBe('Human-edited paper title')

    const activityCount = saved.activities.length
    const noOp = await store.saveHumanWorkspace(created.id, {
      expectedRevision: saved.revision,
      name: saved.name,
      status: saved.status,
      projects: saved.projects,
      nodes: saved.nodes,
      edges: saved.edges,
      annotations: saved.annotations.filter((annotation): annotation is typeof annotation & { author: 'human' } => annotation.author === 'human'),
    })
    expect(noOp.revision).toBe(saved.revision)
    expect(noOp.updatedAt).toBe(saved.updatedAt)
    expect(noOp.activities).toHaveLength(activityCount)
  })

  it('enforces archived side projects as restore-only Core boundaries', async () => {
    const directory = await createDirectory()
    const store = createStore(directory)
    const created = await store.create('Archived Project Boundary')
    const project = { id: 'project-archived-boundary', name: 'Read-only project', description: 'Must be restored before mutation.', status: 'active' as const }
    const projectNodes = fixtureNodes.slice(0, 2).map((node) => ({ ...node, projectId: project.id }))
    const projectEdge = { id: 'edge-archived-boundary', projectId: project.id, source: projectNodes[0].id, target: projectNodes[1].id, relation: 'supports' }
    const populated = await store.saveHumanWorkspace(created.id, {
      expectedRevision: created.revision,
      name: created.name,
      status: 'active',
      projects: [project],
      nodes: projectNodes,
      edges: [projectEdge],
      annotations: [{ id: 'annotation-archived-boundary', nodeId: projectNodes[0].id, body: 'Read-only project note.' }],
    })
    const archived = await store.saveHumanWorkspace(created.id, {
      expectedRevision: populated.revision,
      name: populated.name,
      status: 'active',
      projects: [{ ...project, status: 'archived' }],
      nodes: populated.nodes,
      edges: populated.edges,
      annotations: populated.annotations.filter((annotation): annotation is typeof annotation & { author: 'human' } => annotation.author === 'human'),
    })

    const baseInput = {
      expectedRevision: archived.revision,
      name: archived.name,
      status: archived.status,
      projects: archived.projects,
      nodes: archived.nodes,
      edges: archived.edges,
      annotations: archived.annotations.filter((annotation): annotation is typeof annotation & { author: 'human' } => annotation.author === 'human'),
    }
    await expect(store.saveHumanWorkspace(created.id, {
      ...baseInput,
      projects: archived.projects.map((item) => ({ ...item, name: 'Forbidden rename' })),
    })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
    await expect(store.saveHumanWorkspace(created.id, {
      ...baseInput,
      projects: [],
      nodes: archived.nodes.map((node) => ({ ...node, projectId: undefined })),
      edges: [],
    })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
    await expect(store.saveHumanWorkspace(created.id, {
      ...baseInput,
      nodes: archived.nodes.map((node, index) => index ? node : { ...node, title: 'Forbidden edit' }),
    })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
    await expect(store.saveHumanWorkspace(created.id, {
      ...baseInput,
      edges: archived.edges.map((edge) => ({ ...edge, relation: 'forbidden rewrite' })),
    })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
    await expect(store.saveHumanWorkspace(created.id, {
      ...baseInput,
      annotations: baseInput.annotations.map((annotation) => ({ ...annotation, body: 'Forbidden annotation edit.' })),
    })).rejects.toMatchObject({ code: 'PROJECT_ARCHIVED' })
    expect((await store.read(created.id)).revision).toBe(archived.revision)

    const restored = await store.saveHumanWorkspace(created.id, {
      ...baseInput,
      projects: archived.projects.map((item) => ({ ...item, status: 'active' as const })),
    })
    expect(restored.projects[0].status).toBe('active')
    expect(restored.revision).toBe(archived.revision + 1)
  })

  it('rejects forged human creation or conversion of workflow-managed node kinds', async () => {
    const directory = await createDirectory()
    const store = createStore(directory)
    const created = await store.create('Reserved Kind Boundary')
    const forgedResult = { ...fixtureNodes[0], id: 'forged-human-result', kind: 'result' as const, status: 'complete' as const }
    await expect(store.saveHumanWorkspace(created.id, {
      expectedRevision: created.revision,
      name: created.name,
      status: created.status,
      projects: [],
      nodes: [forgedResult],
      edges: [],
      annotations: [],
    })).rejects.toMatchObject({ code: 'HUMAN_NODE_KIND_RESERVED' })

    const graph = await store.replaceGraph(created.id, [fixtureNodes[0]], [])
    await expect(store.saveHumanWorkspace(created.id, {
      expectedRevision: graph.revision,
      name: graph.name,
      status: graph.status,
      projects: [],
      nodes: [{ ...graph.nodes[0], kind: 'agent' }],
      edges: [],
      annotations: [],
    })).rejects.toMatchObject({ code: 'HUMAN_NODE_KIND_RESERVED' })
    expect((await store.read(created.id)).nodes[0].kind).toBe('paper')
  })

  it('imports a portable workspace into a new unverified identity without laundering AI or approval provenance', async () => {
    const directory = await createDirectory()
    const store = createStore(directory)
    const document = {
      format: 'clarity-workspace', version: 1, exportedAt: '2026-08-11T12:30:00-06:00', name: 'Portable Operator Workspace', status: 'archived',
      projects: [{ id: 'project-portable', name: 'Portable project', description: 'Human-owned portable project.', status: 'active' }],
      nodes: [
        { ...fixtureNodes[0], projectId: 'project-portable', origin: 'approved-ai', kind: 'result', status: 'complete', provenance: 'Explicitly approved by a claimed human reviewer', aiAnnotation: 'Claimed AI analysis.' },
        { ...fixtureNodes[1], projectId: 'project-portable' },
      ],
      edges: [{ id: 'edge-portable', projectId: 'project-portable', source: fixtureNodes[0].id, target: fixtureNodes[1].id, relation: 'supports' }],
      annotations: [
        { id: 'portable-human', nodeId: fixtureNodes[0].id, author: 'human', body: 'Human import note.' },
        { id: 'portable-ai', nodeId: fixtureNodes[0].id, author: 'ai', body: 'Explicitly imported AI note.', createdAt: '2026-08-10T10:00:00-06:00' },
        { id: 'portable-system', nodeId: fixtureNodes[1].id, author: 'system', body: 'Explicitly imported system note.' },
      ],
    }
    const imported = await store.importWorkspaceDocument(document)
    expect(imported.id).not.toBe('project-portable')
    expect(imported.status).toBe('archived')
    expect(imported.revision).toBe(0)
    expect(imported.projects[0].workspaceId).toBe(imported.id)
    expect(imported.nodes.every((node) => node.origin === 'imported-unverified')).toBe(true)
    expect(imported.nodes.find((node) => node.kind === 'result')).toMatchObject({ kind: 'result', status: 'complete', origin: 'imported-unverified' })
    expect(imported.runs).toEqual([])
    expect(imported.approvals).toEqual([])
    expect(imported.annotations.map((annotation) => annotation.author)).toEqual(['human', 'human', 'human'])
    expect(imported.annotations.find((annotation) => annotation.id === 'portable-ai')).toMatchObject({
      origin: 'imported-unverified',
      declaredAuthor: 'ai',
      body: 'Explicitly imported AI note.',
    })
    expect(imported.annotations.find((annotation) => annotation.id === 'portable-system')).toMatchObject({ origin: 'imported-unverified', declaredAuthor: 'system' })
    expect(imported.annotations.find((annotation) => annotation.id === 'portable-ai')?.createdAt).toBe('2026-08-10T16:00:00.000Z')
    expect(imported.activities).toEqual([expect.objectContaining({ action: 'imported', entityType: 'workspace' })])

    const secondImport = await store.importWorkspaceDocument(document)
    expect(secondImport.id).not.toBe(imported.id)

    const invalidDocument = structuredClone(document)
    invalidDocument.edges[0].target = 'missing-node'
    const beforeInvalid = await store.list()
    await expect(store.importWorkspaceDocument(invalidDocument)).rejects.toThrow(/missing node/i)
    expect(await store.list()).toEqual(beforeInvalid)
  })

  it('requires the current revision to delete a workspace and removes its managed artifact directory', async () => {
    const directory = await createDirectory()
    const store = createStore(directory)
    const created = await store.create('Delete Workspace')
    const graph = await store.replaceGraph(created.id, [fixtureNodes[0]], [])
    const sourcePath = path.join(directory, 'delete-me.txt')
    await writeFile(sourcePath, 'workspace-owned artifact', 'utf8')
    const artifact = await store.addArtifactFromFile(created.id, sourcePath, { nodeId: fixtureNodes[0].id, mimeType: 'text/plain' })
    const current = await store.read(created.id)

    await expect(store.deleteWorkspace(created.id, graph.revision)).rejects.toMatchObject({ code: 'WORKSPACE_CONFLICT' })
    expect((await store.read(created.id)).artifacts).toHaveLength(1)

    const deleted = await store.deleteWorkspace(created.id, current.revision)
    expect(deleted).toMatchObject({ workspaceId: created.id, name: 'Delete Workspace', deleted: true })
    await expect(store.read(created.id)).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })
    await expect(readFile(store.resolveArtifactPath(artifact))).rejects.toThrow()
    expect(await store.list()).toEqual([])
  })

  it('records failed artifact deletion durably and retries only that deleted workspace on restart', async () => {
    const directory = await createDirectory()
    let failRemoval = true
    const failingStore = createStore(directory, [], async (target) => {
      if (failRemoval) throw new Error('injected filesystem refusal')
      await rm(target, { recursive: true, force: true })
    })
    const created = await failingStore.create('Cleanup Retry Workspace')
    await failingStore.replaceGraph(created.id, [fixtureNodes[0]], [])
    const sourcePath = path.join(directory, 'cleanup-retry.txt')
    await writeFile(sourcePath, 'bytes awaiting durable cleanup', 'utf8')
    const artifact = await failingStore.addArtifactFromFile(created.id, sourcePath, { nodeId: fixtureNodes[0].id })
    const artifactPath = failingStore.resolveArtifactPath(artifact)
    const current = await failingStore.read(created.id)

    await expect(failingStore.deleteWorkspace(created.id, current.revision)).rejects.toMatchObject({
      code: 'WORKSPACE_DELETED_ARTIFACT_CLEANUP_PENDING',
    })
    expect(await failingStore.list()).toEqual([])
    expect(await readFile(artifactPath, 'utf8')).toBe('bytes awaiting durable cleanup')
    await expect(failingStore.importLegacyWorkspace(legacyWorkspace({ id: created.id }))).rejects.toMatchObject({
      code: 'WORKSPACE_CLEANUP_PENDING',
    })
    await failingStore.close()
    stores.splice(stores.indexOf(failingStore), 1)

    failRemoval = false
    const restarted = createStore(directory)
    await restarted.initialize()
    expect(await restarted.list()).toEqual([])
    await expect(readFile(artifactPath, 'utf8')).rejects.toThrow()
    const database = new DatabaseSync(path.join(directory, 'clarity.sqlite3'), { readOnly: true })
    const pending = database.prepare('SELECT COUNT(*) AS count FROM artifact_cleanup').get() as { count: number }
    database.close()
    expect(pending.count).toBe(0)
  })

  it('refuses tampered artifact-cleanup tokens before invoking recursive removal', async () => {
    const directory = await createDirectory()
    const original = createStore(directory)
    await original.initialize()
    await original.close()
    stores.splice(stores.indexOf(original), 1)

    const databasePath = path.join(directory, 'clarity.sqlite3')
    const database = new DatabaseSync(databasePath)
    // Model a tampered/pre-check schema while keeping SQLite integrity valid;
    // the runtime containment guard must remain the final safety boundary.
    database.exec(`
      DROP TABLE artifact_cleanup;
      CREATE TABLE artifact_cleanup (
        workspace_token TEXT PRIMARY KEY,
        requested_at TEXT NOT NULL
      );
    `)
    database.prepare('INSERT INTO artifact_cleanup(workspace_token, requested_at) VALUES (?, ?)')
      .run('../../outside-managed-target', new Date().toISOString())
    database.close()
    const sentinelPath = path.join(directory, 'outside-managed-target')
    await writeFile(sentinelPath, 'must remain untouched', 'utf8')

    let recursiveRemovalCalled = false
    const restarted = createStore(directory, [], async () => {
      recursiveRemovalCalled = true
    })
    await expect(restarted.initialize()).rejects.toMatchObject({ code: 'INVALID_ARTIFACT_CLEANUP_TOKEN' })
    expect(recursiveRemovalCalled).toBe(false)
    expect(await readFile(sentinelPath, 'utf8')).toBe('must remain untouched')
  })

  it('preserves a corrupt database before recovering to an empty valid core', async () => {
    const directory = await createDirectory()
    await writeFile(path.join(directory, 'clarity.sqlite3'), 'not a sqlite database', 'utf8')
    const store = createStore(directory)
    await store.initialize()

    expect(await store.list()).toEqual([])
    const files = await readdir(directory)
    const backup = files.find((name) => name.startsWith('clarity.sqlite3.corrupt-'))
    expect(backup).toBeTruthy()
    expect(await readFile(path.join(directory, backup!), 'utf8')).toBe('not a sqlite database')
  })
})
