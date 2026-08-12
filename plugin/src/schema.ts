import { z } from 'zod'
import {
  ACTIVITY_ACTIONS,
  ACTIVITY_ACTORS,
  ACTIVITY_ENTITY_TYPES,
  ANNOTATION_AUTHORS,
  ANNOTATION_ORIGINS,
  APPROVAL_STATUSES,
  ARTIFACT_STATUSES,
  DECISIONS,
  GATE_KINDS,
  INGESTION_FORMATS,
  EXTRACTION_STATUSES,
  NODE_KINDS,
  NODE_ORIGINS,
  NODE_STATUSES,
  PROJECT_STATUSES,
  RUN_STATUSES,
  WORKSPACE_STATUSES,
  WORKFLOW_STATUSES,
} from './types.js'

const identifierSchema = z.string().trim().min(1).max(160)
const timestampSchema = z.string().datetime({ offset: true }).max(100)
const jsonObjectSchema = z.record(z.string(), z.unknown())
// Keep this Core schema boundary independent from searchContract's Node-only
// hashing implementation; the desktop memory adapter imports schema.ts into
// the browser bundle.
const SEARCH_ADMITTED_CITATION_MAX = 8
const searchCitationIdReferenceSchema = z.string().regex(/^search-citation-[a-f0-9]{32}$/)
const SEARCH_CITATION_PRESENTATION_MAX_CHARACTERS = 2_000
const SEARCH_CITATION_PRESENTATION_MAX_BYTES = 8_000
const searchCitationPresentationPreviewSchema = z.string().superRefine((value, context) => {
  if (Array.from(value).length > SEARCH_CITATION_PRESENTATION_MAX_CHARACTERS) {
    context.addIssue({ code: 'custom', message: 'Citation previews are limited to 2,000 Unicode characters.' })
  }
  if (new TextEncoder().encode(value).byteLength > SEARCH_CITATION_PRESENTATION_MAX_BYTES) {
    context.addIssue({ code: 'custom', message: 'Citation previews are limited to 8,000 UTF-8 bytes.' })
  }
})
const searchCitationPresentationProvenanceSchema = z.object({
  workspaceId: identifierSchema,
  workspaceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sourceKind: z.enum(['node', 'annotation', 'artifact']),
  sourceId: identifierSchema,
  nodeId: identifierSchema.optional(),
  artifactId: identifierSchema.optional(),
  annotationId: identifierSchema.optional(),
  sourceUri: z.string().max(4_000).optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  extractionStatus: z.enum(EXTRACTION_STATUSES).optional(),
  extractionFormat: z.enum(INGESTION_FORMATS).optional(),
  chunkId: identifierSchema,
  startCharacter: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  endCharacter: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  startByte: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  endByte: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  startLine: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  endLine: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
}).strict().superRefine((value, context) => {
  if (value.endCharacter < value.startCharacter) {
    context.addIssue({ code: 'custom', message: 'Citation provenance endCharacter must not precede startCharacter.', path: ['endCharacter'] })
  }
  if (value.endByte < value.startByte) {
    context.addIssue({ code: 'custom', message: 'Citation provenance endByte must not precede startByte.', path: ['endByte'] })
  }
  const hasStartLine = value.startLine !== undefined
  const hasEndLine = value.endLine !== undefined
  if (hasStartLine !== hasEndLine) {
    context.addIssue({ code: 'custom', message: 'Citation provenance line offsets must be supplied together.', path: ['startLine'] })
  } else if (hasStartLine && hasEndLine && value.endLine! < value.startLine!) {
    context.addIssue({ code: 'custom', message: 'Citation provenance endLine must not precede startLine.', path: ['endLine'] })
  }
  const identityMatches = value.sourceKind === 'node'
    ? value.nodeId === value.sourceId && value.artifactId === undefined && value.annotationId === undefined
    : value.sourceKind === 'artifact'
      ? value.artifactId === value.sourceId && value.nodeId === undefined && value.annotationId === undefined
      : value.annotationId === value.sourceId && value.nodeId === undefined && value.artifactId === undefined
  if (!identityMatches) {
    context.addIssue({ code: 'custom', message: 'Citation provenance identity must match sourceKind and sourceId exactly.', path: ['sourceKind'] })
  }
  if (value.sourceKind === 'artifact') {
    if (value.extractionStatus !== 'extracted') {
      context.addIssue({ code: 'custom', message: 'Artifact citation provenance requires extracted content.', path: ['extractionStatus'] })
    }
    if (!value.sourceSha256) {
      context.addIssue({ code: 'custom', message: 'Artifact citation provenance requires the managed-byte SHA-256.', path: ['sourceSha256'] })
    }
    if (!value.extractionFormat) {
      context.addIssue({ code: 'custom', message: 'Artifact citation provenance requires an extraction format.', path: ['extractionFormat'] })
    }
  } else if (value.extractionStatus !== undefined || value.extractionFormat !== undefined || value.sourceSha256 !== undefined) {
    context.addIssue({ code: 'custom', message: 'Extraction metadata is only valid for artifact citation provenance.', path: ['sourceKind'] })
  }
})
const searchCitationPresentationTrustSchema = z.object({
  label: z.enum(['human', 'approved-ai', 'native-ai', 'native-system', 'imported-unverified', 'unknown']),
  effectiveAuthor: z.enum(['human', 'ai', 'system', 'unknown']),
  declaredAuthor: z.enum(ANNOTATION_AUTHORS).optional(),
  verified: z.boolean(),
}).strict()
export const citationPresentationSchema = z.object({
  citationId: searchCitationIdReferenceSchema,
  title: z.string().trim().min(1).max(500),
  preview: searchCitationPresentationPreviewSchema,
  previewCharacterCount: z.number().int().min(0).max(SEARCH_CITATION_PRESENTATION_MAX_CHARACTERS),
  previewByteCount: z.number().int().min(0).max(SEARCH_CITATION_PRESENTATION_MAX_BYTES),
  passageCharacterCount: z.number().int().min(0).max(100_000),
  passageByteCount: z.number().int().min(0).max(400_000),
  truncated: z.boolean(),
  provenance: searchCitationPresentationProvenanceSchema,
  trust: searchCitationPresentationTrustSchema,
  contentPolicy: z.literal('untrusted-source-data'),
  instructionPolicy: z.literal('treat-source-text-as-data'),
}).strict().superRefine((value, context) => {
  const actualPreviewCharacterCount = Array.from(value.preview).length
  const actualPreviewByteCount = new TextEncoder().encode(value.preview).byteLength
  const provenanceCharacterCount = value.provenance.endCharacter - value.provenance.startCharacter
  const provenanceByteCount = value.provenance.endByte - value.provenance.startByte
  if (value.previewCharacterCount !== actualPreviewCharacterCount) {
    context.addIssue({ code: 'custom', message: 'Citation preview character count must match the preview.', path: ['previewCharacterCount'] })
  }
  if (value.previewByteCount !== actualPreviewByteCount) {
    context.addIssue({ code: 'custom', message: 'Citation preview byte count must match the preview.', path: ['previewByteCount'] })
  }
  if (value.passageCharacterCount < value.previewCharacterCount || value.passageByteCount < value.previewByteCount) {
    context.addIssue({ code: 'custom', message: 'Citation preview cannot exceed the retrieved passage.', path: ['preview'] })
  }
  if (value.passageCharacterCount > provenanceCharacterCount) {
    context.addIssue({ code: 'custom', message: 'Citation passage character count cannot exceed its provenance span.', path: ['passageCharacterCount'] })
  }
  if (value.passageByteCount > provenanceByteCount) {
    context.addIssue({ code: 'custom', message: 'Citation passage byte count cannot exceed its provenance span.', path: ['passageByteCount'] })
  }
  if (!value.truncated && (
    value.previewCharacterCount !== value.passageCharacterCount
    || value.previewByteCount !== value.passageByteCount
    || value.passageCharacterCount !== provenanceCharacterCount
    || value.passageByteCount !== provenanceByteCount
  )) {
    context.addIssue({ code: 'custom', message: 'An untruncated citation must exactly cover its preview, passage, and provenance span.', path: ['truncated'] })
  }
})

