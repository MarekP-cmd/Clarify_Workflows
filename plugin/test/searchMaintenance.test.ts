// @vitest-environment node
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import {
  buildSearchIndexInput,
  chunkSearchText,
  SEARCH_CHUNK_OVERLAP_CHARACTERS,
  SEARCH_CHUNK_MAX_CHARACTERS,
} from '../src/searchIndex.js'
import { trustForNode } from '../src/searchContract.js'
import { WorkspaceStore } from '../src/store.js'
import type { ClarityAnnotation, ClarityNode, WorkspaceState } from '../src/types.js'

const temporaryDirectories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-stage3-maintenance-'))
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

function nodeInput(id = 'node-stage3-source'): Omit<ClarityNode, 'createdAt' | 'updatedAt'> {
  return {
    id,
    kind: 'paper',
    origin: 'human',
    title: 'Stage 3 source node',
    description: 'A deterministic source used to exercise index maintenance.',
    schemaType: 'ScholarlyArticle',
    status: 'verified',
    tags: ['stage3', 'maintenance'],
    provenance: 'Created by the operator for the Stage 3 acceptance test.',
    position: { x: 0, y: 0 },
  }
}

async function createWorkspaceWithSources(store: WorkspaceStore) {
  const workspace = await store.create('Stage 3 maintenance fixture', 'workspace-search-stage3')
  const markdownPath = path.join(path.dirname(store.databasePath), 'source.md')
  await writeFile(markdownPath, '# Extracted heading\nUnicode: 🧪\nSecond line.\n', 'utf8')
  const ingested = await store.ingestFileAsNode(workspace.id, markdownPath, {
    node: nodeInput(),
    originalName: 'source.md',
    mimeType: 'text/markdown',
  })
  const annotation: ClarityAnnotation = {
    id: 'annotation-stage3-source',
    workspaceId: ingested.id,
    nodeId: 'node-stage3-source',
    author: 'human',
    origin: 'local',
    body: 'Operator note: preserve the extracted heading and its source URI.',
    createdAt: ingested.updatedAt,
    updatedAt: ingested.updatedAt,
  }
  const saved = await store.saveHumanWorkspace(ingested.id, {
    expectedRevision: ingested.revision,
    name: ingested.name,
    status: ingested.status,
    projects: ingested.projects,
    nodes: ingested.nodes,
    edges: ingested.edges,
    annotations: [annotation],
  })

  const unsupportedPath = path.join(path.dirname(store.databasePath), 'scan.pdf')
  await writeFile(unsupportedPath, Buffer.from('%PDF-unsupported-stage3-bytes\n', 'utf8'))
  await store.addArtifactFromFile(saved.id, unsupportedPath, {
    originalName: 'scan.pdf',
    mimeType: 'application/pdf',
  })
  return store.read(saved.id)
}

function expectedLineCount(text: string) {
  return Array.from(text).filter((character) => character === '\n').length + (text.endsWith('\n') ? 0 : 1)
}

