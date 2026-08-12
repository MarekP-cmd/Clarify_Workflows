// @vitest-environment node

import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkflowService } from '../src/workflowService.js'
import { WorkspaceStore } from '../src/store.js'
import type { CandidateResult, ClarityNode } from '../src/types.js'

const temporaryDirectories: string[] = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

const candidate: CandidateResult = {
  title: 'Integrity-bound candidate',
  synthesis: 'The exact admitted managed passage is required before any review state may advance.',
  hypothesis: 'Re-verification closes the admission-to-stage and challenge-to-approval integrity gaps.',
  counterargument: 'Cached citation text could become detached from changed managed bytes.',
  pressureTest: 'Change managed bytes at each trust boundary and verify every durable state remains unchanged.',
  decision: 'positive',
  confidence: 0.9,
  evidenceNodeIds: ['paper-graybox'],
}

function node(id: string, title: string, description: string, status: ClarityNode['status'] = 'verified'): ClarityNode {
  return {
    id,
    kind: 'paper',
    origin: 'human',
    title,
    description,
    schemaType: 'ScholarlyArticle',
    status,
    tags: ['gray-box'],
    provenance: 'Controlled gray-box test source.',
    position: { x: 0, y: 0 },
  }
}

describe('Chunk 4 release gray-box integrity boundaries', () => {
  it('re-verifies managed citation bytes before staging and again before approval', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-release-graybox-'))
    temporaryDirectories.push(directory)
    const sourcePath = path.join(directory, 'graybox.md')
    const originalText = '# Gray-box evidence\ngraybox-integrity-token remains exact.\n'
    await writeFile(sourcePath, originalText, 'utf8')
    const store = new WorkspaceStore({
      databasePath: path.join(directory, 'clarity.sqlite3'),
      artifactDirectory: path.join(directory, 'artifacts'),
      legacyJsonPaths: [],
    })
    await store.initialize()
    const empty = await store.create('Chunk 4 gray-box integrity')
    const workspace = await store.ingestFileAsNode(empty.id, sourcePath, {
      node: node('paper-graybox', 'Gray-box source', 'Managed-byte integrity fixture.'),
      originalName: 'graybox.md',
      mimeType: 'text/markdown',
    })
    const service = new WorkflowService(store)
    const page = await service.searchWorkspace(workspace.id, {
      query: 'graybox-integrity-token',
      sourceKinds: ['artifact'],
      expectedWorkspaceRevision: workspace.revision,
    })
    const result = page.results[0]!
    const prepared = await service.prepareContext({
      workspaceId: workspace.id,
      intent: 'Exercise citation integrity at every workflow trust boundary.',
      sourceNodeIds: ['paper-graybox'],
      policy: { minimumSources: 1, requireDataset: false },
    })
    await service.admitSearchCitations(prepared.contextId!, [{
      resultId: result.resultId,
      expectedWorkspaceRevision: page.workspaceRevision,
      expectedContentHash: result.provenance.contentHash,
    }])
    const artifact = (await store.read(workspace.id)).artifacts[0]!
    const managedPath = store.resolveArtifactPath(artifact)

    await writeFile(managedPath, '# Gray-box evidence\ntampered-before-stage-token.\n', 'utf8')
    await expect(service.stageCandidate(prepared.contextId!, candidate)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })
    let durable = await store.read(workspace.id)
    expect(durable.runs).toHaveLength(0)
    expect(durable.approvals).toHaveLength(0)
    expect(durable.revision).toBe(workspace.revision)

    await writeFile(managedPath, originalText, 'utf8')
    const originalFetch = store.fetchSearchPassage.bind(store)
    let tamperAfterStageFetch = true
    store.fetchSearchPassage = async (...arguments_) => {
      const passage = await originalFetch(...arguments_)
      if (tamperAfterStageFetch) {
        tamperAfterStageFetch = false
        await writeFile(managedPath, '# Gray-box evidence\ntampered-after-stage-fetch.\n', 'utf8')
      }
      return passage
    }
    await expect(service.stageCandidate(prepared.contextId!, candidate)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })
    durable = await store.read(workspace.id)
    expect(durable.revision).toBe(workspace.revision)
    expect(durable.runs).toHaveLength(0)
    expect(durable.approvals).toHaveLength(0)

    store.fetchSearchPassage = originalFetch
    await writeFile(managedPath, originalText, 'utf8')
    const staged = await service.stageCandidate(prepared.contextId!, candidate)
    expect(staged.run?.status).toBe('awaiting_approval')
    const challenge = await service.issueApprovalChallenge(workspace.id, staged.run!.id)
    await writeFile(managedPath, '# Gray-box evidence\ntampered-before-approval.\n', 'utf8')
    await expect(service.approve(workspace.id, staged.run!.id, challenge.approvalToken)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })

    durable = await store.read(workspace.id)
    expect(durable.revision).toBe(workspace.revision)
    expect(durable.runs[0]?.status).toBe('awaiting_approval')
    expect(durable.approvals[0]?.status).toBe('pending')
    expect(durable.nodes.some((item) => item.id === `result-${staged.run!.id}`)).toBe(false)

    await writeFile(managedPath, originalText, 'utf8')
    const retryChallenge = await service.issueApprovalChallenge(workspace.id, staged.run!.id)
    let tamperAfterApprovalFetch = true
    store.fetchSearchPassage = async (...arguments_) => {
      const passage = await originalFetch(...arguments_)
      if (tamperAfterApprovalFetch) {
        tamperAfterApprovalFetch = false
        await writeFile(managedPath, '# Gray-box evidence\ntampered-after-approval-fetch.\n', 'utf8')
      }
      return passage
    }
    await expect(service.approve(workspace.id, staged.run!.id, retryChallenge.approvalToken)).rejects.toMatchObject({ code: 'ARTIFACT_INTEGRITY_MISMATCH' })
    durable = await store.read(workspace.id)
    expect(durable.revision).toBe(workspace.revision)
    expect(durable.runs[0]?.status).toBe('awaiting_approval')
    expect(durable.approvals[0]?.status).toBe('pending')
    expect(durable.nodes.some((item) => item.id === `result-${staged.run!.id}`)).toBe(false)
    await expect(service.approve(workspace.id, staged.run!.id, retryChallenge.approvalToken)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await store.close()
  })

  it('denies a valid search result whose backing node was not selected by the prepared gate', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-release-source-gate-'))
    temporaryDirectories.push(directory)
    const store = new WorkspaceStore({
      databasePath: path.join(directory, 'clarity.sqlite3'),
      artifactDirectory: path.join(directory, 'artifacts'),
      legacyJsonPaths: [],
    })
    const empty = await store.create('Chunk 4 citation source gate')
    const workspace = await store.replaceGraph(empty.id, [
      node('paper-selected', 'Selected source', 'selected-source-token is admissible.'),
      node('paper-blocked', 'Unselected blocked source', 'blocked-source-token must never enter the context.', 'blocked'),
    ], [])
    const service = new WorkflowService(store)
    const page = await service.searchWorkspace(workspace.id, {
      query: 'blocked-source-token',
      sourceKinds: ['node'],
      nodeIds: ['paper-blocked'],
      expectedWorkspaceRevision: workspace.revision,
    })
    const prepared = await service.prepareContext({
      workspaceId: workspace.id,
      intent: 'Use only the explicitly selected source.',
      sourceNodeIds: ['paper-selected'],
      policy: { minimumSources: 1, requireDataset: false },
    })
    const result = page.results[0]!
    await expect(service.admitSearchCitations(prepared.contextId!, [{
      resultId: result.resultId,
      expectedWorkspaceRevision: page.workspaceRevision,
      expectedContentHash: result.provenance.contentHash,
    }])).rejects.toMatchObject({ code: 'CITATION_SOURCE_NOT_ADMITTED' })
    expect((await service.getPreparedSources(prepared.contextId!)).citations).toEqual([])
    expect((await store.read(workspace.id)).runs).toHaveLength(0)
    await store.close()
  })

  it('consumes a prepared context once and atomically closes sibling pending runs after approval', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk4-release-context-race-'))
    temporaryDirectories.push(directory)
    const store = new WorkspaceStore({
      databasePath: path.join(directory, 'clarity.sqlite3'),
      artifactDirectory: path.join(directory, 'artifacts'),
      legacyJsonPaths: [],
    })
    const empty = await store.create('Chunk 4 context race')
    const workspace = await store.replaceGraph(empty.id, [
      node('paper-graybox', 'Prepared source', 'One prepared context may stage only one run.'),
    ], [])
    const service = new WorkflowService(store)
    const prepare = () => service.prepareContext({
      workspaceId: workspace.id,
      intent: 'Exercise atomic prepared-context consumption.',
      sourceNodeIds: ['paper-graybox'],
      policy: { minimumSources: 1, requireDataset: false },
    })
    const firstContext = await prepare()
    const attempts = await Promise.allSettled([
      service.stageCandidate(firstContext.contextId!, candidate),
      service.stageCandidate(firstContext.contextId!, candidate),
    ])
    expect(attempts.filter((attempt) => attempt.status === 'fulfilled')).toHaveLength(1)
    expect(attempts.filter((attempt) => attempt.status === 'rejected').map((attempt) => (attempt as PromiseRejectedResult).reason.code))
      .toEqual(['CONTEXT_CONSUMED'])
    let durable = await store.read(workspace.id)
    expect(durable.runs).toHaveLength(1)
    const firstRun = durable.runs[0]!
    const returnedRun = (attempts.find((attempt) => attempt.status === 'fulfilled') as PromiseFulfilledResult<{ run: typeof firstRun | null }>).value.run
    expect(returnedRun).toEqual(firstRun)

    const secondContext = await prepare()
    const second = await service.stageCandidate(secondContext.contextId!, candidate)
    const challenge = await service.issueApprovalChallenge(workspace.id, firstRun.id)
    await service.approve(workspace.id, firstRun.id, challenge.approvalToken)
    durable = await store.read(workspace.id)
    expect(durable.runs.find((run) => run.id === firstRun.id)?.status).toBe('committed')
    expect(durable.runs.find((run) => run.id === second.run!.id)?.status).toBe('rejected')
    expect(durable.runs.some((run) => run.status === 'awaiting_approval')).toBe(false)
    expect(durable.approvals.some((approval) => approval.status === 'pending')).toBe(false)
    expect(durable.revision).toBe(workspace.revision + 1)
    expect(durable.nodes.some((item) => item.id === `result-${firstRun.id}`)).toBe(true)
    expect(durable.nodes.some((item) => item.id === `result-${second.run!.id}`)).toBe(false)
    expect(durable.approvals.find((approval) => approval.runId === second.run!.id)).toMatchObject({
      status: 'rejected',
      decidedBy: 'system-stale-evidence',
    })
    await store.close()
  })
})