export const gateReportSchema = z.object({
  passed: z.boolean(),
  issues: z.array(z.string().max(500)).max(50),
}).strict()

export const gatePolicySchema = z.object({
  minimumSources: z.number().int().min(1).max(8),
  requireDataset: z.boolean(),
}).strict()

export const clarityProjectSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  name: z.string().trim().min(1).max(500),
  description: z.string().max(10_000),
  status: z.enum(PROJECT_STATUSES),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const clarityNodeSchema = z.object({
  id: identifierSchema,
  projectId: identifierSchema.optional(),
  origin: z.enum(NODE_ORIGINS).default('human'),
  kind: z.enum(NODE_KINDS),
  title: z.string().trim().min(1).max(500),
  description: z.string().max(10_000),
  schemaType: z.string().trim().min(1).max(200),
  status: z.enum(NODE_STATUSES),
  tags: z.array(z.string().max(200)).max(100),
  provenance: z.string().trim().min(1).max(2_000),
  position: z.object({
    x: z.number().finite().min(-100_000).max(100_000),
    y: z.number().finite().min(-100_000).max(100_000),
  }).strict(),
  humanAnnotation: z.string().max(50_000).optional(),
  aiAnnotation: z.string().max(50_000).optional(),
  priority: z.enum(['low', 'medium', 'high']).optional(),
  evidenceCount: z.number().int().min(0).max(10_000_000).optional(),
  pinned: z.boolean().optional(),
  sourceUri: z.string().max(4_000).optional(),
  instruction: z.string().max(50_000).optional(),
  agentMode: z.enum(['off', 'suggest', 'verify', 'execute']).optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
}).strict()

