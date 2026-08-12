// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { WorkspaceStore } from '../src/store.js'
import { WorkflowService } from '../src/workflowService.js'
import { fixtureCandidate as candidate, populateFixtureWorkspace, SOURCE_IDS } from './fixtures.js'

const temporaryDirectories: string[] = []
const stores: WorkspaceStore[] = []

afterEach(async () => {
  await Promise.all(stores.splice(0).map((store) => store.close()))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createService() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-plugin-service-'))
  temporaryDirectories.push(directory)
  const store = new WorkspaceStore({
    databasePath: path.join(directory, 'clarity.sqlite3'),
    artifactDirectory: path.join(directory, 'artifacts'),
    legacyJsonPaths: [],
  })
  stores.push(store)
  await store.initialize()
  await populateFixtureWorkspace(store)
  const service = new WorkflowService(store)
  await service.initialize()
  return service
}

describe('Clarity two-gate workflow service', () => {
  it('stages without graph mutation and commits only with a short-lived human challenge', async () => {
    const service = await createService()
    const before = await service.getWorkspace()
    const prepared = await service.prepareContext({
      intent: 'Synthesize and pressure-test the storage hypothesis.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })

    expect(prepared.preGate).toEqual({ passed: true, issues: [] })
    expect(prepared.contextId).toMatch(/^context-/)

    const staged = await service.stageCandidate(prepared.contextId!, candidate)
    expect(staged.postGate).toEqual({ passed: true, issues: [] })
    expect(staged.run?.status).toBe('awaiting_approval')
    expect((await service.getWorkspace()).nodes).toHaveLength(before.nodes.length)

    const challenge = await service.issueApprovalChallenge(before.id, staged.run!.id)
    await expect(service.approve(before.id, staged.run!.id, 'not-the-human-token')).rejects.toMatchObject({ code: 'INVALID_APPROVAL' })

    const approved = await service.approve(before.id, staged.run!.id, challenge.approvalToken)
    expect(approved.activeRun?.status).toBe('committed')
    expect(approved.workspace.nodes).toHaveLength(before.nodes.length + 1)
    const committedNode = approved.workspace.nodes.find((node) => node.id === approved.activeRun?.committedNodeId)
    const committedEdges = approved.workspace.edges.filter((edge) => edge.target === approved.activeRun?.committedNodeId)
    expect(committedNode?.status).toBe('complete')
    expect(committedEdges).toHaveLength(2)
    expect(committedNode?.createdAt).toBe(approved.activeRun?.updatedAt)
    expect(committedNode?.updatedAt).toBe(approved.activeRun?.updatedAt)
    expect(committedEdges.every((edge) => edge.createdAt === approved.activeRun?.updatedAt && edge.updatedAt === approved.activeRun?.updatedAt)).toBe(true)
  })

  it('rejects a source bundle that fails the adjustable pre-tool gate', async () => {
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Pressure-test a claim without a dataset.',
      sourceNodeIds: [SOURCE_IDS.paper],
      policy: { minimumSources: 2, requireDataset: true },
    })

    expect(prepared.contextId).toBeNull()
    expect(prepared.preGate.passed).toBe(false)
    expect(prepared.preGate.issues).toContain('Select at least 2 source node(s).')
    expect(prepared.preGate.issues).toContain('The active gate policy requires at least one dataset.')
  })

  it('rejects evidence that was not admitted through the prepared context', async () => {
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Create a bounded candidate.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })

    const staged = await service.stageCandidate(prepared.contextId!, {
      ...candidate,
      evidenceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.unselected],
    })

    expect(staged.run).toBeNull()
    expect(staged.postGate.passed).toBe(false)
    expect(staged.postGate.issues[0]).toContain(SOURCE_IDS.unselected)
  })

  it('rejects a staged result without mutating the graph', async () => {
    const service = await createService()
    const before = await service.getWorkspace()
    const prepared = await service.prepareContext({
      intent: 'Create a candidate for review.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    const staged = await service.stageCandidate(prepared.contextId!, candidate)
    const challenge = await service.issueApprovalChallenge(before.id, staged.run!.id)
    const rejected = await service.reject(before.id, staged.run!.id, challenge.approvalToken)

    expect(rejected.activeRun?.status).toBe('rejected')
    expect(rejected.workspace.nodes).toHaveLength(before.nodes.length)
    expect(rejected.workspace.edges).toHaveLength(before.edges.length)
  })
})
