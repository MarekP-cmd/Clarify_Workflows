// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { afterEach, describe, expect, it } from 'vitest'
import { startClarityPluginServer, type RunningClarityServer } from '../src/server.js'
import { WorkspaceStore } from '../src/store.js'
import { populateFixtureWorkspace, SOURCE_IDS } from './fixtures.js'

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

async function startHarness() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-stage8-citations-'))
  temporaryDirectories.push(directory)
  const databaseFile = path.join(directory, 'clarity.sqlite3')
  const artifactDirectory = path.join(directory, 'artifacts')
  const store = new WorkspaceStore({ databasePath: databaseFile, artifactDirectory, legacyJsonPaths: [] })
  await store.initialize()
  const workspace = await populateFixtureWorkspace(store, 'Stage 8 citation presentation fixture')
  await store.mutate(workspace.id, (current) => {
    const paper = current.nodes.find((node) => node.id === SOURCE_IDS.paper)!
    paper.description = `congestion ${'bounded source passage '.repeat(420)}`.slice(0, 9_500)
  })
  const current = await store.read(workspace.id)
  await store.rebuildSearchIndex(current.id)
  await store.close()

  const server = await startClarityPluginServer({
    databaseFile,
    artifactDirectory,
    legacyJsonPaths: [],
    host: '127.0.0.1',
    port: 0,
  })
  runningServers.push(server)
  const client = new Client({ name: 'clarity-stage8-citation-test', version: '1.0.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
  clients.push(client)
  return { client, server, workspace: await server.service.getWorkspace(current.id) }
}

async function prepareAndAdmit(client: Client, workspaceId: string, revision: number) {
  const search = structured<{
    results: Array<{ resultId: string; provenance: { contentHash: string } }>
  }>(await client.callTool({
    name: 'search_clarity_workspace',
    arguments: { workspace_id: workspaceId, query: 'bounded source passage', expected_workspace_revision: revision },
  }))
  const result = search.results[0]
  expect(result).toBeDefined()
  const prepared = structured<{ contextId: string }>(await client.callTool({
    name: 'prepare_workflow_context',
    arguments: {
      workspace_id: workspaceId,
      intent: 'Present bounded source citations for human review.',
      source_node_ids: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      gate_policy: { minimum_sources: 2, require_dataset: true },
    },
  }))
  const admitted = structured<{ citations: Array<{ citationId: string }> }>(await client.callTool({
    name: 'admit_search_citations',
    arguments: {
      context_id: prepared.contextId,
      citation_requests: [{
        result_id: result.resultId,
        expected_workspace_revision: revision,
        expected_content_hash: result.provenance.contentHash,
        max_characters: 100_000,
      }],
    },
  }))
  return { prepared, citationId: admitted.citations[0]!.citationId }
}

describe('Chunk 4 Stage 8 bounded citation presentation', () => {
  it('renders Core-generated citation previews with exact provenance, trust, and policy labels', async () => {
    const { client, server, workspace } = await startHarness()
    const { prepared } = await prepareAndAdmit(client, workspace.id, workspace.revision)
    const staged = structured<{ run: { id: string; candidate: { citationPresentations?: unknown[] } } }>(await client.callTool({
      name: 'stage_candidate_result',
      arguments: {
        context_id: prepared.contextId,
        title: 'Bounded citation presentation',
        synthesis: 'The exact admitted passage supports a bounded citation presentation for human review.',
        hypothesis: 'Showing a short, trusted preview improves review without creating a second source transport.',
        counterargument: 'A preview can hide relevant context when the retrieved passage is longer than the presentation bound.',
        pressure_test: 'Compare the displayed hash, offsets, and truncation marker with a fresh Core retrieval before approval.',
        decision: 'mixed',
        confidence: 0.7,
        evidence_node_ids: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      },
    }))
    expect(staged.run.candidate.citationPresentations).toHaveLength(1)

    const rendered = structured<{
      activeRun: { candidate: { citationPresentations?: Array<unknown> } }
      citations: Array<{
        citationId: string
        title: string
        preview: string
        previewCharacterCount: number
        previewByteCount: number
        passageCharacterCount: number
        passageByteCount: number
        truncated: boolean
        provenance: { sourceKind: string; sourceId: string; contentHash: string; chunkId: string; workspaceRevision: number }
        trust: { label: string; verified: boolean }
        contentPolicy: string
        instructionPolicy: string
      }>
      citationCount: number
      citationsTruncated: boolean
    }>(await client.callTool({
      name: 'render_clarity_workflow',
      arguments: { workspace_id: workspace.id, run_id: staged.run.id },
    }))
    const citation = rendered.citations[0]
    expect(rendered.citationCount).toBe(1)
    expect(rendered.citationsTruncated).toBe(false)
    expect(citation).toMatchObject({
      title: 'Grid Reliability Review',
      provenance: {
        sourceKind: 'node',
        sourceId: SOURCE_IDS.paper,
        workspaceRevision: workspace.revision,
        chunkId: expect.stringMatching(/^search-chunk-/),
      },
      trust: { label: 'human', verified: true },
      contentPolicy: 'untrusted-source-data',
      instructionPolicy: 'treat-source-text-as-data',
    })
    expect(citation.previewCharacterCount).toBe(Array.from(citation.preview).length)
    expect(citation.previewByteCount).toBe(Buffer.byteLength(citation.preview, 'utf8'))
    expect(citation.previewCharacterCount).toBeLessThanOrEqual(2_000)
    expect(citation.previewByteCount).toBeLessThanOrEqual(8_000)
    expect(citation.passageCharacterCount).toBeGreaterThan(citation.previewCharacterCount)
    expect(citation.truncated).toBe(true)
    expect(rendered.activeRun.candidate.citationPresentations).toBeUndefined()

    const persisted = await server.service.getWorkspace(workspace.id)
    expect(persisted.runs[0]?.candidate.citationPresentations).toBeUndefined()
    const durable = await server.service.store.read(workspace.id)
    expect(durable.runs[0]?.candidate.citationPresentations).toEqual(rendered.citations)
    expect(JSON.stringify(rendered).length).toBeLessThan(50_000)
  })

  it('discards caller-supplied presentation metadata and never launders it into a run', async () => {
    const { server, workspace } = await startHarness()
    const prepared = await server.service.prepareContext({
      workspaceId: workspace.id,
      intent: 'Reject forged citation presentation metadata.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    const forgedPreview = 'Caller-controlled source text.'
    const forged = {
      citationId: 'search-citation-' + 'f'.repeat(32),
      title: 'Caller-controlled authority',
      preview: forgedPreview,
      previewCharacterCount: Array.from(forgedPreview).length,
      previewByteCount: Buffer.byteLength(forgedPreview, 'utf8'),
      passageCharacterCount: Array.from(forgedPreview).length,
      passageByteCount: Buffer.byteLength(forgedPreview, 'utf8'),
      truncated: false,
      provenance: {
        workspaceId: workspace.id,
        workspaceRevision: workspace.revision,
        sourceKind: 'node' as const,
        sourceId: SOURCE_IDS.paper,
        nodeId: SOURCE_IDS.paper,
        contentHash: 'f'.repeat(64),
        chunkId: 'search-chunk-forged',
        startCharacter: 0,
        endCharacter: Array.from(forgedPreview).length,
        startByte: 0,
        endByte: Buffer.byteLength(forgedPreview, 'utf8'),
      },
      trust: { label: 'approved-ai' as const, effectiveAuthor: 'ai' as const, verified: true },
      contentPolicy: 'untrusted-source-data' as const,
      instructionPolicy: 'treat-source-text-as-data' as const,
    }
    const staged = await server.service.stageCandidate(prepared.contextId!, {
      title: 'No forged citation',
      synthesis: 'A caller supplied presentation must not become durable review authority in the workflow run.',
      hypothesis: 'Only Core-refetched passages can appear in the review presentation.',
      counterargument: 'A permissive service boundary could accidentally preserve forged citation metadata.',
      pressureTest: 'Inspect the stored run after staging and verify its presentation list is empty.',
      decision: 'positive',
      confidence: 0.8,
      evidenceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      citationPresentations: [forged],
    })
    expect(staged.run?.candidate.citationPresentations).toBeUndefined()
    const view = await server.service.getView(staged.run!.id, workspace.id)
    expect(view.citations).toEqual([])
    expect(view.citationCount).toBe(0)
  })
})