export const clarityEdgeSchema = z.object({
  id: z.string().trim().min(1).max(200),
  projectId: identifierSchema.optional(),
  source: identifierSchema,
  target: identifierSchema,
  relation: z.string().trim().min(1).max(200),
  color: z.string().max(100).optional(),
  dashed: z.boolean().optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
}).strict()

export const clarityArtifactSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  nodeId: identifierSchema.optional(),
  originalName: z.string().trim().min(1).max(1_000),
  storageKey: z.string().trim().min(1).max(2_000),
  mimeType: z.string().trim().min(1).max(500),
  sizeBytes: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(ARTIFACT_STATUSES),
  extractionStatus: z.enum(EXTRACTION_STATUSES).default('pending'),
  extractionFormat: z.enum(INGESTION_FORMATS).optional(),
  extractedText: z.string().max(2_000_000).optional(),
  extractedByteCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  extractedCharacterCount: z.number().int().min(0).max(2_000_000).optional(),
  extractedLineCount: z.number().int().min(0).max(2_000_000).optional(),
  extractedAt: timestampSchema.optional(),
  extractionError: z.string().max(1_000).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const extractedArtifactContentSchema = z.object({
  workspaceId: identifierSchema,
  artifactId: identifierSchema,
  nodeId: identifierSchema.optional(),
  originalName: z.string().trim().min(1).max(1_000),
  mimeType: z.string().trim().min(1).max(500),
  extractionStatus: z.literal('extracted'),
  extractionFormat: z.enum(INGESTION_FORMATS),
  sourceSha256: z.string().regex(/^[a-f0-9]{64}$/),
  totalByteCount: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  totalCharacterCount: z.number().int().min(0).max(2_000_000),
  returnedByteCount: z.number().int().min(0).max(400_000),
  returnedCharacterCount: z.number().int().min(0).max(100_000),
  truncated: z.boolean(),
  content: z.string().max(400_000),
}).strict()

export const clarityArtifactSummarySchema = clarityArtifactSchema.omit({ extractedText: true })

export const artifactPageSchema = z.object({
  workspaceId: identifierSchema,
  artifacts: z.array(clarityArtifactSummarySchema).max(100),
  totalCount: z.number().int().min(0).max(20_000),
  nextCursor: z.string().regex(/^\d+$/).nullable(),
}).strict()

