// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { extractIngestionContent, extractManagedIngestionContent, MAX_EXTRACTABLE_SOURCE_BYTES, detectIngestionFormat } from '../src/ingestion.js'
import { WorkspaceStore } from '../src/store.js'

const temporaryDirectories: string[] = []
const stores: WorkspaceStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close().catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createDirectory() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-ingestion-stage1-'))
  temporaryDirectories.push(directory)
  return directory
}

function createStore(directory: string) {
  const store = new WorkspaceStore({ databasePath: path.join(directory, 'clarity.sqlite3'), artifactDirectory: path.join(directory, 'artifacts'), legacyJsonPaths: [] })
  stores.push(store)
  return store
}

describe('Chunk 3 Stage 1 ingestion policy', () => {
  it('detects only explicit formats and validates structured content without pretending unsupported bytes are read', () => {
    expect(detectIngestionFormat('notes.md', 'application/octet-stream')).toBe('text/markdown')
    expect(detectIngestionFormat('table.csv', 'text/csv')).toBe('text/csv')
    expect(detectIngestionFormat('report.pdf', 'application/pdf')).toBeUndefined()

    expect(extractIngestionContent('facts.json', 'application/json', new TextEncoder().encode('{"ok":true}'))).toMatchObject({
      status: 'extracted', format: 'application/json', text: '{"ok":true}', characterCount: 11, lineCount: 1,
    })
    expect(extractIngestionContent('facts.json', 'application/json', new TextEncoder().encode('{bad'))).toMatchObject({ status: 'failed', format: 'application/json' })
    expect(extractIngestionContent('report.pdf', 'application/pdf', new Uint8Array([1, 2, 3]))).toMatchObject({ status: 'unsupported' })
    expect(extractIngestionContent('large.txt', 'text/plain', new Uint8Array(MAX_EXTRACTABLE_SOURCE_BYTES + 1))).toMatchObject({ status: 'failed', format: 'text/plain' })
    expect(extractManagedIngestionContent('large.txt', 'text/plain', MAX_EXTRACTABLE_SOURCE_BYTES + 1, new Uint8Array())).toMatchObject({ status: 'failed', format: 'text/plain' })
    expect(extractManagedIngestionContent('large.pdf', 'application/pdf', MAX_EXTRACTABLE_SOURCE_BYTES + 1, new Uint8Array())).toMatchObject({ status: 'unsupported' })
  })

  it('copies real selected bytes, extracts supported text, persists provenance, and survives restart', async () => {
    const directory = await createDirectory()
    const sourcePath = path.join(directory, 'operator-notes.md')
    const contents = '# Operator notes\n\nActual bytes selected by the operator.\n'
    await writeFile(sourcePath, contents, 'utf8')
    const store = createStore(directory)
    const workspace = await store.create('Stage 1 ingestion')
    const nodeId = 'file-node-operator-notes'
    const ingested = await store.ingestFileAsNode(workspace.id, sourcePath, {
      node: {
        id: nodeId,
        kind: 'paper',
        title: 'operator-notes.md',
        description: 'A file selected by the operator.',
        schemaType: 'ScholarlyArticle',
        status: 'candidate',
        tags: ['md'],
        provenance: 'Operator-selected local file',
        position: { x: 140, y: 120 },
      },
      originalName: 'operator-notes.md',
      mimeType: 'text/markdown',
    })
    const artifact = ingested.artifacts[0]
    expect(artifact).toMatchObject({
      originalName: 'operator-notes.md',
      nodeId,
      mimeType: 'text/markdown',
      status: 'stored',
      extractionStatus: 'extracted',
      extractionFormat: 'text/markdown',
      extractedText: contents,
      extractedCharacterCount: contents.length,
      extractedLineCount: 4,
    })
    expect(ingested.nodes[0]).toMatchObject({ id: nodeId, origin: 'human', sourceUri: `clarity://artifact/${artifact.id}` })
    expect(await readFile(store.resolveArtifactPath(artifact), 'utf8')).toBe(contents)
    expect(artifact.sha256).toBe(createHash('sha256').update(contents).digest('hex'))
    expect(ingested.activities.some((item) => item.entityType === 'artifact' && item.summary.includes('Extracted'))).toBe(true)

    await store.close()
    stores.splice(stores.indexOf(store), 1)
    const restarted = createStore(directory)
    const rehydrated = await restarted.read(workspace.id)
    expect(rehydrated.artifacts[0]).toMatchObject({ extractionStatus: 'extracted', extractedText: contents, nodeId })
  })

  it('stores unsupported bytes with an explicit unextracted state and retries without changing the digest', async () => {
    const directory = await createDirectory()
    const sourcePath = path.join(directory, 'archive.pdf')
    const bytes = Buffer.from('%PDF-operator-bytes%')
    await writeFile(sourcePath, bytes)
    const store = createStore(directory)
    const workspace = await store.create('Unsupported format state')
    const ingested = await store.ingestFileAsNode(workspace.id, sourcePath, {
      node: {
        id: 'unsupported-file-node', kind: 'paper', title: 'archive.pdf', description: '', schemaType: 'ScholarlyArticle', status: 'candidate', tags: [], provenance: 'Operator-selected local file', position: { x: 140, y: 120 },
      },
      originalName: 'archive.pdf', mimeType: 'application/pdf',
    })
    const artifact = ingested.artifacts[0]
    expect(artifact).toMatchObject({ extractionStatus: 'unsupported', extractionError: expect.stringContaining('not supported') })
    expect(artifact.extractedText).toBeUndefined()
    const retried = await store.retryArtifactExtraction(workspace.id, artifact.id)
    expect(retried).toMatchObject({ id: artifact.id, extractionStatus: 'unsupported', sha256: artifact.sha256 })
    expect(await readFile(store.resolveArtifactPath(artifact))).toEqual(bytes)
    await writeFile(store.resolveArtifactPath(artifact), Buffer.from('%PDF-tampered%'))
    await expect(store.retryArtifactExtraction(workspace.id, artifact.id)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })
  })
})
