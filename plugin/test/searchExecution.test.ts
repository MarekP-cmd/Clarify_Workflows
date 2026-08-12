// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { SearchContractError } from '../src/searchContract.js'
import { WorkspaceStore } from '../src/store.js'
import type { ClarityAnnotation, ClarityNode, ClarityProject } from '../src/types.js'

const temporaryDirectories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-stage4-search-'))
  temporaryDirectories.push(directory)
  return {
    directory,
    databasePath: path.join(directory, 'clarity.sqlite3'),
    artifactDirectory: path.join(directory, 'artifacts'),
  }
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

function node(
  workspaceId: string,
  id: string,
  title: string,
  description: string,
  createdAt: string,
  projectId?: string,
): ClarityNode {
  return {
    id,
    projectId,
    origin: 'human',
    kind: 'paper',
    title,
    description,
    schemaType: 'ScholarlyArticle',
    status: 'verified',
    tags: ['search', 'stage4'],
    provenance: 'Operator-created bounded query fixture.',
    position: { x: 0, y: 0 },
    createdAt,
    updatedAt: createdAt,
  }
}

async function createFixture(withProject = false) {
  const paths = await createStore()
  const store = new WorkspaceStore(paths)
  const workspace = await store.create('Stage 4 query fixture', 'workspace-search-stage4')
  const project: ClarityProject | undefined = withProject
    ? {
      id: 'project-stage4',
      workspaceId: workspace.id,
      name: 'Stage 4 project',
      description: 'Project filter fixture',
      status: 'active',
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    }
    : undefined
  const nodes = [
    node(workspace.id, 'node-alpha', 'Alpha source', 'The Alpha subject contains Needle and a second term.', workspace.createdAt, project?.id),
    node(workspace.id, 'node-beta', 'Beta source', 'The Beta subject contains Needle and a second term.', workspace.createdAt),
    node(workspace.id, 'node-gamma', 'Gamma source', 'The Gamma subject contains Needle and a second term.', workspace.createdAt),
    node(workspace.id, 'node-unicode', 'Unicode source', `The 🧪 subject contains needle and ${'needle '.repeat(500)}`, workspace.createdAt),
  ]
  const annotation: ClarityAnnotation = {
    id: 'annotation-alpha',
    workspaceId: workspace.id,
    nodeId: 'node-alpha',
    author: 'human',
    origin: 'local',
    body: 'Operator note: Needle must remain grounded in the source.',
    createdAt: workspace.createdAt,
    updatedAt: workspace.updatedAt,
  }
  const saved = await store.saveHumanWorkspace(workspace.id, {
    expectedRevision: workspace.revision,
    name: workspace.name,
    status: workspace.status,
    projects: project ? [project] : [],
    nodes,
    edges: [],
    annotations: [annotation],
  })
  const markdownPath = path.join(paths.directory, 'evidence.md')
  await writeFile(markdownPath, '# Artifact evidence\nNeedle appears in managed extracted text.\n', 'utf8')
  const withArtifact = await store.ingestFileAsNode(saved.id, markdownPath, {
    node: node(saved.id, 'node-artifact', 'Artifact source', 'A managed artifact source.', saved.updatedAt),
    originalName: 'evidence.md',
    mimeType: 'text/markdown',
  })
  await store.rebuildSearchIndex(withArtifact.id)
  return { paths, store, workspace: await store.read(withArtifact.id) }
}