export const clarityAnnotationSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  nodeId: identifierSchema,
  author: z.enum(ANNOTATION_AUTHORS),
  origin: z.enum(ANNOTATION_ORIGINS).default('local'),
  declaredAuthor: z.enum(ANNOTATION_AUTHORS).optional(),
  body: z.string().trim().min(1).max(50_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const clarityActivitySchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  actor: z.enum(ACTIVITY_ACTORS),
  action: z.enum(ACTIVITY_ACTIONS),
  entityType: z.enum(ACTIVITY_ENTITY_TYPES),
  entityId: identifierSchema.optional(),
  summary: z.string().trim().min(1).max(1_000),
  changedFields: z.array(z.string().trim().min(1).max(100)).max(100),
  createdAt: timestampSchema,
}).strict()

const humanProjectInputSchema = clarityProjectSchema.omit({
  workspaceId: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  workspaceId: identifierSchema.optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
}).strict()

const humanAnnotationInputSchema = clarityAnnotationSchema.omit({
  workspaceId: true,
  author: true,
  createdAt: true,
  updatedAt: true,
}).extend({
  workspaceId: identifierSchema.optional(),
  author: z.literal('human').optional(),
  origin: z.enum(ANNOTATION_ORIGINS).optional(),
  declaredAuthor: z.enum(ANNOTATION_AUTHORS).optional(),
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
}).strict()

export const humanWorkspaceSaveSchema = z.object({
  expectedRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  name: z.string().trim().min(1).max(500),
  status: z.enum(WORKSPACE_STATUSES),
  projects: z.array(humanProjectInputSchema).max(1_000),
  nodes: z.array(clarityNodeSchema).max(5_000),
  edges: z.array(clarityEdgeSchema).max(15_000),
  annotations: z.array(humanAnnotationInputSchema).max(50_000),
}).strict()

const portableProjectSchema = clarityProjectSchema.omit({ workspaceId: true, createdAt: true, updatedAt: true })
const portableNodeSchema = clarityNodeSchema.omit({ createdAt: true, updatedAt: true })
const portableEdgeSchema = clarityEdgeSchema.omit({ createdAt: true, updatedAt: true })
const portableAnnotationSchema = clarityAnnotationSchema.omit({ workspaceId: true, createdAt: true, updatedAt: true }).extend({
  createdAt: timestampSchema.optional(),
  updatedAt: timestampSchema.optional(),
}).strict()

export const clarityWorkspaceDocumentV1Schema = z.object({
  format: z.literal('clarity-workspace'),
  version: z.literal(1),
  exportedAt: timestampSchema,
  name: z.string().trim().min(1).max(500),
  status: z.enum(WORKSPACE_STATUSES),
  projects: z.array(portableProjectSchema).max(1_000),
  nodes: z.array(portableNodeSchema).max(5_000),
  edges: z.array(portableEdgeSchema).max(15_000),
  annotations: z.array(portableAnnotationSchema).max(50_000),
}).strict()

export const workflowDefinitionSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  projectId: identifierSchema.optional(),
  name: z.string().trim().min(1).max(500),
  revision: z.number().int().min(1).max(1_000_000),
  status: z.enum(WORKFLOW_STATUSES),
  specification: jsonObjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const gateDefinitionSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  name: z.string().trim().min(1).max(500),
  kind: z.enum(GATE_KINDS),
  enabled: z.boolean(),
  rules: jsonObjectSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const approvalRecordSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  runId: identifierSchema,
  status: z.enum(APPROVAL_STATUSES),
  decidedBy: z.string().trim().min(1).max(500).optional(),
  decidedAt: timestampSchema.optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict()

