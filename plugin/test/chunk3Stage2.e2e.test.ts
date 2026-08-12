// @vitest-environment node

import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startClarityPluginServer, type RunningClarityServer } from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'

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

function sourceNode(id: string, title: string, kind: 'paper' | 'dataset') {
  return {
    id,
    kind,
    title,
    description: `Operator-selected ${title}.`,
    schemaType: kind === 'dataset' ? 'Dataset' : 'ScholarlyArticle',
    status: 'candidate' as const,
    tags: [],
    provenance: 'Selected by the operator for Chunk 3 Stage 2 acceptance.',
    position: { x: 120, y: 120 },
  }
}

describe('Chunk 3 Stage 2 extracted-content boundary', () => {
  it('exposes only bounded extracted content through MCP and preserves truthful unsupported state across restart', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk3-stage2-e2e-'))
    temporaryDirectories.push(directory)
    const databasePath = path.join(directory, 'clarity.sqlite3')
    const artifactDirectory = path.join(directory, 'artifacts')
    const markdownPath = path.join(directory, 'operator-notes.md')
    const pdfPath = path.join(directory, 'unreadable.pdf')
    const markdown = `${'Extracted operator content. '.repeat(12)}\n`
    const pdf = Buffer.from('%PDF bytes are stored but never extracted%')
    await writeFile(markdownPath, markdown, 'utf8')
    await writeFile(pdfPath, pdf)

    const desktop = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    stores.push(desktop)
    await desktop.initialize()
    const created = await desktop.create('Chunk 3 Stage 2 acceptance')
    const ingestedMarkdown = await desktop.ingestFileAsNode(created.id, markdownPath, {
      node: sourceNode('node-extracted-markdown', 'operator-notes.md', 'paper'),
      originalName: 'operator-notes.md',
      mimeType: 'text/markdown',
    })
    const ingestedPdf = await desktop.ingestFileAsNode(created.id, pdfPath, {
      node: sourceNode('node-unsupported-pdf', 'unreadable.pdf', 'paper'),
      originalName: 'unreadable.pdf',
      mimeType: 'application/pdf',
    })
    const extractedArtifact = ingestedMarkdown.artifacts.find((artifact) => artifact.originalName === 'operator-notes.md')
    const unsupportedArtifact = ingestedPdf.artifacts.find((artifact) => artifact.originalName === 'unreadable.pdf')
    expect(extractedArtifact).toMatchObject({ extractionStatus: 'extracted', extractedText: markdown })
    expect(unsupportedArtifact).toMatchObject({ extractionStatus: 'unsupported', extractedText: undefined })
    expect(await readFile(desktop.resolveArtifactPath(unsupportedArtifact!))).toEqual(pdf)
    const sourceDigest = createHash('sha256').update(markdown).digest('hex')
    expect(extractedArtifact?.sha256).toBe(sourceDigest)
    await desktop.close()
    stores.splice(stores.indexOf(desktop), 1)

    const server = await startClarityPluginServer({ databaseFile: databasePath, artifactDirectory, legacyJsonPaths: [], host: '127.0.0.1', port: 0 })
    servers.push(server)
    const client = new Client({ name: 'clarity-chunk3-stage2-e2e', version: '0.5.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
    clients.push(client)

    const workspaceResult = await client.callTool({ name: 'get_clarity_workspace', arguments: { workspace_id: created.id } })
    expect(workspaceResult.isError).not.toBe(true)
    const publicWorkspace = structured<{ workspace: { artifacts: Array<Record<string, unknown>>; artifactCount?: number; artifactsTruncated?: boolean } }>(workspaceResult).workspace
    expect(publicWorkspace.artifactCount).toBe(2)
    expect(publicWorkspace.artifactsTruncated).toBe(false)
    expect(publicWorkspace.artifacts.find((artifact) => artifact.id === extractedArtifact?.id)).toMatchObject({ extractionStatus: 'extracted' })
    expect(publicWorkspace.artifacts.every((artifact) => !('extractedText' in artifact))).toBe(true)
    expect(JSON.stringify(publicWorkspace)).not.toContain(markdown)
    expect(JSON.stringify(publicWorkspace)).not.toContain(pdf.toString('utf8'))

    const firstPage = structured<{ artifacts: Array<{ id: string; extractionStatus: string }>; totalCount: number; nextCursor: string | null }>(await client.callTool({
      name: 'list_workspace_artifacts',
      arguments: { workspace_id: created.id, page_size: 1 },
    }))
    expect(firstPage.artifacts).toHaveLength(1)
    expect(firstPage.totalCount).toBe(2)
    expect(firstPage.nextCursor).toBe('1')
    const secondPage = structured<{ artifacts: Array<{ id: string; extractionStatus: string }>; nextCursor: string | null }>(await client.callTool({
      name: 'list_workspace_artifacts',
      arguments: { workspace_id: created.id, cursor: firstPage.nextCursor!, page_size: 1 },
    }))
    expect(secondPage.artifacts).toHaveLength(1)
    expect(secondPage.nextCursor).toBeNull()
    expect(new Set([...firstPage.artifacts, ...secondPage.artifacts].map((artifact) => artifact.id))).toEqual(new Set([extractedArtifact?.id, unsupportedArtifact?.id]))

    const bounded = structured<{
      artifactId: string
      extractionStatus: string
      content: string
      returnedCharacterCount: number
      returnedByteCount: number
      totalCharacterCount: number
      totalByteCount: number
      truncated: boolean
      sourceSha256: string
    }>(await client.callTool({
      name: 'get_extracted_artifact_content',
      arguments: { workspace_id: created.id, artifact_id: extractedArtifact?.id, max_characters: 40 },
    }))
    expect(bounded).toMatchObject({ artifactId: extractedArtifact?.id, extractionStatus: 'extracted', truncated: true, sourceSha256: sourceDigest })
    expect(bounded.content).toBe(Array.from(markdown).slice(0, 40).join(''))
    expect(bounded.returnedCharacterCount).toBe(40)
    expect(bounded.returnedByteCount).toBe(Buffer.byteLength(bounded.content, 'utf8'))
    expect(bounded.totalCharacterCount).toBe(Array.from(markdown).length)
    expect(bounded.totalByteCount).toBe(Buffer.byteLength(markdown, 'utf8'))
    expect(JSON.stringify(bounded).length).toBeLessThan(100_000)

    const denied = await client.callTool({ name: 'get_extracted_artifact_content', arguments: { workspace_id: created.id, artifact_id: unsupportedArtifact?.id } })
    expect(denied.isError).toBe(true)
    expect((denied.content[0] as { text: string }).text).toContain('ARTIFACT_CONTENT_UNAVAILABLE')
    expect((denied.content[0] as { text: string }).text).not.toContain(pdf.toString('utf8'))

    const inspected = structured<{ artifacts: Array<{ id: string; extractionStatus: string; extractedText?: string }> }>(await client.callTool({
      name: 'inspect_clarity_node',
      arguments: { workspace_id: created.id, node_id: 'node-unsupported-pdf' },
    }))
    expect(inspected.artifacts).toEqual([expect.objectContaining({ id: unsupportedArtifact?.id, extractionStatus: 'unsupported' })])
    expect(inspected.artifacts[0]).not.toHaveProperty('extractedText')

    await client.close()
    clients.splice(clients.indexOf(client), 1)
    await server.close()
    servers.splice(servers.indexOf(server), 1)

    const restarted = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    stores.push(restarted)
    await restarted.initialize()
    const durable = await restarted.read(created.id)
    expect(durable.artifacts.find((artifact) => artifact.id === extractedArtifact?.id)).toMatchObject({ extractionStatus: 'extracted', extractedText: markdown, sha256: sourceDigest })
    expect(durable.artifacts.find((artifact) => artifact.id === unsupportedArtifact?.id)).toMatchObject({ extractionStatus: 'unsupported', extractedText: undefined, sha256: createHash('sha256').update(pdf).digest('hex') })

    await writeFile(restarted.resolveArtifactPath(extractedArtifact!), 'tampered-but-same-or-different-size', 'utf8')
    await expect(restarted.retryArtifactExtraction(created.id, extractedArtifact!.id)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })

    const integrityServer = await startClarityPluginServer({ databaseFile: databasePath, artifactDirectory, legacyJsonPaths: [], host: '127.0.0.1', port: 0 })
    servers.push(integrityServer)
    const integrityClient = new Client({ name: 'clarity-chunk3-stage2-integrity', version: '0.5.0' })
    await integrityClient.connect(new StreamableHTTPClientTransport(new URL(integrityServer.mcpUrl)))
    clients.push(integrityClient)
    const integrityDenied = await integrityClient.callTool({ name: 'get_extracted_artifact_content', arguments: { workspace_id: created.id, artifact_id: extractedArtifact!.id } })
    expect(integrityDenied.isError).toBe(true)
    expect((integrityDenied.content[0] as { text: string }).text).toContain('ARTIFACT_INTEGRITY_MISMATCH')
    expect((integrityDenied.content[0] as { text: string }).text).not.toContain(markdown)
  })
})
