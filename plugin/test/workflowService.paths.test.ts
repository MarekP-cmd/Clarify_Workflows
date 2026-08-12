// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceStore } from '../src/store.js'
import { WorkflowService } from '../src/workflowService.js'
import type { CandidateResult } from '../src/types.js'
import { populateFixtureWorkspace, SOURCE_IDS } from './fixtures.js'

const temporaryDirectories: string[] = []
const stores: WorkspaceStore[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(stores.splice(0).map((store) => store.close()))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function createService() {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-plugin-paths-'))
  temporaryDirectories.push(directory)
  const store = new WorkspaceStore({ databasePath: path.join(directory, 'clarity.sqlite3'), artifactDirectory: path.join(directory, 'artifacts'), legacyJsonPaths: [] })
  stores.push(store)
  await store.initialize()
  await populateFixtureWorkspace(store)
  const service = new WorkflowService(store)
  await service.initialize()
  return service
}

const validCandidate: CandidateResult = {
  title: 'Bounded path-test result',
  synthesis: 'The admitted paper and dataset support a bounded association suitable for controlled review.',
  hypothesis: 'A stable input condition improves the measured outcome for a defined subgroup.',
  counterargument: 'Selection bias and baseline differences may account for the observed association.',
  pressureTest: 'Stratify by baseline and compare preregistered held-out effect sizes against the null.',
  decision: 'mixed',
  confidence: 0.61,
  evidenceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
}

async function stage(service: WorkflowService, candidate = validCandidate) {
  const prepared = await service.prepareContext({
    intent: 'Exercise the complete bounded workflow path.',
    sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
    policy: { minimumSources: 2, requireDataset: true },
  })
  return service.stageCandidate(prepared.contextId!, candidate)
}

describe('WorkflowService path and loop coverage', () => {
  it('inspects both incoming and outgoing relations and rejects unknown identities', async () => {
    const service = await createService()
    const inspection = await service.inspectNode(SOURCE_IDS.hypothesis)
    expect(inspection.incoming.length).toBeGreaterThan(0)
    expect(inspection.outgoing.length).toBeGreaterThan(0)
    await expect(service.inspectNode('missing-node')).rejects.toMatchObject({ code: 'NODE_NOT_FOUND' })
    await expect(service.getWorkspace('missing-workspace')).rejects.toMatchObject({ code: 'WORKSPACE_NOT_FOUND' })
  })

  it('deduplicates source IDs while preserving the selected-source relationship bundle', async () => {
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Test duplicate source handling.',
      sourceNodeIds: [SOURCE_IDS.hypothesis, SOURCE_IDS.dataset, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    expect(prepared.sourceNodeIds).toEqual([SOURCE_IDS.hypothesis, SOURCE_IDS.dataset])
    const bundle = await service.getPreparedSources(prepared.contextId!)
    expect(bundle.sources.map((node) => node.id)).toEqual([SOURCE_IDS.hypothesis, SOURCE_IDS.dataset])
    expect(bundle.relationships).toEqual([
      expect.objectContaining({ source: SOURCE_IDS.hypothesis, target: SOURCE_IDS.dataset }),
    ])
  })

  it('includes selected-node notes in a count- and byte-bounded prepared context', async () => {
    const service = await createService()
    const workspace = await service.store.read()
    await service.store.mutate(workspace.id, (current) => {
      for (let index = 0; index < 101; index += 1) {
        const timestamp = new Date(Date.parse(current.updatedAt) + index + 1).toISOString()
        current.annotations.push({
          id: `annotation-prepared-${String(index).padStart(3, '0')}`,
          workspaceId: current.id,
          nodeId: SOURCE_IDS.paper,
          author: 'human',
          body: index === 100 ? 'Newest exact operator note for bounded synthesis.' : `Bounded operator note ${index}: ${'x'.repeat(1_200)}`,
          createdAt: timestamp,
          updatedAt: timestamp,
        })
      }
    })
    const prepared = await service.prepareContext({
      intent: 'Use first-class annotations during bounded synthesis.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    const bundle = await service.getPreparedSources(prepared.contextId!)
    expect(bundle.annotationCount).toBe(101)
    expect(bundle.annotationsTruncated).toBe(true)
    expect(bundle.annotations.length).toBeLessThanOrEqual(100)
    expect(Buffer.byteLength(JSON.stringify(bundle.annotations), 'utf8')).toBeLessThanOrEqual(100_500)
    expect(bundle.annotations).toEqual(expect.arrayContaining([
      expect.objectContaining({ body: 'Newest exact operator note for bounded synthesis.' }),
    ]))
  })

  it('supports an adjustable policy and reports unknown plus blocked source paths', async () => {
    const service = await createService()
    const relaxed = await service.prepareContext({
      intent: 'Run a one-source policy without a dataset.',
      sourceNodeIds: [SOURCE_IDS.paper],
      policy: { minimumSources: 1, requireDataset: false },
    })
    expect(relaxed.preGate.passed).toBe(true)

    await service.store.mutate((workspace) => {
      workspace.nodes.find((node) => node.id === SOURCE_IDS.dataset)!.status = 'blocked'
    })
    const rejected = await service.prepareContext({
      intent: 'Exercise blocked and unknown source paths.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset, 'unknown-node'],
      policy: { minimumSources: 3, requireDataset: true },
    })
    expect(rejected.preGate.passed).toBe(false)
    expect(rejected.preGate.issues).toEqual(expect.arrayContaining([
      'Unknown source nodes: unknown-node.',
      'Select at least 3 source node(s).',
      'Outage History Fixture: source is blocked.',
    ]))
  })

  it('refuses to prepare workflow context from an archived side project', async () => {
    const service = await createService()
    const current = await service.store.read()
    const project = { id: 'project-archived-context', name: 'Archived sources', description: 'Read-only source cluster.', status: 'active' as const }
    const populated = await service.store.saveHumanWorkspace(current.id, {
      expectedRevision: current.revision,
      name: current.name,
      status: current.status,
      projects: [project],
      nodes: current.nodes.map((node) => ({ ...node, projectId: project.id })),
      edges: current.edges.map((edge) => ({ ...edge, projectId: project.id })),
      annotations: [],
    })
    await service.store.saveHumanWorkspace(current.id, {
      expectedRevision: populated.revision,
      name: populated.name,
      status: populated.status,
      projects: [{ ...project, status: 'archived' }],
      nodes: populated.nodes,
      edges: populated.edges,
      annotations: [],
    })

    const prepared = await service.prepareContext({
      intent: 'Attempt to use archived project sources.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    expect(prepared.preGate.passed).toBe(false)
    expect(prepared.contextId).toBeNull()
    expect(prepared.preGate.issues).toEqual(expect.arrayContaining([
      'Grid Reliability Review: source belongs to an archived project.',
      'Outage History Fixture: source belongs to an archived project.',
    ]))
  })

  it('keeps a context after a failed post-gate attempt and consumes it after success', async () => {
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Retry a rejected candidate without bypassing the original context.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    const rejected = await service.stageCandidate(prepared.contextId!, {
      ...validCandidate,
      evidenceNodeIds: [],
    })
    expect(rejected.run).toBeNull()
    expect(rejected.postGate.issues).toContain('At least one prepared source must be linked as evidence.')

    const accepted = await service.stageCandidate(prepared.contextId!, validCandidate)
    expect(accepted.run?.status).toBe('awaiting_approval')
    await expect(service.stageCandidate(prepared.contextId!, validCandidate)).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' })
  })

  it('invalidates a prepared context when the authoritative workspace changes', async () => {
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Reject stale evidence bundles before staging.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })

    await service.store.mutate((workspace) => {
      const source = workspace.nodes.find((node) => node.id === SOURCE_IDS.paper)!
      source.description = 'The human operator changed this evidence after context preparation.'
    })

    await expect(service.stageCandidate(prepared.contextId!, validCandidate)).rejects.toMatchObject({ code: 'CONTEXT_STALE' })
    await expect(service.getPreparedSources(prepared.contextId!)).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' })
    expect((await service.store.read()).runs).toHaveLength(0)
  })

  it('rejects malformed candidate fields and evidence outside the admitted context', async () => {
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Exercise all post-gate error branches.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    const rejected = await service.stageCandidate(prepared.contextId!, {
      ...validCandidate,
      title: 'x',
      confidence: 2,
      evidenceNodeIds: [SOURCE_IDS.unselected],
    })
    expect(rejected.run).toBeNull()
    expect(rejected.postGate.issues.join(' ')).toMatch(/title|confidence/)
    expect(rejected.postGate.issues.join(' ')).toContain(SOURCE_IDS.unselected)
  })

  it('expires prepared contexts and approval challenges on their independent clocks', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-11T00:00:00.000Z'))
    const service = await createService()
    const prepared = await service.prepareContext({
      intent: 'Test context expiration.',
      sourceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
      policy: { minimumSources: 2, requireDataset: true },
    })
    vi.advanceTimersByTime(15 * 60 * 1000 + 1)
    await expect(service.getPreparedSources(prepared.contextId!)).rejects.toMatchObject({ code: 'CONTEXT_NOT_FOUND' })

    const staged = await stage(service)
    const challenge = await service.issueApprovalChallenge((await service.getWorkspace()).id, staged.run!.id)
    vi.advanceTimersByTime(10 * 60 * 1000 + 1)
    await expect(service.approve(challenge.workspaceId, staged.run!.id, challenge.approvalToken)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
  })

  it('enforces approval state transitions and does not mutate the graph on rejection', async () => {
    const service = await createService()
    const before = await service.getWorkspace()
    const staged = await stage(service)
    const challenge = await service.issueApprovalChallenge(before.id, staged.run!.id)
    const rejected = await service.reject(before.id, staged.run!.id, challenge.approvalToken)
    expect(rejected.safety.humanApproval).toBe('rejected')
    expect(rejected.workspace.nodes).toHaveLength(before.nodes.length)
    await expect(service.issueApprovalChallenge(before.id, staged.run!.id)).rejects.toMatchObject({ code: 'RUN_NOT_PENDING' })
    await expect(service.approve(before.id, staged.run!.id, challenge.approvalToken)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })
    await expect(service.getView('unknown-run')).rejects.toMatchObject({ code: 'RUN_NOT_FOUND' })
  })

  it('rejects a post-stage reserved result identity injection without certifying the existing node', async () => {
    const service = await createService()
    const staged = await stage(service)
    const reservedId = `result-${staged.run!.id}`
    const challenge = await service.issueApprovalChallenge((await service.getWorkspace()).id, staged.run!.id)
    await service.store.mutate((workspace) => {
      const template = workspace.nodes.find((node) => node.id === SOURCE_IDS.paper)!
      workspace.nodes.push({
        ...structuredClone(template),
        id: reservedId,
        title: 'Human node occupying a reserved result identity',
        aiAnnotation: undefined,
      })
    })

    await expect(service.approve(challenge.workspaceId, staged.run!.id, challenge.approvalToken)).rejects.toMatchObject({ code: 'APPROVAL_STALE' })
    const after = await service.store.read()
    expect(after.runs.find((run) => run.id === staged.run!.id)).toMatchObject({ status: 'awaiting_approval', committedNodeId: undefined })
    expect(after.nodes.find((node) => node.id === reservedId)?.title).toBe('Human node occupying a reserved result identity')
    expect(after.approvals.find((approval) => approval.runId === staged.run!.id)?.status).toBe('pending')
  })

  it('binds approval challenges to one workspace and invalidates review after any intervening mutation', async () => {
    const service = await createService()
    const firstWorkspace = await service.getWorkspace()
    const staged = await stage(service)
    const challenge = await service.issueApprovalChallenge(firstWorkspace.id, staged.run!.id)
    const secondWorkspace = await service.store.create('Separate approval workspace')

    await expect(service.approve(secondWorkspace.id, staged.run!.id, challenge.approvalToken)).rejects.toMatchObject({ code: 'APPROVAL_REQUIRED' })

    await service.store.mutate(firstWorkspace.id, (workspace) => {
      workspace.name = 'Changed after the approval UI opened'
    })
    await expect(service.approve(firstWorkspace.id, staged.run!.id, challenge.approvalToken)).rejects.toMatchObject({ code: 'APPROVAL_STALE' })
    const after = await service.store.read(firstWorkspace.id)
    expect(after.runs.find((run) => run.id === staged.run!.id)?.status).toBe('awaiting_approval')
    expect(after.approvals.find((approval) => approval.runId === staged.run!.id)?.status).toBe('pending')
  })

  it('refuses to open approval after staged evidence has changed', async () => {
    const service = await createService()
    const workspace = await service.getWorkspace()
    const staged = await stage(service)
    await service.store.mutate(workspace.id, (current) => {
      current.nodes.find((node) => node.id === SOURCE_IDS.paper)!.provenance = 'Changed after candidate staging.'
    })

    await expect(service.issueApprovalChallenge(workspace.id, staged.run!.id)).rejects.toMatchObject({ code: 'STAGED_EVIDENCE_STALE' })
    const after = await service.store.read(workspace.id)
    expect(after.runs.find((run) => run.id === staged.run!.id)?.status).toBe('awaiting_approval')
    expect(after.nodes.some((node) => node.id === `result-${staged.run!.id}`)).toBe(false)
  })

  it('retains more than one hundred run/approval pairs and resolves an older pending run explicitly', async () => {
    const service = await createService()
    const stagedRuns = []
    for (let index = 0; index < 101; index += 1) stagedRuns.push((await stage(service)).run!)

    const persisted = await service.store.read()
    expect(persisted.runs).toHaveLength(101)
    expect(persisted.approvals).toHaveLength(101)
    const oldestView = await service.getView(stagedRuns[0].id)
    expect(oldestView.activeRun?.id).toBe(stagedRuns[0].id)
    expect(oldestView.activeRun?.status).toBe('awaiting_approval')
    expect(oldestView.workspace.runs).toHaveLength(20)
  }, 20_000)

  it('serializes a concurrent mutation loop without losing updates', async () => {
    const service = await createService()
    await Promise.all(Array.from({ length: 40 }, (_, index) => service.store.mutate((workspace) => {
      workspace.name = `mutation-${index}`
    })))
    expect((await service.getWorkspace()).name).toBe('mutation-39')
  })
})
