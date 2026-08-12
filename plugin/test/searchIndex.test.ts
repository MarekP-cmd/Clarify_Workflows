// @vitest-environment node
import { createHash } from 'node:crypto'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { afterEach, describe, expect, it } from 'vitest'
import { hashSearchContent, trustForAnnotation, trustForNode } from '../src/searchContract.js'
import {
  buildSearchIndexInput,
  createSearchChunkId,
  createSearchDocumentId,
  SEARCH_CHUNK_MAX_BYTES,
  SEARCH_CHUNK_MAX_CHARACTERS,
} from '../src/searchIndex.js'
import { WorkspaceStore, WorkspaceStoreError } from '../src/store.js'
import type { ClarityAnnotation, ClarityNode, WorkspaceState } from '../src/types.js'

const timestamps = '2026-08-12T12:00:00.000Z'
const temporaryDirectories: string[] = []

async function createStore() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-stage2-search-'))
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

function sourceNode(id = 'node-search-source'): Omit<ClarityNode, 'createdAt' | 'updatedAt'> {
  return {
    id,
    kind: 'paper',
    origin: 'human',
    title: 'Searchable source node',
    description: 'A source node used to verify durable search provenance.',
    schemaType: 'ScholarlyArticle',
    status: 'verified',
    tags: ['search'],
    provenance: 'Created by the operator in the graph.',
    position: { x: 0, y: 0 },
  }
}

function chunkFor(
  workspace: WorkspaceState,
  document: { id: string; sourceKind: 'node' | 'annotation' | 'artifact'; sourceId: string; text: string; trust: ReturnType<typeof trustForNode>; sourceSha256?: string; extractionStatus?: 'extracted'; extractionFormat?: 'text/markdown'; sourceUri?: string },
  sequence = 0,
) {
  const id = createSearchChunkId(document.id, sequence)
  const characterCount = Array.from(document.text).length
  const byteCount = Buffer.byteLength(document.text, 'utf8')
  const lineCount = Array.from(document.text).filter((character) => character === '\n').length
    + (document.text.endsWith('\n') ? 0 : 1)
  return {
    id,
    workspaceId: workspace.id,
    documentId: document.id,
    sequence,
    text: document.text,
    characterCount,
    byteCount,
    provenance: {
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      sourceKind: document.sourceKind,
      sourceId: document.sourceId,
      ...(document.sourceKind === 'node' ? { nodeId: document.sourceId } : {}),
      ...(document.sourceKind === 'annotation' ? { annotationId: document.sourceId } : {}),
      ...(document.sourceKind === 'artifact' ? { artifactId: document.sourceId } : {}),
      ...(document.sourceUri ? { sourceUri: document.sourceUri } : {}),
      ...(document.sourceSha256 ? { sourceSha256: document.sourceSha256 } : {}),
      ...(document.extractionStatus ? { extractionStatus: document.extractionStatus } : {}),
      ...(document.extractionFormat ? { extractionFormat: document.extractionFormat } : {}),
      contentHash: hashSearchContent(document.text),
      chunkId: id,
      startCharacter: 0,
      endCharacter: characterCount,
      startByte: 0,
      endByte: byteCount,
      startLine: 0,
      endLine: lineCount - 1,
    },
    trust: document.trust,
    createdAt: timestamps,
    updatedAt: timestamps,
  }
}

function indexFor(workspace: WorkspaceState) {
  return buildSearchIndexInput(workspace)
}

async function createIndexedWorkspace(store: WorkspaceStore) {
  const workspace = await store.create('Durable search fixture', 'workspace-search-stage2')
  const source = sourceNode()
  const sourcePath = path.join(path.dirname(store.databasePath), 'notes.md')
  await writeFile(sourcePath, '# Managed search source\nThis body is extracted and searchable later.\n', 'utf8')
  const withArtifact = await store.ingestFileAsNode(workspace.id, sourcePath, {
    node: { ...source, id: source.id, title: source.title, sourceUri: undefined },
    originalName: 'notes.md',
    mimeType: 'text/markdown',
  })
  const annotation: ClarityAnnotation = {
    id: 'annotation-search-source',
    workspaceId: withArtifact.id,
    nodeId: source.id,
    author: 'human',
    origin: 'local',
    body: 'Remember to cite the extracted operator notes.',
    createdAt: timestamps,
    updatedAt: timestamps,
  }
  const saved = await store.saveHumanWorkspace(withArtifact.id, {
    expectedRevision: withArtifact.revision,
    name: withArtifact.name,
    status: withArtifact.status,
    projects: withArtifact.projects,
    nodes: withArtifact.nodes,
    edges: withArtifact.edges,
    annotations: [annotation],
  })
  return saved
}

