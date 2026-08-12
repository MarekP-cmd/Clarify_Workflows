// @vitest-environment node

import { describe, expect, it } from 'vitest'
import { candidateResultSchema, clarityEdgeSchema, clarityNodeSchema, gatePolicySchema, workspaceSchema } from '../src/schema.js'
import { createEmptyWorkspace } from '../src/store.js'
import { fixtureCandidate, fixtureEdges, fixtureNodes, SOURCE_IDS } from './fixtures.js'

function createFixtureWorkspace() {
  const workspace = createEmptyWorkspace('Schema Test Workspace', 'workspace-schema-test')
  workspace.nodes = structuredClone(fixtureNodes)
  workspace.edges = structuredClone(fixtureEdges)
  return workspace
}

function createRelationalWorkspace() {
  const workspace = createFixtureWorkspace()
  const timestamp = workspace.createdAt

  workspace.projects = [{
    id: 'project-schema-test',
    workspaceId: workspace.id,
    name: 'Schema test project',
    description: 'A fully linked project used to exercise relational validation.',
    status: 'active',
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.nodes[0].projectId = workspace.projects[0].id
  workspace.edges[0].projectId = workspace.projects[0].id
  workspace.artifacts = [{
    id: 'artifact-schema-test',
    workspaceId: workspace.id,
    nodeId: SOURCE_IDS.paper,
    originalName: 'schema-test.txt',
    storageKey: 'workspace-schema-test/artifact-schema-test',
    mimeType: 'text/plain',
    sizeBytes: 12,
    sha256: 'a'.repeat(64),
    status: 'stored',
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.annotations = [{
    id: 'annotation-schema-test',
    workspaceId: workspace.id,
    nodeId: SOURCE_IDS.paper,
    author: 'human',
    origin: 'local',
    body: 'A linked schema-test annotation.',
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.workflowDefinitions = [{
    id: 'workflow-schema-test',
    workspaceId: workspace.id,
    projectId: workspace.projects[0].id,
    name: 'Schema test workflow',
    revision: 1,
    status: 'active',
    specification: { purpose: 'schema validation' },
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.runs = [{
    id: 'run-schema-test',
    workspaceId: workspace.id,
    projectId: workspace.projects[0].id,
    contextId: 'context-schema-test',
    intent: 'Exercise every relational workspace invariant.',
    sourceNodeIds: [SOURCE_IDS.paper],
    evidenceRevision: workspace.revision,
    status: 'awaiting_approval',
    preGate: { passed: true, issues: [] },
    postGate: { passed: true, issues: [] },
    candidate: {
      ...structuredClone(fixtureCandidate),
      evidenceNodeIds: [SOURCE_IDS.paper],
    },
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.gates = [{
    id: 'gate-schema-test',
    workspaceId: workspace.id,
    name: 'Schema test pre-gate',
    kind: 'pre',
    enabled: true,
    rules: { minimumSources: 1 },
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.approvals = [{
    id: 'approval-schema-test',
    workspaceId: workspace.id,
    runId: workspace.runs[0].id,
    status: 'pending',
    createdAt: timestamp,
    updatedAt: timestamp,
  }]
  workspace.activities.push({
    id: 'activity-schema-test',
    workspaceId: workspace.id,
    actor: 'human',
    action: 'updated',
    entityType: 'node',
    entityId: SOURCE_IDS.paper,
    summary: 'Linked the schema-test node.',
    changedFields: ['projectId'],
    createdAt: timestamp,
  })
  return workspace
}

function expectCustomIssue(
  workspace: ReturnType<typeof createRelationalWorkspace>,
  message: string,
  path: string[],
) {
  const result = workspaceSchema.safeParse(workspace)
  expect(result.success).toBe(false)
  if (!result.success) {
    expect(result.error.issues).toContainEqual({
      code: 'custom',
      message,
      path,
    })
  }
}

describe('Clarity schema loop and boundary validation', () => {
  it('detects duplicate node IDs, duplicate edge IDs, and dangling edge endpoints', () => {
    const duplicateNode = createFixtureWorkspace()
    duplicateNode.nodes.push(structuredClone(duplicateNode.nodes[0]))
    const duplicateNodeResult = workspaceSchema.safeParse(duplicateNode)
    expect(duplicateNodeResult.success).toBe(false)
    if (!duplicateNodeResult.success) {
      expect(duplicateNodeResult.error.issues).toContainEqual(expect.objectContaining({
        code: 'custom',
        message: `Duplicate node id: ${duplicateNode.nodes[0].id}`,
        path: ['nodes'],
      }))
    }

    const duplicateEdge = createFixtureWorkspace()
    duplicateEdge.edges.push(structuredClone(duplicateEdge.edges[0]))
    const duplicateEdgeResult = workspaceSchema.safeParse(duplicateEdge)
    expect(duplicateEdgeResult.success).toBe(false)
    if (!duplicateEdgeResult.success) {
      expect(duplicateEdgeResult.error.issues).toContainEqual(expect.objectContaining({
        code: 'custom',
        message: `Duplicate edge id: ${duplicateEdge.edges[0].id}`,
        path: ['edges'],
      }))
    }

    const missingSource = createFixtureWorkspace()
    missingSource.edges[0].source = 'missing-node'
    const missingSourceResult = workspaceSchema.safeParse(missingSource)
    expect(missingSourceResult.success).toBe(false)
    if (!missingSourceResult.success) {
      expect(missingSourceResult.error.issues).toContainEqual(expect.objectContaining({
        code: 'custom',
        message: `Edge ${missingSource.edges[0].id} references a missing node.`,
        path: ['edges'],
      }))
    }

    const missingTarget = createFixtureWorkspace()
    missingTarget.edges[0].target = 'missing-node'
    const missingTargetResult = workspaceSchema.safeParse(missingTarget)
    expect(missingTargetResult.success).toBe(false)
    if (!missingTargetResult.success) {
      expect(missingTargetResult.error.issues).toContainEqual(expect.objectContaining({
        code: 'custom',
        message: `Edge ${missingTarget.edges[0].id} references a missing node.`,
        path: ['edges'],
      }))
    }
  })

  it('enforces finite graph positions and strict node contracts at their boundaries', () => {
    const node = createFixtureWorkspace().nodes[0]
    expect(clarityNodeSchema.safeParse(node).success).toBe(true)
    expect(clarityNodeSchema.safeParse({ ...node, position: { x: Number.NaN, y: 0 } }).success).toBe(false)
    expect(clarityNodeSchema.safeParse({ ...node, position: { x: 100_001, y: 0 } }).success).toBe(false)
    expect(clarityNodeSchema.safeParse({ ...node, hiddenCapability: true }).success).toBe(false)
  })

  it('rejects whitespace-only graph identity fields and normalizes valid surrounding whitespace', () => {
    const edge = createFixtureWorkspace().edges[0]
    expect(clarityNodeSchema.safeParse({ ...createFixtureWorkspace().nodes[0], id: '   ' }).success).toBe(false)
    expect(clarityNodeSchema.safeParse({ ...createFixtureWorkspace().nodes[0], title: '\n' }).success).toBe(false)
    expect(clarityEdgeSchema.safeParse({ ...edge, relation: '\t' }).success).toBe(false)
    expect(clarityEdgeSchema.parse({ ...edge, relation: '  supports  ' }).relation).toBe('supports')
  })

  it('enforces adjustable gate-policy and candidate-result input limits', () => {
    expect(gatePolicySchema.safeParse({ minimumSources: 1, requireDataset: false }).success).toBe(true)
    expect(gatePolicySchema.safeParse({ minimumSources: 0, requireDataset: false }).success).toBe(false)
    expect(gatePolicySchema.safeParse({ minimumSources: 9, requireDataset: true }).success).toBe(false)

    const candidate = {
      title: 'Schema boundary result',
      synthesis: 'A sufficiently detailed synthesis for the schema boundary test.',
      hypothesis: 'A sufficiently detailed hypothesis.',
      counterargument: 'A sufficiently detailed counterargument.',
      pressureTest: 'A sufficiently detailed pressure test.',
      decision: 'inconclusive',
      confidence: 0,
      evidenceNodeIds: [SOURCE_IDS.paper],
    }
    expect(candidateResultSchema.safeParse(candidate).success).toBe(true)
    expect(candidateResultSchema.safeParse({ ...candidate, confidence: -0.001 }).success).toBe(false)
    expect(candidateResultSchema.safeParse({ ...candidate, confidence: 1.001 }).success).toBe(false)
    expect(candidateResultSchema.safeParse({ ...candidate, evidenceNodeIds: [] }).success).toBe(false)
    expect(candidateResultSchema.safeParse({ ...candidate, execute: true }).success).toBe(false)
  })

  it('accepts a workspace whose projects and workflow records are fully linked', () => {
    const workspace = createRelationalWorkspace()
    const result = workspaceSchema.safeParse(workspace)

    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data).toMatchObject({
        id: workspace.id,
        projects: [{ id: workspace.projects[0].id, workspaceId: workspace.id }],
        artifacts: [{ id: workspace.artifacts[0].id, nodeId: SOURCE_IDS.paper }],
        annotations: [{ id: workspace.annotations[0].id, nodeId: SOURCE_IDS.paper }],
        workflowDefinitions: [{ id: workspace.workflowDefinitions[0].id, projectId: workspace.projects[0].id }],
        runs: [{ id: workspace.runs[0].id, sourceNodeIds: [SOURCE_IDS.paper] }],
        approvals: [{ runId: workspace.runs[0].id, status: 'pending' }],
      })
    }
  })

  it('rejects duplicate and cross-workspace projects plus missing graph projects', () => {
    const duplicateProject = createRelationalWorkspace()
    duplicateProject.projects.push(structuredClone(duplicateProject.projects[0]))
    expectCustomIssue(
      duplicateProject,
      `Duplicate project id: ${duplicateProject.projects[0].id}`,
      ['projects'],
    )

    const crossWorkspaceProject = createRelationalWorkspace()
    crossWorkspaceProject.projects[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceProject,
      `Project ${crossWorkspaceProject.projects[0].id} belongs to another workspace.`,
      ['projects'],
    )

    const missingNodeProject = createRelationalWorkspace()
    missingNodeProject.nodes[0].projectId = 'project-missing'
    expectCustomIssue(
      missingNodeProject,
      `Node ${missingNodeProject.nodes[0].id} references a missing project.`,
      ['nodes'],
    )

    const missingEdgeProject = createRelationalWorkspace()
    missingEdgeProject.edges[0].projectId = 'project-missing'
    expectCustomIssue(
      missingEdgeProject,
      `Edge ${missingEdgeProject.edges[0].id} references a missing project.`,
      ['edges'],
    )
  })

  it('rejects duplicate, cross-workspace, and dangling artifacts independently', () => {
    const duplicateArtifact = createRelationalWorkspace()
    duplicateArtifact.artifacts.push(structuredClone(duplicateArtifact.artifacts[0]))
    expectCustomIssue(
      duplicateArtifact,
      `Duplicate artifact id: ${duplicateArtifact.artifacts[0].id}`,
      ['artifacts'],
    )

    const crossWorkspaceArtifact = createRelationalWorkspace()
    crossWorkspaceArtifact.artifacts[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceArtifact,
      `Artifact ${crossWorkspaceArtifact.artifacts[0].id} has an invalid workspace or node.`,
      ['artifacts'],
    )

    const missingArtifactNode = createRelationalWorkspace()
    missingArtifactNode.artifacts[0].nodeId = 'node-missing'
    expectCustomIssue(
      missingArtifactNode,
      `Artifact ${missingArtifactNode.artifacts[0].id} has an invalid workspace or node.`,
      ['artifacts'],
    )
  })

  it('rejects duplicate, cross-workspace, and dangling annotations independently', () => {
    const duplicateAnnotation = createRelationalWorkspace()
    duplicateAnnotation.annotations.push(structuredClone(duplicateAnnotation.annotations[0]))
    expectCustomIssue(
      duplicateAnnotation,
      `Duplicate annotation id: ${duplicateAnnotation.annotations[0].id}`,
      ['annotations'],
    )

    const crossWorkspaceAnnotation = createRelationalWorkspace()
    crossWorkspaceAnnotation.annotations[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceAnnotation,
      `Annotation ${crossWorkspaceAnnotation.annotations[0].id} has an invalid workspace or node.`,
      ['annotations'],
    )

    const missingAnnotationNode = createRelationalWorkspace()
    missingAnnotationNode.annotations[0].nodeId = 'node-missing'
    expectCustomIssue(
      missingAnnotationNode,
      `Annotation ${missingAnnotationNode.annotations[0].id} has an invalid workspace or node.`,
      ['annotations'],
    )
  })

  it('rejects duplicate and invalid workflow definitions and runs', () => {
    const duplicateDefinition = createRelationalWorkspace()
    duplicateDefinition.workflowDefinitions.push(structuredClone(duplicateDefinition.workflowDefinitions[0]))
    expectCustomIssue(
      duplicateDefinition,
      `Duplicate workflow definition id: ${duplicateDefinition.workflowDefinitions[0].id}`,
      ['workflowDefinitions'],
    )

    const crossWorkspaceDefinition = createRelationalWorkspace()
    crossWorkspaceDefinition.workflowDefinitions[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceDefinition,
      `Workflow definition ${crossWorkspaceDefinition.workflowDefinitions[0].id} has an invalid workspace or project.`,
      ['workflowDefinitions'],
    )

    const missingDefinitionProject = createRelationalWorkspace()
    missingDefinitionProject.workflowDefinitions[0].projectId = 'project-missing'
    expectCustomIssue(
      missingDefinitionProject,
      `Workflow definition ${missingDefinitionProject.workflowDefinitions[0].id} has an invalid workspace or project.`,
      ['workflowDefinitions'],
    )

    const duplicateRun = createRelationalWorkspace()
    duplicateRun.runs.push(structuredClone(duplicateRun.runs[0]))
    expectCustomIssue(duplicateRun, `Duplicate run id: ${duplicateRun.runs[0].id}`, ['runs'])

    const crossWorkspaceRun = createRelationalWorkspace()
    crossWorkspaceRun.runs[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceRun,
      `Run ${crossWorkspaceRun.runs[0].id} has an invalid workspace or project.`,
      ['runs'],
    )

    const missingRunProject = createRelationalWorkspace()
    missingRunProject.runs[0].projectId = 'project-missing'
    expectCustomIssue(
      missingRunProject,
      `Run ${missingRunProject.runs[0].id} has an invalid workspace or project.`,
      ['runs'],
    )
  })

  it('rejects run source, evidence, prepared-context, and commit reference violations', () => {
    const missingSource = createRelationalWorkspace()
    missingSource.runs[0].sourceNodeIds = ['node-missing']
    expectCustomIssue(
      missingSource,
      `Run ${missingSource.runs[0].id} references missing source node node-missing.`,
      ['runs'],
    )

    const missingEvidence = createRelationalWorkspace()
    missingEvidence.runs[0].sourceNodeIds.push('node-missing')
    missingEvidence.runs[0].candidate.evidenceNodeIds = ['node-missing']
    expectCustomIssue(
      missingEvidence,
      `Run ${missingEvidence.runs[0].id} references missing evidence node node-missing.`,
      ['runs'],
    )

    const evidenceOutsideSources = createRelationalWorkspace()
    evidenceOutsideSources.runs[0].candidate.evidenceNodeIds = [SOURCE_IDS.dataset]
    expectCustomIssue(
      evidenceOutsideSources,
      `Run ${evidenceOutsideSources.runs[0].id} uses evidence ${SOURCE_IDS.dataset} outside its prepared sources.`,
      ['runs'],
    )

    const missingCommittedNode = createRelationalWorkspace()
    missingCommittedNode.runs[0].status = 'rejected'
    missingCommittedNode.runs[0].committedNodeId = 'node-missing'
    missingCommittedNode.approvals[0].status = 'rejected'
    expectCustomIssue(
      missingCommittedNode,
      `Run ${missingCommittedNode.runs[0].id} references missing committed node node-missing.`,
      ['runs'],
    )

    const committedWithoutNode = createRelationalWorkspace()
    committedWithoutNode.runs[0].status = 'committed'
    committedWithoutNode.approvals[0].status = 'approved'
    expectCustomIssue(
      committedWithoutNode,
      `Committed run ${committedWithoutNode.runs[0].id} has no committed node.`,
      ['runs'],
    )
  })

  it('rejects duplicate and cross-workspace gates', () => {
    const duplicateGate = createRelationalWorkspace()
    duplicateGate.gates.push(structuredClone(duplicateGate.gates[0]))
    expectCustomIssue(duplicateGate, `Duplicate gate id: ${duplicateGate.gates[0].id}`, ['gates'])

    const crossWorkspaceGate = createRelationalWorkspace()
    crossWorkspaceGate.gates[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceGate,
      `Gate ${crossWorkspaceGate.gates[0].id} belongs to another workspace.`,
      ['gates'],
    )
  })

  it('rejects invalid, duplicate, missing, and status-conflicting approvals', () => {
    const duplicateApproval = createRelationalWorkspace()
    duplicateApproval.approvals.push(structuredClone(duplicateApproval.approvals[0]))
    expectCustomIssue(
      duplicateApproval,
      `Duplicate approval id: ${duplicateApproval.approvals[0].id}`,
      ['approvals'],
    )

    const crossWorkspaceApproval = createRelationalWorkspace()
    crossWorkspaceApproval.approvals[0].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceApproval,
      `Approval ${crossWorkspaceApproval.approvals[0].id} has an invalid workspace or run.`,
      ['approvals'],
    )

    const missingApprovalRun = createRelationalWorkspace()
    missingApprovalRun.approvals[0].runId = 'run-missing'
    expectCustomIssue(
      missingApprovalRun,
      `Approval ${missingApprovalRun.approvals[0].id} has an invalid workspace or run.`,
      ['approvals'],
    )

    const multipleApprovals = createRelationalWorkspace()
    multipleApprovals.approvals.push({
      ...structuredClone(multipleApprovals.approvals[0]),
      id: 'approval-schema-test-second',
    })
    expectCustomIssue(
      multipleApprovals,
      `Run ${multipleApprovals.runs[0].id} has more than one approval record.`,
      ['approvals'],
    )

    const noApproval = createRelationalWorkspace()
    noApproval.approvals = []
    expectCustomIssue(noApproval, `Run ${noApproval.runs[0].id} has no approval record.`, ['approvals'])

    const awaitingConflict = createRelationalWorkspace()
    awaitingConflict.approvals[0].status = 'approved'
    expectCustomIssue(
      awaitingConflict,
      `Run ${awaitingConflict.runs[0].id} status awaiting_approval conflicts with approval status approved.`,
      ['approvals'],
    )

    const committedConflict = createRelationalWorkspace()
    committedConflict.runs[0].status = 'committed'
    committedConflict.runs[0].committedNodeId = SOURCE_IDS.paper
    expectCustomIssue(
      committedConflict,
      `Run ${committedConflict.runs[0].id} status committed conflicts with approval status pending.`,
      ['approvals'],
    )

    const rejectedConflict = createRelationalWorkspace()
    rejectedConflict.runs[0].status = 'rejected'
    expectCustomIssue(
      rejectedConflict,
      `Run ${rejectedConflict.runs[0].id} status rejected conflicts with approval status pending.`,
      ['approvals'],
    )
  })

  it('rejects duplicate and cross-workspace activity records', () => {
    const duplicateActivity = createRelationalWorkspace()
    duplicateActivity.activities.push(structuredClone(duplicateActivity.activities[1]))
    expectCustomIssue(
      duplicateActivity,
      `Duplicate activity id: ${duplicateActivity.activities[1].id}`,
      ['activities'],
    )

    const crossWorkspaceActivity = createRelationalWorkspace()
    crossWorkspaceActivity.activities[1].workspaceId = 'workspace-elsewhere'
    expectCustomIssue(
      crossWorkspaceActivity,
      `Activity ${crossWorkspaceActivity.activities[1].id} belongs to another workspace.`,
      ['activities'],
    )
  })
})
