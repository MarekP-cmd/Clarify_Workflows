// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { CLARITY_TOOL_COUNT, startClarityPluginServer, type RunningClarityServer } from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'

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

describe('Chunk 4 release black-box journey', () => {
  it('crosses real ingestion, automatic indexing, live MCP grounding, review, and approval', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-release-blackbox-'))
    temporaryDirectories.push(directory)
    const databaseFile = path.join(directory, 'clarity.sqlite3')
    const artifactDirectory = path.join(directory, 'artifacts')
    const sourcePath = path.join(directory, 'operator-evidence.md')
    const sourceText = '# Operator evidence\nrelease-chain-token proves the fresh-ingest path is searchable.\n'
    await writeFile(sourcePath, sourceText, 'utf8')

    const store = new WorkspaceStore({ databasePath: databaseFile, artifactDirectory, legacyJsonPaths: [] })
    await store.initialize()
    const empty = await store.create('Chunk 4 release black-box')
    const workspace = await store.ingestFileAsNode(empty.id, sourcePath, {
      node: {
        id: 'paper-release-chain',
        kind: 'paper',
        origin: 'human',
        title: 'Release chain evidence',
        description: 'A real managed Markdown file used by the Chunk 4 release test.',
        schemaType: 'ScholarlyArticle',
        status: 'verified',
        tags: ['chunk4', 'release'],
        provenance: 'Created by the operator-facing ingestion boundary.',
        position: { x: 40, y: 60 },
      },
      originalName: 'operator-evidence.md',
      mimeType: 'text/markdown',
    })
    expect((await store.readSearchIndex(workspace.id)).state.status).toBe('unbuilt')
    await store.close()

    const server = await startClarityPluginServer({
      databaseFile,
      artifactDirectory,
      legacyJsonPaths: [],
      host: '127.0.0.1',
      port: 0,
    })
    runningServers.push(server)
    const client = new Client({ name: 'clarity-chunk4-release-blackbox', version: '1.0.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
    clients.push(client)

    const listed = await client.listTools()
    expect(listed.tools).toHaveLength(CLARITY_TOOL_COUNT)
    expect(listed.tools.some((tool) => /rebuild|index/i.test(tool.name))).toBe(false)

    const page = structured<{
      workspaceRevision: number
      results: Array<{ resultId: string; provenance: { contentHash: string } }>
    }>(await client.callTool({
      name: 'search_clarity_workspace',
      arguments: {
        workspace_id: workspace.id,
        query: 'release-chain-token',
        source_kinds: ['artifact'],
        expected_workspace_revision: workspace.revision,
      },
    }))
    expect(page.results).toHaveLength(1)
    const result = page.results[0]!

    const passage = structured<{
      citationId: string
      content: string
      contentCharacterCount: number
      provenance: { chunkId: string; contentHash: string }
    }>(await client.callTool({
      name: 'retrieve_search_passage',
      arguments: {
        workspace_id: workspace.id,
        result_id: result.resultId,
        expected_workspace_revision: page.workspaceRevision,
        expected_content_hash: result.provenance.contentHash,
      },
    }))
    expect(passage.content).toContain('release-chain-token')

    const prepared = structured<{ contextId: string }>(await client.callTool({
      name: 'prepare_workflow_context',
      arguments: {
        workspace_id: workspace.id,
        intent: 'Prove the complete grounded Chunk 4 release journey.',
        source_node_ids: ['paper-release-chain'],
        gate_policy: { minimum_sources: 1, require_dataset: false },
      },
    }))
    const admitted = structured<{ citations: Array<{ citationId: string }> }>(await client.callTool({
      name: 'admit_search_citations',
      arguments: {
        context_id: prepared.contextId,
        citation_requests: [{
          result_id: result.resultId,
          expected_workspace_revision: page.workspaceRevision,
          expected_content_hash: result.provenance.contentHash,
        }],
      },
    }))
    expect(admitted.citations[0]?.citationId).toBe(passage.citationId)

    const staged = structured<{ run: { id: string; status: string }; postGate: { passed: boolean } }>(await client.callTool({
      name: 'stage_candidate_result',
      arguments: {
        context_id: prepared.contextId,
        title: 'Grounded release result',
        synthesis: 'The exact managed artifact passed the complete bounded search and citation workflow.',
        hypothesis: 'Automatic projection maintenance makes a fresh real ingest immediately usable through MCP.',
        counterargument: 'A private test-only index hook could otherwise conceal an unusable production path.',
        pressure_test: 'Restart from an unbuilt projection and repeat search, retrieval, staging, rendering, and approval.',
        decision: 'positive',
        confidence: 0.91,
        evidence_node_ids: ['paper-release-chain'],
      },
    }))
    expect(staged.postGate.passed).toBe(true)
    expect(staged.run.status).toBe('awaiting_approval')

    const afterStage = await server.service.store.read(workspace.id)
    expect(afterStage.revision).toBe(workspace.revision)
    expect((await server.service.store.readSearchIndex(workspace.id)).state.status).toBe('ready')
    await expect(server.service.retrieveSearchPassage(workspace.id, {
      resultId: result.resultId,
      expectedWorkspaceRevision: page.workspaceRevision,
      expectedContentHash: result.provenance.contentHash,
    })).resolves.toMatchObject({ citationId: passage.citationId })

    const rendered = structured<{ citationCount: number; citations: unknown[] }>(await client.callTool({
      name: 'render_clarity_workflow',
      arguments: { workspace_id: workspace.id, run_id: staged.run.id },
    }))
    expect(rendered.citationCount).toBe(1)
    expect(rendered.citations).toHaveLength(1)

    const challenge = await server.service.issueApprovalChallenge(workspace.id, staged.run.id)
    const approved = await server.service.approve(workspace.id, staged.run.id, challenge.approvalToken)
    expect(approved.activeRun?.status).toBe('committed')
    const committed = await server.service.store.read(workspace.id)
    expect(committed.revision).toBe(workspace.revision + 1)
    expect(committed.nodes.some((node) => node.id === `result-${staged.run.id}`)).toBe(true)
    await expect(server.service.retrieveSearchPassage(workspace.id, {
      resultId: result.resultId,
      expectedWorkspaceRevision: page.workspaceRevision,
      expectedContentHash: result.provenance.contentHash,
    })).resolves.toMatchObject({ citationId: passage.citationId })
  })
})
