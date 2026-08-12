// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { CLARITY_TOOL_COUNT, startClarityPluginServer, type RunningClarityServer } from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'
import { populateFixtureWorkspace } from './fixtures.js'

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

async function startIndexedHarness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-stage6-mcp-'))
  temporaryDirectories.push(directory)
  const databaseFile = path.join(directory, 'clarity.sqlite3')
  const store = new WorkspaceStore({ databasePath: databaseFile, artifactDirectory: path.join(directory, 'artifacts'), legacyJsonPaths: [] })
  await store.initialize()
  const workspace = await populateFixtureWorkspace(store, 'Stage 6 MCP retrieval fixture')
  await store.rebuildSearchIndex(workspace.id)
  await store.close()

  const server = await startClarityPluginServer({
    databaseFile,
    artifactDirectory: path.join(directory, 'artifacts'),
    legacyJsonPaths: [],
    host: '127.0.0.1',
    port: 0,
  })
  runningServers.push(server)
  const client = new Client({ name: 'clarity-stage6-mcp-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
  clients.push(client)
  return { client, server, workspace }
}

describe('Chunk 4 Stage 6 MCP search and passage transport', () => {
  it('advertises bounded read-only search and retrieval tools and returns a validated passage', async () => {
    const { client, workspace } = await startIndexedHarness()
    const listed = await client.listTools()
    expect(listed.tools).toHaveLength(CLARITY_TOOL_COUNT)
    expect(listed.tools.map((tool) => tool.name)).toEqual(expect.arrayContaining([
      'search_clarity_workspace',
      'retrieve_search_passage',
    ]))
    expect(listed.tools.find((tool) => tool.name === 'search_clarity_workspace')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    })
    expect(listed.tools.find((tool) => tool.name === 'retrieve_search_passage')?.annotations).toMatchObject({
      readOnlyHint: true,
      openWorldHint: false,
      destructiveHint: false,
    })

    const searchResult = await client.callTool({
      name: 'search_clarity_workspace',
      arguments: {
        workspace_id: workspace.id,
        query: 'congestion',
        expected_workspace_revision: workspace.revision,
        limit: 10,
      },
    })
    expect(searchResult.isError).not.toBe(true)
    const page = structured<{
      contractVersion: number
      workspaceId: string
      workspaceRevision: number
      results: Array<{
        resultId: string
        provenance: { contentHash: string }
        trust: { label: string }
      }>
      totalCount: number
    }>(searchResult)
    expect(page.contractVersion).toBe(1)
    expect(page.workspaceId).toBe(workspace.id)
    expect(page.workspaceRevision).toBe(workspace.revision)
    expect(page.totalCount).toBeGreaterThan(0)
    expect(page.results.length).toBeGreaterThan(0)
    expect(Buffer.byteLength(JSON.stringify(page), 'utf8')).toBeLessThanOrEqual(256_000)

    const result = page.results[0]
    const passageResult = await client.callTool({
      name: 'retrieve_search_passage',
      arguments: {
        workspace_id: workspace.id,
        result_id: result.resultId,
        expected_workspace_revision: page.workspaceRevision,
        expected_content_hash: result.provenance.contentHash,
        max_characters: 24,
      },
    })
    expect(passageResult.isError).not.toBe(true)
    const passage = structured<{
      contractVersion: number
      citationId: string
      workspaceId: string
      workspaceRevision: number
      content: string
      contentCharacterCount: number
      contentByteCount: number
      truncated: boolean
      provenance: { contentHash: string; chunkId: string }
      trust: { label: string; verified: boolean }
      contentPolicy: string
      instructionPolicy: string
    }>(passageResult)
    expect(passage.contractVersion).toBe(1)
    expect(passage.citationId).toMatch(/^search-citation-/)
    expect(passage.workspaceId).toBe(workspace.id)
    expect(passage.workspaceRevision).toBe(page.workspaceRevision)
    expect(passage.contentCharacterCount).toBe(Array.from(passage.content).length)
    expect(passage.contentByteCount).toBe(Buffer.byteLength(passage.content, 'utf8'))
    expect(passage.provenance.contentHash).toBe(result.provenance.contentHash)
    expect(passage.provenance.chunkId).toBe(result.resultId)
    expect(passage.trust.label).toBe(result.trust.label)
    expect(passage.contentPolicy).toBe('untrusted-source-data')
    expect(passage.instructionPolicy).toBe('treat-source-text-as-data')
    expect(passageResult.content?.[0]).toMatchObject({ type: 'text' })
    expect((passageResult.content?.[0] as { text: string }).text).not.toContain(passage.content)
  })

  it('fails closed over MCP for stale revisions and wrong hashes, while activating a fresh projection', async () => {
    const { client, workspace } = await startIndexedHarness()
    const search = structured<{ results: Array<{ resultId: string; provenance: { contentHash: string } }> }>(await client.callTool({
      name: 'search_clarity_workspace',
      arguments: { workspace_id: workspace.id, query: 'grid', expected_workspace_revision: workspace.revision },
    }))
    const result = search.results[0]
    expect(result).toBeDefined()

    const stale = await client.callTool({
      name: 'retrieve_search_passage',
      arguments: {
        workspace_id: workspace.id,
        result_id: result.resultId,
        expected_workspace_revision: workspace.revision + 1,
        expected_content_hash: result.provenance.contentHash,
      },
    })
    expect(stale.isError).toBe(true)
    expect((stale.content?.[0] as { text: string }).text).toContain('SEARCH_INDEX_CONFLICT')
    expect((stale.content?.[0] as { text: string }).text).not.toContain(result.resultId)

    const wrongHash = await client.callTool({
      name: 'retrieve_search_passage',
      arguments: {
        workspace_id: workspace.id,
        result_id: result.resultId,
        expected_workspace_revision: workspace.revision,
        expected_content_hash: '0'.repeat(64),
      },
    })
    expect(wrongHash.isError).toBe(true)
    expect((wrongHash.content?.[0] as { text: string }).text).toContain('SEARCH_SOURCE_CHANGED')

    const unbuiltStore = new WorkspaceStore({
      databasePath: path.join(temporaryDirectories[0], 'unbuilt.sqlite3'),
      artifactDirectory: path.join(temporaryDirectories[0], 'unbuilt-artifacts'),
      legacyJsonPaths: [],
    })
    await unbuiltStore.initialize()
    const unbuiltWorkspace = await populateFixtureWorkspace(unbuiltStore, 'Unbuilt Stage 6 fixture')
    await unbuiltStore.close()
    const unbuiltServer = await startClarityPluginServer({
      databaseFile: path.join(temporaryDirectories[0], 'unbuilt.sqlite3'),
      artifactDirectory: path.join(temporaryDirectories[0], 'unbuilt-artifacts'),
      legacyJsonPaths: [],
      host: '127.0.0.1',
      port: 0,
    })
    runningServers.push(unbuiltServer)
    const unbuiltClient = new Client({ name: 'clarity-stage6-unbuilt-test', version: '1.0.0' })
    await unbuiltClient.connect(new StreamableHTTPClientTransport(new URL(unbuiltServer.mcpUrl)))
    clients.push(unbuiltClient)
    const unbuilt = await unbuiltClient.callTool({
      name: 'search_clarity_workspace',
      arguments: { workspace_id: unbuiltWorkspace.id, query: 'anything' },
    })
    expect(unbuilt.isError).not.toBe(true)
    expect(structured<{ totalCount: number }>(unbuilt).totalCount).toBe(0)
  })

  it('keeps transport input limits at the MCP boundary', async () => {
    const { client, workspace } = await startIndexedHarness()
    const tooLong = await client.callTool({
      name: 'search_clarity_workspace',
      arguments: { workspace_id: workspace.id, query: '🙂'.repeat(513) },
    })
    expect(tooLong.isError).toBe(true)

    const invalidHash = await client.callTool({
      name: 'retrieve_search_passage',
      arguments: {
        workspace_id: workspace.id,
        result_id: 'chunk-does-not-exist',
        expected_workspace_revision: workspace.revision,
        expected_content_hash: 'not-a-sha256',
      },
    })
    expect(invalidHash.isError).toBe(true)
  })
})