describe('Chunk 4 Stage 2 durable search index model', () => {
  it('migrates to schema 6 with one disposable state row per workspace', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    await store.initialize()
    const workspace = await store.create('Migration fixture', 'workspace-migration-search')
    const snapshot = await store.readSearchIndex(workspace.id)
    expect(snapshot.state).toMatchObject({ status: 'unbuilt', indexedRevision: 0, generation: 0, documentCount: 0, chunkCount: 0 })
    const database = new DatabaseSync(paths.databasePath)
    expect(Number((database.prepare('SELECT MAX(version) AS version FROM schema_migrations').get() as { version: number }).version)).toBe(6)
    expect(database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name IN ('search_index_state','search_documents','search_chunks') ORDER BY name").all()).toHaveLength(3)
    database.close()
    await store.close()
  })

  it('atomically persists bounded graph, annotation, and extracted-artifact provenance with stable ids', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createIndexedWorkspace(store)
    const input = indexFor(workspace)
    const indexed = await store.replaceSearchIndex(workspace.id, input)
    expect(indexed.state).toMatchObject({ status: 'ready', indexedRevision: workspace.revision, generation: 1, documentCount: 3, chunkCount: 3 })
    expect(indexed.documents.map((document) => document.id).sort()).toEqual([
      createSearchDocumentId(workspace.id, 'node', workspace.nodes[0].id),
      createSearchDocumentId(workspace.id, 'annotation', workspace.annotations[0].id),
      createSearchDocumentId(workspace.id, 'artifact', workspace.artifacts[0].id),
    ].sort())
    expect(indexed.chunks.every((chunk) => chunk.provenance.workspaceRevision === workspace.revision)).toBe(true)
    expect(indexed.chunks.find((chunk) => chunk.provenance.sourceKind === 'artifact')?.provenance.sourceSha256).toBe(workspace.artifacts[0].sha256)
    await store.close()
  })

  it('marks the derived projection dirty on graph changes and rejects stale rebuilds without deleting the old rows', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createIndexedWorkspace(store)
    const first = await store.replaceSearchIndex(workspace.id, indexFor(workspace))
    const changed = await store.saveHumanWorkspace(workspace.id, {
      expectedRevision: workspace.revision,
      name: workspace.name,
      status: workspace.status,
      projects: workspace.projects,
      nodes: workspace.nodes.map((node) => ({ ...node, description: `${node.description} changed` })),
      edges: workspace.edges,
      annotations: workspace.annotations,
    })
    const dirty = await store.readSearchIndex(workspace.id)
    expect(dirty.state).toMatchObject({ status: 'dirty', indexedRevision: first.state.indexedRevision, generation: 1 })
    await expect(store.replaceSearchIndex(workspace.id, indexFor(workspace))).rejects.toMatchObject({ code: 'SEARCH_INDEX_CONFLICT' })
    const afterRejectedRebuild = await store.readSearchIndex(workspace.id)
    expect(afterRejectedRebuild.documents).toHaveLength(3)
    expect(afterRejectedRebuild.state.generation).toBe(1)
    const rebuilt = await store.replaceSearchIndex(workspace.id, indexFor(changed))
    expect(rebuilt.state).toMatchObject({ status: 'ready', indexedRevision: changed.revision, generation: 2 })
    await store.close()
  })

  it('survives close/reopen and leaves graph data readable when the derived rows are corrupt', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createIndexedWorkspace(store)
    await store.replaceSearchIndex(workspace.id, indexFor(workspace))
    await store.close()

    const database = new DatabaseSync(paths.databasePath)
    database.prepare('UPDATE search_index_state SET document_count = 999 WHERE workspace_id = ?').run(workspace.id)
    database.close()

    const reopened = new WorkspaceStore(paths)
    const graph = await reopened.read(workspace.id)
    expect(graph.nodes).toHaveLength(1)
    await expect(reopened.readSearchIndex(workspace.id)).rejects.toMatchObject({ code: 'SEARCH_INDEX_CORRUPT' })
    await reopened.close()
  })

  it('keeps the previous projection when a rebuild fails validation or source integrity checks', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createIndexedWorkspace(store)
    const input = indexFor(workspace)
    await store.replaceSearchIndex(workspace.id, input)
    const trustLaundered = {
      ...input,
      documents: input.documents.map((document) => document.sourceKind === 'node' ? { ...document, trust: { label: 'approved-ai' as const, effectiveAuthor: 'ai' as const, verified: true } } : document),
      chunks: input.chunks.map((chunk) => chunk.provenance.sourceKind === 'node' ? { ...chunk, trust: { label: 'approved-ai' as const, effectiveAuthor: 'ai' as const, verified: true } } : chunk),
    }
    await expect(store.replaceSearchIndex(workspace.id, trustLaundered)).rejects.toMatchObject({ code: 'SEARCH_INDEX_NON_CANONICAL' })
    const retained = await store.readSearchIndex(workspace.id)
    expect(retained.state.generation).toBe(1)
    expect(retained.documents).toHaveLength(3)
    await store.close()
  })

  it('rejects a self-consistent forged projection that is not derived from authoritative source text', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createIndexedWorkspace(store)
    const input = indexFor(workspace)
    const nodeDocument = input.documents.find((document) => document.sourceKind === 'node')!
    const nodeChunk = input.chunks.find((chunk) => chunk.documentId === nodeDocument.id)!
    const forgedText = 'FORGED projection payload absent from the authoritative node.'
    const forgedHash = hashSearchContent(forgedText)
    const forgedInput = {
      ...input,
      documents: input.documents.map((document) => document.id === nodeDocument.id
        ? { ...document, title: 'Forged authority', contentHash: forgedHash }
        : document),
      chunks: input.chunks.map((chunk) => chunk.id === nodeChunk.id
        ? {
            ...chunk,
            text: forgedText,
            characterCount: Array.from(forgedText).length,
            byteCount: Buffer.byteLength(forgedText, 'utf8'),
            provenance: {
              ...chunk.provenance,
              contentHash: forgedHash,
              endCharacter: chunk.provenance.startCharacter + Array.from(forgedText).length,
              endByte: chunk.provenance.startByte + Buffer.byteLength(forgedText, 'utf8'),
              endLine: chunk.provenance.startLine,
            },
          }
        : chunk),
    }
    await expect(store.replaceSearchIndex(workspace.id, forgedInput)).rejects.toMatchObject({ code: 'SEARCH_INDEX_NON_CANONICAL' })
    expect((await store.readSearchIndex(workspace.id)).state.status).toBe('unbuilt')
    await store.close()
  })

  it('enforces chunk character/byte bounds and exact offsets before any database write', async () => {
    const paths = await createStore()
    const store = new WorkspaceStore(paths)
    const workspace = await createIndexedWorkspace(store)
    const input = indexFor(workspace)
    const tooLong = 'x'.repeat(SEARCH_CHUNK_MAX_CHARACTERS + 1)
    const tooWide = '🧪'.repeat(Math.ceil(SEARCH_CHUNK_MAX_BYTES / 4) + 1)
    expect(Array.from(tooLong).length).toBe(SEARCH_CHUNK_MAX_CHARACTERS + 1)
    expect(Buffer.byteLength(tooWide, 'utf8')).toBeGreaterThan(SEARCH_CHUNK_MAX_BYTES)
    await expect(store.replaceSearchIndex(workspace.id, {
      ...input,
      chunks: input.chunks.map((chunk, index) => index === 0 ? { ...chunk, text: tooLong } : chunk),
    })).rejects.toThrow()
    await expect(store.replaceSearchIndex(workspace.id, {
      ...input,
      chunks: input.chunks.map((chunk, index) => index === 0 ? { ...chunk, text: tooWide } : chunk),
    })).rejects.toThrow()
    expect((await store.readSearchIndex(workspace.id)).state.status).toBe('unbuilt')
    await store.close()
  })

  it('exposes rebuild identity helpers as deterministic, bounded identifiers', () => {
    const documentId = createSearchDocumentId('workspace', 'node', 'node-1')
    const chunkId = createSearchChunkId(documentId, 0)
    expect(documentId).toBe(createSearchDocumentId('workspace', 'node', 'node-1'))
    expect(chunkId).toBe(createSearchChunkId(documentId, 0))
    expect(documentId.length).toBeLessThanOrEqual(160)
    expect(chunkId.length).toBeLessThanOrEqual(160)
    expect(SEARCH_CHUNK_MAX_CHARACTERS).toBe(16_000)
    expect(SEARCH_CHUNK_MAX_BYTES).toBe(64_000)
    expect(createHash('sha256').update('stable').digest('hex')).toHaveLength(64)
  })
})