describe('Chunk 4 Stage 4 bounded query execution', () => {
  it('searches nodes, first-class annotations, and extracted artifacts with authoritative provenance and trust', async () => {
    const { store, workspace } = await createFixture()
    const page = await store.search(workspace.id, { query: 'needle' })
    expect(page).toMatchObject({ workspaceId: workspace.id, workspaceRevision: workspace.revision, totalCount: 6, nextCursor: null, truncated: false })
    expect(page.results.map((result) => result.provenance.sourceKind)).toEqual(expect.arrayContaining(['node', 'annotation', 'artifact']))
    expect(page.results.every((result) => result.provenance.workspaceRevision === workspace.revision)).toBe(true)
    expect(page.results.every((result) => result.trust.verified)).toBe(true)
    expect(page.results[0].resultId).toMatch(/^search-chunk-/)
    expect(page.results[0].snippet.toLocaleLowerCase()).toContain('needle')
    await store.close()
  })

  it('uses deterministic term matching, score ordering, and plain-text injection-safe behavior', async () => {
    const { store, workspace } = await createFixture()
    const first = await store.search(workspace.id, { query: 'NEEDLE second' })
    const second = await store.search(workspace.id, { query: 'NEEDLE second' })
    expect(first.results.map((result) => result.resultId)).toEqual(second.results.map((result) => result.resultId))
    expect(first.results[0].score).toBeGreaterThanOrEqual(first.results.at(-1)!.score)
    const injection = await store.search(workspace.id, { query: "' OR 1=1" })
    expect(injection.totalCount).toBe(0)
    await store.close()
  })

  it('applies scope, source, node, project, artifact, and trust filters without widening the result set', async () => {
    const { store, workspace } = await createFixture(true)
    const projectOnly = await store.search(workspace.id, { query: 'needle', projectIds: ['project-stage4'] })
    expect(projectOnly.results.length).toBeGreaterThan(0)
    expect(projectOnly.results.every((result) => result.provenance.sourceId === 'node-alpha' || result.provenance.sourceKind === 'annotation')).toBe(true)

    const nodeOnly = await store.search(workspace.id, { query: 'needle', scope: 'nodes', nodeIds: ['node-beta'] })
    expect(nodeOnly.results.length).toBe(1)
    expect(nodeOnly.results[0].provenance.sourceId).toBe('node-beta')

    const artifactOnly = await store.search(workspace.id, { query: 'needle', sourceKinds: ['artifact'], scope: 'artifacts' })
    expect(artifactOnly.results.length).toBe(1)
    expect(artifactOnly.results[0].provenance.sourceKind).toBe('artifact')

    const impossible = await store.search(workspace.id, { query: 'needle', scope: 'nodes', sourceKinds: ['artifact'] })
    expect(impossible.totalCount).toBe(0)
    await store.close()
  })

  it('paginates with stable cursors, page-local ranks, and a truthful total count', async () => {
    const { store, workspace } = await createFixture()
    const first = await store.search(workspace.id, { query: 'needle', sourceKinds: ['node'], limit: 2 })
    expect(first.results).toHaveLength(2)
    expect(first.results.map((result) => result.rank)).toEqual([1, 2])
    expect(first.totalCount).toBe(4)
    expect(first.nextCursor).toBe('2')
    const second = await store.search(workspace.id, { query: 'needle', sourceKinds: ['node'], limit: 2, cursor: first.nextCursor! })
    expect(second.results).toHaveLength(2)
    expect(second.results[0].resultId).not.toBe(first.results[0].resultId)
    expect(second.results.map((result) => result.rank)).toEqual([1, 2])
    expect(second.nextCursor).toBeNull()
    const third = await store.search(workspace.id, { query: 'needle', sourceKinds: ['node'], limit: 2, cursor: '4' })
    expect(third.results).toHaveLength(0)
    expect(third.nextCursor).toBeNull()
    expect(third.truncated).toBe(false)
    await store.close()
  })

  it('bounds snippets and match ranges without splitting Unicode text', async () => {
    const { store, workspace } = await createFixture()
    const page = await store.search(workspace.id, { query: 'NEEDLE', nodeIds: ['node-unicode'] })
    expect(page.results).toHaveLength(1)
    const result = page.results[0]
    expect(result.snippetCharacterCount).toBeLessThanOrEqual(2_000)
    expect(result.snippetByteCount).toBeLessThanOrEqual(8_000)
    expect(result.matchRanges.length).toBeLessThanOrEqual(32)
    expect(result.snippet).not.toContain('\uFFFD')
    expect(result.matchRanges.every((range) => range.startCharacter >= 0 && range.endCharacter <= result.snippetCharacterCount)).toBe(true)
    await store.close()
  })

  it('activates unbuilt and dirty disposable projections on first search', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await store.create('Not ready fixture', 'workspace-not-ready-stage4')
    await expect(store.search(workspace.id, { query: 'anything' })).resolves.toMatchObject({ totalCount: 0 })
    const changed = await store.saveHumanWorkspace(workspace.id, {
      expectedRevision: workspace.revision,
      name: workspace.name,
      status: workspace.status,
      projects: [],
      nodes: [node(workspace.id, 'node-ready', 'Ready node', 'Needle is here.', workspace.createdAt)],
      edges: [],
      annotations: [],
    })
    await expect(store.search(changed.id, { query: 'needle', expectedWorkspaceRevision: changed.revision })).resolves.toMatchObject({ totalCount: 1 })
    await expect(store.readSearchIndex(changed.id)).resolves.toMatchObject({ state: { status: 'ready', indexedRevision: changed.revision } })
    await store.close()
  })

  it('coalesces concurrent first-search rebuilds and rechecks the requested revision afterward', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const empty = await store.create('Concurrent activation fixture', 'workspace-concurrent-activation')
    const revisionOne = await store.saveHumanWorkspace(empty.id, {
      expectedRevision: empty.revision,
      name: empty.name,
      status: empty.status,
      projects: [],
      nodes: [node(empty.id, 'node-concurrent', 'Concurrent node', 'initial-race-token', empty.createdAt)],
      edges: [],
      annotations: [],
    })

    const originalRebuild = store.rebuildSearchIndex.bind(store)
    let releaseRebuild!: () => void
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => { markStarted = resolve })
    const barrier = new Promise<void>((resolve) => { releaseRebuild = resolve })
    let rebuildCount = 0
    store.rebuildSearchIndex = async (workspaceId) => {
      rebuildCount += 1
      markStarted()
      await barrier
      return originalRebuild(workspaceId)
    }

    const first = store.search(revisionOne.id, { query: 'initial-race-token' })
    await started
    const second = store.search(revisionOne.id, { query: 'initial-race-token' })
    releaseRebuild()
    await expect(Promise.all([first, second])).resolves.toSatisfy((pages) => pages.every((page) => page.totalCount === 1))
    expect(rebuildCount).toBe(1)

    await store.markSearchIndexDirty(revisionOne.id, 'Exercise the post-rebuild revision check.')
    let releaseSecondRebuild!: () => void
    let markSecondStarted!: () => void
    const secondStarted = new Promise<void>((resolve) => { markSecondStarted = resolve })
    const secondBarrier = new Promise<void>((resolve) => { releaseSecondRebuild = resolve })
    store.rebuildSearchIndex = async (workspaceId) => {
      markSecondStarted()
      await secondBarrier
      return originalRebuild(workspaceId)
    }
    const staleRequest = store.search(revisionOne.id, {
      query: 'initial-race-token',
      expectedWorkspaceRevision: revisionOne.revision,
    })
    await secondStarted
    await store.saveHumanWorkspace(revisionOne.id, {
      expectedRevision: revisionOne.revision,
      name: revisionOne.name,
      status: revisionOne.status,
      projects: [],
      nodes: [node(revisionOne.id, 'node-concurrent', 'Concurrent node', 'new-race-token', revisionOne.createdAt)],
      edges: [],
      annotations: [],
    })
    releaseSecondRebuild()
    await expect(staleRequest).rejects.toMatchObject({ code: 'SEARCH_INDEX_CONFLICT' })
    await store.close()
  })

  it('recovers failed and restart-interrupted projection states through the product search path', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const empty = await store.create('Projection recovery fixture', 'workspace-projection-recovery')
    const sourcePath = path.join(paths.directory, 'recovery.md')
    const sourceText = '# Recovery\nprojection-recovery-token\n'
    await writeFile(sourcePath, sourceText, 'utf8')
    const workspace = await store.ingestFileAsNode(empty.id, sourcePath, {
      node: node(empty.id, 'node-recovery', 'Recovery node', 'Managed recovery source.', empty.createdAt),
      originalName: 'recovery.md',
      mimeType: 'text/markdown',
    })
    const artifact = workspace.artifacts[0]!
    const managedPath = store.resolveArtifactPath(artifact)
    await writeFile(managedPath, 'tampered', 'utf8')
    await expect(store.search(workspace.id, { query: 'projection-recovery-token' })).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })
    expect((await store.readSearchIndex(workspace.id)).state.status).toBe('failed')
    await writeFile(managedPath, sourceText, 'utf8')
    await expect(store.search(workspace.id, { query: 'projection-recovery-token', sourceKinds: ['artifact'] })).resolves.toMatchObject({ totalCount: 1 })

    await (store as unknown as { markSearchIndexBuilding(workspaceId: string, revision: number): Promise<void> })
      .markSearchIndexBuilding(workspace.id, workspace.revision)
    expect((await store.readSearchIndex(workspace.id)).state.status).toBe('building')
    await store.close()

    const reopened = new WorkspaceStore(paths)
    expect((await reopened.readSearchIndex(workspace.id)).state.status).toBe('building')
    await expect(reopened.search(workspace.id, { query: 'projection-recovery-token', sourceKinds: ['artifact'] })).resolves.toMatchObject({ totalCount: 1 })
    await reopened.close()
  })

  it('rejects a caller-declared revision that is no longer authoritative', async () => {
    const { store, workspace } = await createFixture()
    await expect(store.search(workspace.id, { query: 'needle', expectedWorkspaceRevision: workspace.revision - 1 })).rejects.toMatchObject({ code: 'SEARCH_INDEX_CONFLICT' })
    await store.close()
  })

  it('fails closed for invalid query input and preserves the query contract boundary', async () => {
    const { store, workspace } = await createFixture()
    await expect(store.search(workspace.id, { query: '   ' })).rejects.toSatisfy((error) => error instanceof SearchContractError && error.code === 'SEARCH_QUERY_EMPTY')
    await expect(store.search(workspace.id, { query: 'x'.repeat(513) })).rejects.toMatchObject({ code: 'SEARCH_QUERY_TOO_LONG' })
    await expect(store.search(workspace.id, { query: 'safe\u0001query' })).rejects.toMatchObject({ code: 'SEARCH_QUERY_CONTROL_CHARACTER' })
    await expect(store.search(workspace.id, {
      query: Array.from({ length: 33 }, (_, index) => `term-${index}`).join(' '),
    })).rejects.toMatchObject({ code: 'SEARCH_QUERY_TOO_MANY_TERMS' })
    await store.close()
  })

  it('finds a term that crosses the nominal 16,000-character chunk boundary', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await store.create('Boundary query fixture', 'workspace-boundary-stage4')
    const boundaryNode = node(workspace.id, 'node-boundary', 'Boundary source', 'Boundary description.', workspace.createdAt)
    const prefix = [
      `Title: ${boundaryNode.title}`,
      `Kind: ${boundaryNode.kind}`,
      `Status: ${boundaryNode.status}`,
      `Schema: ${boundaryNode.schemaType}`,
      `Description: ${boundaryNode.description}`,
      `Tags: ${boundaryNode.tags.join(', ')}`,
      `Provenance: ${boundaryNode.provenance}`,
      'Human annotation: ',
    ].join('\n')
    boundaryNode.humanAnnotation = `${'x'.repeat(15_999 - Array.from(prefix).length)}needle`
    const saved = await store.saveHumanWorkspace(workspace.id, {
      expectedRevision: workspace.revision,
      name: workspace.name,
      status: workspace.status,
      projects: [],
      nodes: [boundaryNode],
      edges: [],
      annotations: [],
    })
    const page = await store.search(saved.id, {
      query: 'needle',
      sourceKinds: ['node'],
      nodeIds: [boundaryNode.id],
    })
    expect(page.results).toHaveLength(1)
    expect(page.results[0]?.snippet).toContain('needle')
    await store.close()
  })

  it('does not launder imported-unverified trust into a native search result', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const imported = await store.importWorkspaceDocument({
      format: 'clarity-workspace',
      version: 1,
      exportedAt: new Date().toISOString(),
      name: 'Imported search fixture',
      status: 'active',
      projects: [],
      nodes: (() => {
        const importedNode = node('portable', 'node-imported', 'Imported needle', 'Needle imported from a portable document.', new Date().toISOString())
        const { createdAt: _createdAt, updatedAt: _updatedAt, ...portableNode } = importedNode
        return [portableNode]
      })(),
      edges: [],
      annotations: [],
    })
    await store.rebuildSearchIndex(imported.id)
    const page = await store.search(imported.id, { query: 'needle', trust: ['imported-unverified'] })
    expect(page.results).toHaveLength(1)
    expect(page.results[0].trust).toMatchObject({ label: 'imported-unverified', verified: false })
    await expect(store.search(imported.id, { query: 'needle', trust: ['human'] })).resolves.toMatchObject({ totalCount: 0 })
    await store.close()
  })
})
