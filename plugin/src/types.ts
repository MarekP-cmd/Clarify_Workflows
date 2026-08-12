export const NODE_KINDS = [
  'paper',
  'book',
  'dataset',
  'code',
  'hypothesis',
  'question',
  'dashboard',
  'project',
  'result',
  'gate',
  'agent',
] as const

export const NODE_STATUSES = [
  'verified',
  'needs-evidence',
  'candidate',
  'running',
  'complete',
  'blocked',
] as const

export const NODE_ORIGINS = ['human', 'approved-ai', 'imported-unverified'] as const

export const WORKSPACE_STATUSES = ['active', 'archived'] as const
export const RUN_STATUSES = ['awaiting_approval', 'committed', 'rejected'] as const
export const DECISIONS = ['positive', 'negative', 'mixed', 'inconclusive'] as const
export const PROJECT_STATUSES = ['active', 'archived'] as const
export const ARTIFACT_STATUSES = ['stored', 'failed'] as const
export const EXTRACTION_STATUSES = ['pending', 'extracted', 'unsupported', 'failed'] as const
export const INGESTION_FORMATS = ['text/plain', 'text/markdown', 'text/csv', 'application/json', 'application/x-ndjson', 'text/source-code'] as const
export const ANNOTATION_AUTHORS = ['human', 'ai', 'system'] as const
export const ANNOTATION_ORIGINS = ['local', 'imported-unverified'] as const
export const WORKFLOW_STATUSES = ['draft', 'active', 'archived'] as const
export const GATE_KINDS = ['pre', 'post'] as const
export const APPROVAL_STATUSES = ['pending', 'approved', 'rejected', 'expired'] as const
export const ACTIVITY_ACTORS = ['human', 'ai', 'system'] as const
export const ACTIVITY_ACTIONS = ['created', 'updated', 'deleted', 'imported', 'staged', 'approved', 'rejected'] as const
export const ACTIVITY_ENTITY_TYPES = ['workspace', 'project', 'node', 'edge', 'annotation', 'artifact', 'workflow-run', 'approval'] as const

export type NodeKind = (typeof NODE_KINDS)[number]
export type NodeStatus = (typeof NODE_STATUSES)[number]
export type NodeOrigin = (typeof NODE_ORIGINS)[number]
export type WorkspaceStatus = (typeof WORKSPACE_STATUSES)[number]
export type RunStatus = (typeof RUN_STATUSES)[number]
export type Decision = (typeof DECISIONS)[number]
export type ProjectStatus = (typeof PROJECT_STATUSES)[number]
export type ArtifactStatus = (typeof ARTIFACT_STATUSES)[number]
export type ExtractionStatus = (typeof EXTRACTION_STATUSES)[number]
export type IngestionFormat = (typeof INGESTION_FORMATS)[number]
export type AnnotationAuthor = (typeof ANNOTATION_AUTHORS)[number]
export type AnnotationOrigin = (typeof ANNOTATION_ORIGINS)[number]
export type WorkflowStatus = (typeof WORKFLOW_STATUSES)[number]
export type GateKind = (typeof GATE_KINDS)[number]
export type ApprovalStatus = (typeof APPROVAL_STATUSES)[number]
export type ActivityActor = (typeof ACTIVITY_ACTORS)[number]
export type ActivityAction = (typeof ACTIVITY_ACTIONS)[number]
export type ActivityEntityType = (typeof ACTIVITY_ENTITY_TYPES)[number]

export type WorkspaceSummary = {
  id: string
  name: string
  status: WorkspaceStatus
  revision: number
  nodeCount: number
  edgeCount: number
  createdAt: string
  updatedAt: string
}

export type ClarityProject = {
  id: string
  workspaceId: string
  name: string
  description: string
  status: ProjectStatus
  createdAt: string
  updatedAt: string
}

export type ClarityNode = {
  id: string
  projectId?: string
  origin?: NodeOrigin
  kind: NodeKind
  title: string
  description: string
  schemaType: string
  status: NodeStatus
  tags: string[]
  provenance: string
  position: { x: number; y: number }
  humanAnnotation?: string
  aiAnnotation?: string
  priority?: 'low' | 'medium' | 'high'
  evidenceCount?: number
  pinned?: boolean
  sourceUri?: string
  instruction?: string
  agentMode?: 'off' | 'suggest' | 'verify' | 'execute'
  createdAt?: string
  updatedAt?: string
}