export const candidateResultSchema = z.object({
  title: z.string().min(3).max(200),
  synthesis: z.string().min(20).max(10_000),
  hypothesis: z.string().min(10).max(5_000),
  counterargument: z.string().min(10).max(5_000),
  pressureTest: z.string().min(10).max(10_000),
  decision: z.enum(DECISIONS),
  confidence: z.number().finite().min(0).max(1),
  evidenceNodeIds: z.array(identifierSchema).min(1).max(20),
  /** Stable references to passages admitted into the prepared context. */
  citationIds: z.array(searchCitationIdReferenceSchema).max(SEARCH_ADMITTED_CITATION_MAX).optional(),
  /** Core-generated, bounded review metadata; callers cannot supply authority. */
  citationPresentations: z.array(citationPresentationSchema).max(SEARCH_ADMITTED_CITATION_MAX).optional(),
  codeOutput: z.string().max(20_000).optional(),
}).strict().superRefine((value, context) => {
  const citationIds = value.citationIds ?? []
  if (new Set(citationIds).size !== citationIds.length) {
    context.addIssue({ code: 'custom', message: 'Candidate citation ids must be unique.', path: ['citationIds'] })
  }
  const presentationIds = (value.citationPresentations ?? []).map((presentation) => presentation.citationId)
  if (new Set(presentationIds).size !== presentationIds.length) {
    context.addIssue({ code: 'custom', message: 'Candidate citation presentations must be unique.', path: ['citationPresentations'] })
  }
  if (value.citationPresentations !== undefined) {
    if (value.citationIds === undefined) {
      context.addIssue({ code: 'custom', message: 'Candidate citation presentations require citation ids.', path: ['citationIds'] })
    } else if (citationIds.length !== presentationIds.length || citationIds.some((id, index) => id !== presentationIds[index])) {
      context.addIssue({ code: 'custom', message: 'Candidate citation ids must exactly match presentation ids in order.', path: ['citationPresentations'] })
    }
  }
})

const workflowRunObjectSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  projectId: identifierSchema.optional(),
  contextId: identifierSchema,
  intent: z.string().min(1).max(2_000),
  sourceNodeIds: z.array(identifierSchema).min(1).max(20),
  evidenceRevision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  status: z.enum(RUN_STATUSES),
  preGate: gateReportSchema,
  postGate: gateReportSchema,
  candidate: candidateResultSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  committedNodeId: identifierSchema.optional(),
}).strict()

export const workflowRunSchema = workflowRunObjectSchema.superRefine((value, context) => {
  for (const [index, presentation] of (value.candidate.citationPresentations ?? []).entries()) {
    if (presentation.provenance.workspaceId !== value.workspaceId) {
      context.addIssue({
        code: 'custom',
        message: 'Citation presentation provenance must belong to the run workspace.',
        path: ['candidate', 'citationPresentations', index, 'provenance', 'workspaceId'],
      })
    }
    if (value.evidenceRevision === undefined || presentation.provenance.workspaceRevision !== value.evidenceRevision) {
      context.addIssue({
        code: 'custom',
        message: 'Citation presentation provenance must match the run evidence revision.',
        path: ['candidate', 'citationPresentations', index, 'provenance', 'workspaceRevision'],
      })
    }
  }
})