describe('Chunk 4 Stage 3 deterministic index maintenance', () => {
  it('builds node, annotation, and explicitly extracted artifact documents while excluding unsupported bytes', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createWorkspaceWithSources(store)

    const rebuilt = await store.rebuildSearchIndex(workspace.id)
    expect(rebuilt.state).toMatchObject({
      status: 'ready',
      indexedRevision: workspace.revision,
      generation: 1,
      documentCount: 3,
    })
    expect(rebuilt.documents.map((document) => `${document.sourceKind}:${document.sourceId}`)).toEqual([
      'annotation:annotation-stage3-source',
      'artifact:' + workspace.artifacts.find((artifact) => artifact.extractionStatus === 'extracted')?.id,
      'node:node-stage3-source',
    ].sort())
    expect(rebuilt.documents.some((document) => document.title === 'scan.pdf')).toBe(false)

    const artifactDocument = rebuilt.documents.find((document) => document.sourceKind === 'artifact')!
    const artifactChunks = rebuilt.chunks.filter((chunk) => chunk.documentId === artifactDocument.id)
    expect(artifactDocument.extractionStatus).toBe('extracted')
    expect(artifactDocument.sourceSha256).toBe(workspace.artifacts.find((artifact) => artifact.id === artifactDocument.sourceId)?.sha256)
    expect(artifactChunks.map((chunk) => chunk.text).join('')).toContain('Extracted heading')
    expect(artifactChunks.every((chunk) => chunk.provenance.sourceSha256 === artifactDocument.sourceSha256)).toBe(true)
    expect(rebuilt.chunks.every((chunk) => chunk.trust.verified)).toBe(true)

    await store.close()
  })

  it('splits UTF-8 text without surrogate damage and records bounded overlapping character, byte, and line spans', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await store.create('Unicode chunk fixture', 'workspace-unicode-stage3')
    const text = '🧪'.repeat(SEARCH_CHUNK_MAX_CHARACTERS) + 'tail'
    const chunks = chunkSearchText({
      workspace,
      sourceKind: 'node',
      sourceId: 'unicode-node',
      nodeId: 'unicode-node',
      title: 'Unicode source',
      text,
      trust: trustForNode({ origin: 'human' }),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })
    expect(chunks).toHaveLength(2)
    expect(chunks[0].text).toBe('🧪'.repeat(SEARCH_CHUNK_MAX_CHARACTERS))
    expect(chunks[1].text).toBe('🧪'.repeat(SEARCH_CHUNK_OVERLAP_CHARACTERS) + 'tail')
    expect(chunks.every((chunk) => !chunk.text.includes('\uFFFD'))).toBe(true)
    expect(chunks.map((chunk) => chunk.characterCount)).toEqual([SEARCH_CHUNK_MAX_CHARACTERS, SEARCH_CHUNK_OVERLAP_CHARACTERS + 4])
    expect(chunks[1].provenance.startCharacter).toBe(chunks[0].provenance.endCharacter - SEARCH_CHUNK_OVERLAP_CHARACTERS)
    expect(chunks[1].provenance.startByte).toBe(chunks[0].provenance.endByte - SEARCH_CHUNK_OVERLAP_CHARACTERS * 4)

    const trailing = chunkSearchText({
      workspace,
      sourceKind: 'node',
      sourceId: 'trailing-node',
      nodeId: 'trailing-node',
      title: 'Trailing newline source',
      text: 'first\nsecond\n',
      trust: trustForNode({ origin: 'human' }),
      createdAt: workspace.createdAt,
      updatedAt: workspace.updatedAt,
    })
    expect(trailing).toHaveLength(1)
    expect(trailing[0].provenance.startLine).toBe(0)
    expect(trailing[0].provenance.endLine).toBe(expectedLineCount(trailing[0].text) - 1)
    await store.close()
  })

  it('rebuilds after an authoritative graph revision, increments generation, and rehydrates deterministically after restart', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createWorkspaceWithSources(store)
    const first = await store.rebuildSearchIndex(workspace.id)

    const changed = await store.saveHumanWorkspace(workspace.id, {
      expectedRevision: workspace.revision,
      name: workspace.name,
      status: workspace.status,
      projects: workspace.projects,
      nodes: workspace.nodes.map((node) => ({ ...node, description: `${node.description}\nA later operator edit.` })),
      edges: workspace.edges,
      annotations: workspace.annotations,
    })
    const dirty = await store.readSearchIndex(workspace.id)
    expect(dirty.state).toMatchObject({ status: 'dirty', indexedRevision: first.state.indexedRevision, generation: 1 })

    const second = await store.rebuildSearchIndex(workspace.id)
    expect(second.state).toMatchObject({ status: 'ready', indexedRevision: changed.revision, generation: 2 })
    expect(second.documents.map((document) => document.id).sort()).toEqual(first.documents.map((document) => document.id).sort())
    expect(second.documents.find((document) => document.sourceKind === 'node')?.contentHash)
      .not.toBe(first.documents.find((document) => document.sourceKind === 'node')?.contentHash)

    await store.close()
    const reopened = new WorkspaceStore(paths)
    const hydrated = await reopened.readSearchIndex(workspace.id)
    expect(hydrated.state).toMatchObject({ status: 'ready', indexedRevision: changed.revision, generation: 2 })
    const third = await reopened.rebuildSearchIndex(workspace.id)
    expect(third.state.generation).toBe(3)
    expect(third.documents.map((document) => [document.id, document.contentHash])).toEqual(
      hydrated.documents.map((document) => [document.id, document.contentHash]),
    )
    expect(third.chunks.map((chunk) => [chunk.id, chunk.provenance.contentHash])).toEqual(
      hydrated.chunks.map((chunk) => [chunk.id, chunk.provenance.contentHash]),
    )
    await reopened.close()
  })

  it('fails closed on managed-byte tampering while retaining the previous projection', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createWorkspaceWithSources(store)
    const first = await store.rebuildSearchIndex(workspace.id)
    const artifact = workspace.artifacts.find((candidate) => candidate.extractionStatus === 'extracted')!
    await writeFile(store.resolveArtifactPath(artifact), 'tampered managed bytes', 'utf8')

    await expect(store.rebuildSearchIndex(workspace.id)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })
    const failed = await store.readSearchIndex(workspace.id)
    expect(failed.state).toMatchObject({ status: 'failed', generation: first.state.generation, documentCount: first.state.documentCount, chunkCount: first.state.chunkCount })
    expect(failed.state.lastError).toMatch(/managed bytes/i)
    expect(failed.documents).toEqual(first.documents)
    expect(failed.chunks).toEqual(first.chunks)
    await store.close()
  })

  it('records a failed rebuild when extracted metadata is incomplete and retains prior rows', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createWorkspaceWithSources(store)
    const first = await store.rebuildSearchIndex(workspace.id)
    const artifact = workspace.artifacts.find((candidate) => candidate.extractionStatus === 'extracted')!
    const database = new DatabaseSync(paths.databasePath)
    database.prepare('UPDATE artifacts SET extracted_text = NULL WHERE id = ?').run(artifact.id)
    database.close()

    await expect(store.rebuildSearchIndex(workspace.id)).rejects.toMatchObject({ code: 'SEARCH_EXTRACTION_MISSING' })
    const failed = await store.readSearchIndex(workspace.id)
    expect(failed.state.status).toBe('failed')
    expect(failed.state.lastError).toMatch(/not explicitly extracted/i)
    expect(failed.state.generation).toBe(first.state.generation)
    expect(failed.documents).toEqual(first.documents)
    await store.close()
  })

  it('keeps build failures bounded and typed for retry surfaces', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await store.create('Failure fixture', 'workspace-failure-stage3')
    const database = new DatabaseSync(paths.databasePath)
    database.prepare('UPDATE search_index_state SET status = ? WHERE workspace_id = ?').run('building', workspace.id)
    database.close()
    await expect(store.rebuildSearchIndex(workspace.id)).resolves.toMatchObject({ state: { status: 'ready', generation: 1 } })
    await expect(store.readSearchIndex(workspace.id)).resolves.toMatchObject({ state: { status: 'ready' } })
    await store.close()
  })

  it('keeps generated input bounded before SQLite replacement', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace: WorkspaceState = await store.create('Bound fixture', 'workspace-bound-stage3')
    const input = buildSearchIndexInput(workspace)
    expect(input.documents).toHaveLength(0)
    expect(input.chunks).toHaveLength(0)
    await store.close()
  })

  it('surfaces typed conflicts from stale replacement without mutating the projection', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await store.create('Typed conflict fixture', 'workspace-typed-conflict-stage3')
    const input = buildSearchIndexInput(workspace)
    await expect(store.replaceSearchIndex(workspace.id, { ...input, expectedWorkspaceRevision: workspace.revision + 1 })).rejects.toMatchObject({ code: 'SEARCH_INDEX_CONFLICT' })
    const snapshot = await store.readSearchIndex(workspace.id)
    expect(snapshot.state).toMatchObject({ status: 'unbuilt', generation: 0, documentCount: 0, chunkCount: 0 })
    await store.close()
  })
})