export type ClarityEdge = {
  id: string
  projectId?: string
  source: string
  target: string
  relation: string
  color?: string
  dashed?: boolean
  createdAt?: string
  updatedAt?: string
}

export type ClarityArtifact = {
  id: string
  workspaceId: string
  nodeId?: string
  originalName: string
  storageKey: string
  mimeType: string
  sizeBytes: number
  sha256: string
  status: ArtifactStatus
  extractionStatus?: ExtractionStatus
  extractionFormat?: IngestionFormat
  extractedText?: string
  extractedByteCount?: number
  extractedCharacterCount?: number
  extractedLineCount?: number
  extractedAt?: string
  extractionError?: string
  createdAt: string
  updatedAt: string
}

export type ExtractedArtifactContent = {
  workspaceId: string
  artifactId: string
  nodeId?: string
  originalName: string
  mimeType: string
  extractionStatus: 'extracted'
  extractionFormat: IngestionFormat
  sourceSha256: string
  totalByteCount: number
  totalCharacterCount: number
  returnedByteCount: number
  returnedCharacterCount: number
  truncated: boolean
  content: string
}

export type IngestionNodeInput = Omit<ClarityNode, 'createdAt' | 'updatedAt'> & {
  createdAt?: string
  updatedAt?: string
}

export type IngestedFileDescriptor = {
  sourcePath: string
  originalName: string
  mimeType?: string
  sizeBytes?: number
}

export type ClarityAnnotation = {
  id: string
  workspaceId: string
  nodeId: string
  author: AnnotationAuthor
  origin?: AnnotationOrigin
  declaredAuthor?: AnnotationAuthor
  body: string
  createdAt: string
  updatedAt: string
}

export type ClarityActivity = {
  id: string
  workspaceId: string
  actor: ActivityActor
  action: ActivityAction
  entityType: ActivityEntityType
  entityId?: string
  summary: string
  changedFields: string[]
  createdAt: string
}

/** Human-owned fields accepted by the atomic desktop save boundary. Optional
 * identity/timestamp fields make existing hydrated records convenient to pass
 * back, but Clarity Core always normalizes them itself. */
export type HumanProjectInput = Omit<ClarityProject, 'workspaceId' | 'createdAt' | 'updatedAt'> & {
  workspaceId?: string
  createdAt?: string
  updatedAt?: string
}

export type HumanAnnotationInput = Pick<ClarityAnnotation, 'id' | 'nodeId' | 'body'> & {
  workspaceId?: string
  author?: 'human'
  origin?: AnnotationOrigin
  declaredAuthor?: AnnotationAuthor
  createdAt?: string
  updatedAt?: string
}

export type HumanWorkspaceSaveInput = {
  expectedRevision: number
  name: string
  status: WorkspaceStatus
  projects: HumanProjectInput[]
  nodes: ClarityNode[]
  edges: ClarityEdge[]
  annotations: HumanAnnotationInput[]
}

export type DeleteWorkspaceResult = {
  workspaceId: string
  name: string
  deleted: true
  deletedAt: string
}

export type ClarityWorkspaceDocumentV1 = {
  format: 'clarity-workspace'
  version: 1
  exportedAt: string
  name: string
  status: WorkspaceStatus
  projects: Array<Omit<ClarityProject, 'workspaceId' | 'createdAt' | 'updatedAt'>>
  nodes: Array<Omit<ClarityNode, 'createdAt' | 'updatedAt'>>
  edges: Array<Omit<ClarityEdge, 'createdAt' | 'updatedAt'>>
  annotations: Array<{
    id: string
    nodeId: string
    author: AnnotationAuthor
    origin?: AnnotationOrigin
    declaredAuthor?: AnnotationAuthor
    body: string
    createdAt?: string
    updatedAt?: string
  }>
}