export const workspaceSchema = z.object({
  version: z.literal(2),
  id: identifierSchema,
  name: z.string().trim().min(1).max(500),
  status: z.enum(WORKSPACE_STATUSES),
  revision: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER),
  schemaContext: z.object({
    schema: z.literal('https://schema.org/'),
    clarity: z.literal('urn:clarity-workflows:'),
  }).strict(),
  projects: z.array(clarityProjectSchema).max(1_000),
  nodes: z.array(clarityNodeSchema).max(5_000),
  edges: z.array(clarityEdgeSchema).max(15_000),
  artifacts: z.array(clarityArtifactSchema).max(20_000),
  artifactCount: z.number().int().min(0).max(20_000).optional(),
  artifactsTruncated: z.boolean().optional(),
  annotations: z.array(clarityAnnotationSchema).max(50_000),
  workflowDefinitions: z.array(workflowDefinitionSchema).max(1_000),
  runs: z.array(workflowRunSchema).max(1_000),
  gates: z.array(gateDefinitionSchema).max(1_000),
  approvals: z.array(approvalRecordSchema).max(5_000),
  activities: z.array(clarityActivitySchema).max(100_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict().superRefine((workspace, context) => {
  const projectIds = new Set<string>()
  for (const project of workspace.projects) {
    if (projectIds.has(project.id)) context.addIssue({ code: 'custom', message: `Duplicate project id: ${project.id}`, path: ['projects'] })
    if (project.workspaceId !== workspace.id) context.addIssue({ code: 'custom', message: `Project ${project.id} belongs to another workspace.`, path: ['projects'] })
    projectIds.add(project.id)
  }
  const nodeIds = new Set<string>()
  for (const node of workspace.nodes) {
    if (nodeIds.has(node.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate node id: ${node.id}`, path: ['nodes'] })
    }
    if (node.projectId && !projectIds.has(node.projectId)) {
      context.addIssue({ code: 'custom', message: `Node ${node.id} references a missing project.`, path: ['nodes'] })
    }
    nodeIds.add(node.id)
  }

  const edgeIds = new Set<string>()
  for (const edge of workspace.edges) {
    if (edgeIds.has(edge.id)) {
      context.addIssue({ code: 'custom', message: `Duplicate edge id: ${edge.id}`, path: ['edges'] })
    }
    edgeIds.add(edge.id)
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) {
      context.addIssue({ code: 'custom', message: `Edge ${edge.id} references a missing node.`, path: ['edges'] })
    }
    if (edge.projectId && !projectIds.has(edge.projectId)) {
      context.addIssue({ code: 'custom', message: `Edge ${edge.id} references a missing project.`, path: ['edges'] })
    }
  }

  const artifactIds = new Set<string>()
  for (const artifact of workspace.artifacts) {
    if (artifactIds.has(artifact.id)) context.addIssue({ code: 'custom', message: `Duplicate artifact id: ${artifact.id}`, path: ['artifacts'] })
    artifactIds.add(artifact.id)
    if (artifact.workspaceId !== workspace.id || (artifact.nodeId && !nodeIds.has(artifact.nodeId))) {
      context.addIssue({ code: 'custom', message: `Artifact ${artifact.id} has an invalid workspace or node.`, path: ['artifacts'] })
    }
  }
  const annotationIds = new Set<string>()
  for (const annotation of workspace.annotations) {
    if (annotationIds.has(annotation.id)) context.addIssue({ code: 'custom', message: `Duplicate annotation id: ${annotation.id}`, path: ['annotations'] })
    annotationIds.add(annotation.id)
    if (annotation.workspaceId !== workspace.id || !nodeIds.has(annotation.nodeId)) {
      context.addIssue({ code: 'custom', message: `Annotation ${annotation.id} has an invalid workspace or node.`, path: ['annotations'] })
    }
  }
  const definitionIds = new Set<string>()
  for (const definition of workspace.workflowDefinitions) {
    if (definitionIds.has(definition.id)) context.addIssue({ code: 'custom', message: `Duplicate workflow definition id: ${definition.id}`, path: ['workflowDefinitions'] })
    if (definition.workspaceId !== workspace.id || (definition.projectId && !projectIds.has(definition.projectId))) {
      context.addIssue({ code: 'custom', message: `Workflow definition ${definition.id} has an invalid workspace or project.`, path: ['workflowDefinitions'] })
    }
    definitionIds.add(definition.id)
  }
  const runIds = new Set<string>()
  const runContextIds = new Set<string>()
  for (const run of workspace.runs) {
    if (runIds.has(run.id)) context.addIssue({ code: 'custom', message: `Duplicate run id: ${run.id}`, path: ['runs'] })
    if (runContextIds.has(run.contextId)) context.addIssue({ code: 'custom', message: `Prepared context ${run.contextId} was consumed by more than one run.`, path: ['runs'] })
    if (run.workspaceId !== workspace.id || (run.projectId && !projectIds.has(run.projectId))) {
      context.addIssue({ code: 'custom', message: `Run ${run.id} has an invalid workspace or project.`, path: ['runs'] })
    }
    for (const sourceNodeId of run.sourceNodeIds) {
      if (!nodeIds.has(sourceNodeId)) context.addIssue({ code: 'custom', message: `Run ${run.id} references missing source node ${sourceNodeId}.`, path: ['runs'] })
    }
    for (const evidenceNodeId of run.candidate.evidenceNodeIds) {
      if (!nodeIds.has(evidenceNodeId)) context.addIssue({ code: 'custom', message: `Run ${run.id} references missing evidence node ${evidenceNodeId}.`, path: ['runs'] })
      if (!run.sourceNodeIds.includes(evidenceNodeId)) context.addIssue({ code: 'custom', message: `Run ${run.id} uses evidence ${evidenceNodeId} outside its prepared sources.`, path: ['runs'] })
    }
    for (const presentation of run.candidate.citationPresentations ?? []) {
      const sourceId = presentation.provenance.sourceId
      const sourceExists = presentation.provenance.sourceKind === 'node'
        ? nodeIds.has(sourceId)
        : presentation.provenance.sourceKind === 'artifact'
          ? artifactIds.has(sourceId)
          : annotationIds.has(sourceId)
      if (!sourceExists) {
        context.addIssue({
          code: 'custom',
          message: `Run ${run.id} cites missing ${presentation.provenance.sourceKind} ${sourceId}.`,
          path: ['runs'],
        })
      }
    }
    if (run.committedNodeId && !nodeIds.has(run.committedNodeId)) {
      context.addIssue({ code: 'custom', message: `Run ${run.id} references missing committed node ${run.committedNodeId}.`, path: ['runs'] })
    }
    if (run.status === 'committed' && !run.committedNodeId) {
      context.addIssue({ code: 'custom', message: `Committed run ${run.id} has no committed node.`, path: ['runs'] })
    }
    runIds.add(run.id)
    runContextIds.add(run.contextId)
  }
  const gateIds = new Set<string>()
  for (const gate of workspace.gates) {
    if (gateIds.has(gate.id)) context.addIssue({ code: 'custom', message: `Duplicate gate id: ${gate.id}`, path: ['gates'] })
    if (gate.workspaceId !== workspace.id) context.addIssue({ code: 'custom', message: `Gate ${gate.id} belongs to another workspace.`, path: ['gates'] })
    gateIds.add(gate.id)
  }
  const approvalIds = new Set<string>()
  const approvalByRun = new Map<string, (typeof workspace.approvals)[number]>()
  for (const approval of workspace.approvals) {
    if (approvalIds.has(approval.id)) context.addIssue({ code: 'custom', message: `Duplicate approval id: ${approval.id}`, path: ['approvals'] })
    if (approval.workspaceId !== workspace.id || !runIds.has(approval.runId)) {
      context.addIssue({ code: 'custom', message: `Approval ${approval.id} has an invalid workspace or run.`, path: ['approvals'] })
    }
    if (approvalByRun.has(approval.runId)) context.addIssue({ code: 'custom', message: `Run ${approval.runId} has more than one approval record.`, path: ['approvals'] })
    approvalByRun.set(approval.runId, approval)
    approvalIds.add(approval.id)
  }
  for (const run of workspace.runs) {
    const approval = approvalByRun.get(run.id)
    if (!approval) {
      context.addIssue({ code: 'custom', message: `Run ${run.id} has no approval record.`, path: ['approvals'] })
      continue
    }
    const expected = run.status === 'awaiting_approval' ? 'pending' : run.status === 'committed' ? 'approved' : 'rejected'
    if (approval.status !== expected) {
      context.addIssue({ code: 'custom', message: `Run ${run.id} status ${run.status} conflicts with approval status ${approval.status}.`, path: ['approvals'] })
    }
  }
  const activityIds = new Set<string>()
  for (const activity of workspace.activities) {
    if (activityIds.has(activity.id)) context.addIssue({ code: 'custom', message: `Duplicate activity id: ${activity.id}`, path: ['activities'] })
    if (activity.workspaceId !== workspace.id) context.addIssue({ code: 'custom', message: `Activity ${activity.id} belongs to another workspace.`, path: ['activities'] })
    activityIds.add(activity.id)
  }
})

export const legacyWorkspaceV1Schema = z.object({
  version: z.literal(1),
  id: identifierSchema,
  name: z.string().trim().min(1).max(500),
  schemaContext: z.object({
    schema: z.literal('https://schema.org/'),
    clarity: z.literal('urn:clarity-workflows:'),
  }).strict(),
  nodes: z.array(clarityNodeSchema.omit({ createdAt: true, updatedAt: true })).max(5_000),
  edges: z.array(clarityEdgeSchema.omit({ createdAt: true, updatedAt: true })).max(15_000),
  runs: z.array(workflowRunObjectSchema.omit({ workspaceId: true })).max(1_000),
  updatedAt: timestampSchema,
}).strict()