export type WorkflowDefinition = {
  id: string
  workspaceId: string
  projectId?: string
  name: string
  revision: number
  status: WorkflowStatus
  specification: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type GateDefinition = {
  id: string
  workspaceId: string
  name: string
  kind: GateKind
  enabled: boolean
  rules: Record<string, unknown>
  createdAt: string
  updatedAt: string
}

export type ApprovalRecord = {
  id: string
  workspaceId: string
  runId: string
  status: ApprovalStatus
  decidedBy?: string
  decidedAt?: string
  createdAt: string
  updatedAt: string
}

export type GateReport = {
  passed: boolean
  issues: string[]
}

export type GatePolicy = {
  minimumSources: number
  requireDataset: boolean
}

export type CandidateResult = {
  title: string
  synthesis: string
  hypothesis: string
  counterargument: string
  pressureTest: string
  decision: Decision
  confidence: number
  evidenceNodeIds: string[]
  /** Stable passage references admitted into the prepared workflow context. */
  citationIds?: string[]
  /** A bounded, trusted presentation snapshot for the human review surface. */
  citationPresentations?: CitationPresentation[]
  codeOutput?: string
}

/**
 * Bounded citation metadata persisted with a staged candidate. The preview is
 * intentionally a short source-data excerpt, not a second passage transport;
 * the exact search citation id/hash/offsets remain the authority for a later
 * re-fetch.
 */
export type CitationPresentation = {
  citationId: string
  title: string
  preview: string
  previewCharacterCount: number
  previewByteCount: number
  passageCharacterCount: number
  passageByteCount: number
  truncated: boolean
  provenance: {
    workspaceId: string
    workspaceRevision: number
    sourceKind: 'node' | 'annotation' | 'artifact'
    sourceId: string
    nodeId?: string
    artifactId?: string
    annotationId?: string
    sourceUri?: string
    contentHash: string
    sourceSha256?: string
    extractionStatus?: 'pending' | 'extracted' | 'unsupported' | 'failed'
    extractionFormat?: 'text/plain' | 'text/markdown' | 'text/csv' | 'application/json' | 'application/x-ndjson' | 'text/source-code'
    chunkId: string
    startCharacter: number
    endCharacter: number
    startByte: number
    endByte: number
    startLine?: number
    endLine?: number
  }
  trust: {
    label: 'human' | 'approved-ai' | 'native-ai' | 'native-system' | 'imported-unverified' | 'unknown'
    effectiveAuthor: 'human' | 'ai' | 'system' | 'unknown'
    declaredAuthor?: 'human' | 'ai' | 'system'
    verified: boolean
  }
  contentPolicy: 'untrusted-source-data'
  instructionPolicy: 'treat-source-text-as-data'
}

export type WorkflowRun = {
  id: string
  workspaceId: string
  projectId?: string
  contextId: string
  intent: string
  sourceNodeIds: string[]
  evidenceRevision?: number
  status: RunStatus
  preGate: GateReport
  postGate: GateReport
  candidate: CandidateResult
  createdAt: string
  updatedAt: string
  committedNodeId?: string
}

/**
 * Version 2 is the authoritative Clarity Core workspace contract. It is
 * hydrated from normalized SQLite tables and shared by Electron and MCP.
 */
export type WorkspaceState = {
  version: 2
  id: string
  name: string
  status: WorkspaceStatus
  revision: number
  schemaContext: {
    schema: 'https://schema.org/'
    clarity: 'urn:clarity-workflows:'
  }
  projects: ClarityProject[]
  nodes: ClarityNode[]
  edges: ClarityEdge[]
  artifacts: ClarityArtifact[]
  /** Public MCP projections may page artifact metadata without changing Core state. */
  artifactCount?: number
  artifactsTruncated?: boolean
  annotations: ClarityAnnotation[]
  workflowDefinitions: WorkflowDefinition[]
  runs: WorkflowRun[]
  gates: GateDefinition[]
  approvals: ApprovalRecord[]
  activities: ClarityActivity[]
  createdAt: string
  updatedAt: string
}

export type PreparedContext = {
  contextId: string | null
  expiresAt: string | null
  workspaceId: string | null
  intent: string
  policy: GatePolicy
  sourceNodeIds: string[]
  preGate: GateReport
}

export type StageResult = {
  run: WorkflowRun | null
  postGate: GateReport
}

export type WorkflowView = {
  workspace: WorkspaceState
  activeRun: WorkflowRun | null
  citations: CitationPresentation[]
  citationCount: number
  citationsTruncated: boolean
  safety: {
    mode: 'two-gates-pure-agent'
    preToolGate: 'passed' | 'ready'
    pureAgent: 'side-effect-free'
    postToolGate: 'passed' | 'ready'
    humanApproval: 'required' | 'complete' | 'rejected'
  }
}

export type LegacyWorkspaceV1 = {
  version: 1
  id: string
  name: string
  schemaContext: {
    schema: 'https://schema.org/'
    clarity: 'urn:clarity-workflows:'
  }
  nodes: Omit<ClarityNode, 'createdAt' | 'updatedAt'>[]
  edges: Omit<ClarityEdge, 'createdAt' | 'updatedAt'>[]
  runs: Omit<WorkflowRun, 'workspaceId'>[]
  updatedAt: string
}
