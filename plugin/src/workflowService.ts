import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto'
import { candidateResultSchema } from './schema.js'
import {
  boundedExtractedArtifactContent,
  MAX_MCP_ARTIFACT_PAGE_SIZE,
  MAX_MCP_EXTRACTED_CONTENT_CHARACTERS,
  MAX_MCP_INSPECT_ITEMS,
  MAX_PUBLIC_ARTIFACTS,
  publicArtifactSummary,
  type ArtifactPage,
} from './mcpContent.js'
import type {
  CandidateResult,
  CitationPresentation,
  ClarityActivity,
  ClarityAnnotation,
  ClarityEdge,
  ClarityNode,
  GatePolicy,
  GateReport,
  PreparedContext,
  StageResult,
  WorkflowRun,
  WorkflowView,
  WorkspaceState,
} from './types.js'
import {
  parseAdmittedSearchCitations,
  SearchContractError,
  SEARCH_ADMITTED_CITATION_MAX,
  SEARCH_SNIPPET_MAX_BYTES,
  SEARCH_SNIPPET_MAX_CHARACTERS,
  boundedSearchText,
  type SearchFetchRequest,
  type SearchPassage,
  type SearchQueryInput,
  type SearchResultPage,
} from './searchContract.js'
import { WorkspaceStore, WorkspaceStoreError } from './store.js'

const CONTEXT_TTL_MS = 15 * 60 * 1000
const APPROVAL_TTL_MS = 10 * 60 * 1000
const MAX_PREPARED_ANNOTATIONS = 100
const MAX_PREPARED_ANNOTATION_BYTES = 100_000
const MAX_WORKFLOW_VIEW_CITATION_BYTES = 100_000

type ContextRecord = PreparedContext & {
  contextId: string
  expiresAt: string
  workspaceId: string
  workspaceRevision: number
  citations: SearchPassage[]
}

type ApprovalChallenge = {
  digest: Buffer
  expiresAt: number
  workspaceId: string
  workspaceRevision: number
  runDigest: string
}

export class ClarityPluginError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ClarityPluginError'
  }
}

function unique(values: string[]) {
  return [...new Set(values)]
}

function report(issues: string[]): GateReport {
  return { passed: issues.length === 0, issues }
}

function digestToken(token: string) {
  return createHash('sha256').update(token, 'utf8').digest()
}

function approvalKey(workspaceId: string, runId: string) {
  return `${workspaceId}\u0000${runId}`
}

function reviewDigest(run: WorkflowRun) {
  return createHash('sha256').update(JSON.stringify({
    id: run.id,
    status: run.status,
    updatedAt: run.updatedAt,
    sourceNodeIds: run.sourceNodeIds,
    candidate: run.candidate,
  })).digest('hex')
}

function publicRun(run: WorkflowRun): WorkflowRun {
  const { citationPresentations: _citationPresentations, ...candidate } = run.candidate
  return { ...run, candidate }
}

function publicWorkspace(workspace: WorkspaceState): WorkspaceState {
  const runs = workspace.runs.slice(-20).map(publicRun)
  const runIds = new Set(runs.map((run) => run.id))
  const artifacts = workspace.artifacts.slice(-MAX_PUBLIC_ARTIFACTS).map(publicArtifactSummary)
  return structuredClone({
    ...workspace,
    runs,
    approvals: workspace.approvals.filter((approval) => runIds.has(approval.runId)),
    artifacts,
    artifactCount: workspace.artifacts.length,
    artifactsTruncated: artifacts.length !== workspace.artifacts.length,
    activities: workspace.activities.slice(-200),
  })
}

function workflowActivity(
  workspaceId: string,
  createdAt: string,
  actor: ClarityActivity['actor'],
  action: ClarityActivity['action'],
  entityType: ClarityActivity['entityType'],
  entityId: string,
  summary: string,
): ClarityActivity {
  return {
    id: `activity-${randomUUID()}`,
    workspaceId,
    actor,
    action,
    entityType,
    entityId,
    summary,
    changedFields: [],
    createdAt,
  }
}

function citationSourceTitle(workspace: WorkspaceState, passage: SearchPassage) {
  const { sourceKind, sourceId } = passage.provenance
  let title: string
  if (sourceKind === 'node') title = workspace.nodes.find((node) => node.id === sourceId)?.title ?? `Node ${sourceId}`
  else if (sourceKind === 'artifact') title = workspace.artifacts.find((artifact) => artifact.id === sourceId)?.originalName ?? `Artifact ${sourceId}`
  else {
    const annotation = workspace.annotations.find((item) => item.id === sourceId)
    const nodeTitle = annotation
      ? workspace.nodes.find((node) => node.id === annotation.nodeId)?.title
      : undefined
    title = annotation
      ? nodeTitle ? `Note on ${nodeTitle}` : `Annotation ${sourceId}`
      : `Source ${sourceId}`
  }
  return boundedSearchText(title, 500, 2_000).text
}

function citationPresentation(workspace: WorkspaceState, passage: SearchPassage): CitationPresentation {
  const preview = boundedSearchText(
    passage.content,
    SEARCH_SNIPPET_MAX_CHARACTERS,
    SEARCH_SNIPPET_MAX_BYTES,
  )
  return {
    citationId: passage.citationId,
    title: citationSourceTitle(workspace, passage),
    preview: preview.text,
    previewCharacterCount: preview.characterCount,
    previewByteCount: preview.byteCount,
    passageCharacterCount: passage.contentCharacterCount,
    passageByteCount: passage.contentByteCount,
    truncated: passage.truncated || preview.truncated,
    provenance: structuredClone(passage.provenance),
    trust: structuredClone(passage.trust),
    contentPolicy: passage.contentPolicy,
    instructionPolicy: passage.instructionPolicy,
  }
}

function citationBackingNodeId(workspace: WorkspaceState, passage: SearchPassage) {
  if (passage.provenance.sourceKind === 'node') return passage.provenance.nodeId
  if (passage.provenance.sourceKind === 'annotation') {
    return workspace.annotations.find((annotation) => annotation.id === passage.provenance.annotationId)?.nodeId
  }
  return workspace.artifacts.find((artifact) => artifact.id === passage.provenance.artifactId)?.nodeId
}

function exactValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function artifactCitationIds(passages: SearchPassage[]) {
  return unique(passages
    .filter((passage) => passage.provenance.sourceKind === 'artifact')
    .map((passage) => passage.provenance.artifactId)
    .filter((artifactId): artifactId is string => Boolean(artifactId)))
}

function presentationArtifactIds(run: WorkflowRun) {
  return unique((run.candidate.citationPresentations ?? [])
    .filter((presentation) => presentation.provenance.sourceKind === 'artifact')
    .map((presentation) => presentation.provenance.artifactId)
    .filter((artifactId): artifactId is string => Boolean(artifactId)))
}

export class WorkflowService {
  private readonly preparedContexts = new Map<string, ContextRecord>()
  private readonly approvalChallenges = new Map<string, ApprovalChallenge>()

  constructor(readonly store: WorkspaceStore) {}

  async initialize() {
    await this.store.initialize()
  }

  async getWorkspace(workspaceId?: string): Promise<WorkspaceState> {
    try {
      return publicWorkspace(await this.store.read(workspaceId))
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw new ClarityPluginError(error.code, error.message)
      throw error
    }
  }

  /**
   * Expose the bounded Core search API to the transport layer without giving
   * the MCP server a second workspace or index implementation. Workspace
   * resolution remains authoritative in SQLite, so an omitted id means the
   * same latest workspace used by the other read tools.
   */
  async searchWorkspace(workspaceId: string | undefined, input: SearchQueryInput): Promise<SearchResultPage> {
    try {
      const workspace = await this.store.read(workspaceId)
      return await this.store.search(workspace.id, input)
    } catch (error) {
      if (error instanceof WorkspaceStoreError || error instanceof SearchContractError) {
        throw new ClarityPluginError(error.code, error.message)
      }
      throw error
    }
  }

  /** Retrieve one exact Stage 4/5 result chunk through the same Core boundary
   * used by desktop callers. The workspace id is explicit so a result cannot
   * be replayed across workspaces. */
  async retrieveSearchPassage(workspaceId: string, input: SearchFetchRequest): Promise<SearchPassage> {
    try {
      return await this.store.fetchSearchPassage(workspaceId, input)
    } catch (error) {
      if (error instanceof WorkspaceStoreError || error instanceof SearchContractError) {
        throw new ClarityPluginError(error.code, error.message)
      }
      throw error
    }
  }

  async inspectNode(nodeId: string, workspaceId?: string) {
    const workspace = await this.getWorkspace(workspaceId)
    const node = workspace.nodes.find((candidate) => candidate.id === nodeId)
    if (!node) throw new ClarityPluginError('NODE_NOT_FOUND', `Clarity node ${nodeId} was not found.`)

    const allIncoming = workspace.edges.filter((edge) => edge.target === nodeId)
    const allOutgoing = workspace.edges.filter((edge) => edge.source === nodeId)
    const allAnnotations = workspace.annotations.filter((annotation) => annotation.nodeId === nodeId)
    const incoming = allIncoming.slice(-MAX_MCP_INSPECT_ITEMS)
    const outgoing = allOutgoing.slice(-MAX_MCP_INSPECT_ITEMS)
    const annotations = allAnnotations.slice(-MAX_MCP_INSPECT_ITEMS)
    const artifacts = workspace.artifacts.filter((artifact) => artifact.nodeId === nodeId).slice(-MAX_MCP_ARTIFACT_PAGE_SIZE).map(publicArtifactSummary)
    return {
      node,
      incoming,
      outgoing,
      annotations,
      artifacts,
      incomingCount: allIncoming.length,
      outgoingCount: allOutgoing.length,
      annotationCount: allAnnotations.length,
      incomingTruncated: incoming.length !== allIncoming.length,
      outgoingTruncated: outgoing.length !== allOutgoing.length,
      annotationsTruncated: annotations.length !== allAnnotations.length,
    }
  }

  async listArtifacts(workspaceId: string | undefined, cursor = 0, pageSize = MAX_MCP_ARTIFACT_PAGE_SIZE): Promise<ArtifactPage> {
    let workspace: WorkspaceState
    try {
      workspace = await this.store.read(workspaceId)
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw new ClarityPluginError(error.code, error.message)
      throw error
    }
    if (!Number.isInteger(cursor) || cursor < 0 || cursor > workspace.artifacts.length) {
      throw new ClarityPluginError('INVALID_ARTIFACT_CURSOR', 'The artifact cursor is outside the workspace artifact range.')
    }
    const boundedPageSize = Math.min(Math.max(1, Math.trunc(pageSize)), MAX_MCP_ARTIFACT_PAGE_SIZE)
    const artifacts = workspace.artifacts.slice(cursor, cursor + boundedPageSize).map(publicArtifactSummary)
    const nextCursor = cursor + artifacts.length < workspace.artifacts.length ? String(cursor + artifacts.length) : null
    return {
      workspaceId: workspace.id,
      artifacts,
      totalCount: workspace.artifacts.length,
      nextCursor,
    }
  }

  async getExtractedArtifactContent(workspaceId: string | undefined, artifactId: string, maxCharacters = MAX_MCP_EXTRACTED_CONTENT_CHARACTERS) {
    let workspace: WorkspaceState
    try {
      workspace = await this.store.read(workspaceId)
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw new ClarityPluginError(error.code, error.message)
      throw error
    }
    const artifact = workspace.artifacts.find((candidate) => candidate.id === artifactId)
    if (!artifact) throw new ClarityPluginError('ARTIFACT_NOT_FOUND', `Clarity artifact ${artifactId} was not found.`)
    if (artifact.extractionStatus !== 'extracted' || artifact.extractedText === undefined || !artifact.extractionFormat) {
      throw new ClarityPluginError(
        'ARTIFACT_CONTENT_UNAVAILABLE',
        `Artifact “${artifact.originalName}” has extractionStatus=${artifact.extractionStatus ?? 'pending'}; managed bytes are not exposed as readable MCP content.`,
      )
    }
    try {
      await this.store.assertArtifactIntegrity(workspace.id, artifact.id)
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw new ClarityPluginError(error.code, error.message)
      throw error
    }
    const bounded = boundedExtractedArtifactContent(artifact, maxCharacters)
    if (!bounded) throw new ClarityPluginError('ARTIFACT_CONTENT_UNAVAILABLE', `Artifact “${artifact.originalName}” has no persisted extracted content.`)
    return bounded
  }

  async prepareContext(input: {
    workspaceId?: string
    intent: string
    sourceNodeIds: string[]
    policy: GatePolicy
  }): Promise<PreparedContext> {
    this.pruneExpired()
    const workspace = await this.getWorkspace(input.workspaceId)
    const sourceNodeIds = unique(input.sourceNodeIds)
    const nodeById = new Map(workspace.nodes.map((node) => [node.id, node]))
    const selected = sourceNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is ClarityNode => Boolean(node))

    const issues: string[] = []
    if (workspace.status === 'archived') issues.push('The workspace is archived and read-only until it is restored.')
    const selectedIds = new Set(selected.map((node) => node.id))
    const missingIds = sourceNodeIds.filter((id) => !selectedIds.has(id))
    if (missingIds.length) issues.push(`Unknown source nodes: ${missingIds.join(', ')}.`)
    if (selected.length < input.policy.minimumSources) {
      issues.push(`Select at least ${input.policy.minimumSources} source node(s).`)
    }
    if (input.policy.requireDataset && !selected.some((node) => node.kind === 'dataset')) {
      issues.push('The active gate policy requires at least one dataset.')
    }
    const archivedProjectIds = new Set(workspace.projects.filter((project) => project.status === 'archived').map((project) => project.id))
    for (const node of selected) {
      if (!node.schemaType) issues.push(`${node.title}: missing Schema.org type.`)
      if (!node.provenance) issues.push(`${node.title}: missing provenance.`)
      if (node.status === 'blocked') issues.push(`${node.title}: source is blocked.`)
      if (node.projectId && archivedProjectIds.has(node.projectId)) issues.push(`${node.title}: source belongs to an archived project.`)
    }

    const preGate = report(issues)
    if (!preGate.passed) {
      return {
        contextId: null,
        expiresAt: null,
        workspaceId: workspace.id,
        intent: input.intent,
        policy: input.policy,
        sourceNodeIds,
        preGate,
      }
    }

    const contextId = `context-${randomUUID()}`
    const expiresAt = new Date(Date.now() + CONTEXT_TTL_MS).toISOString()
    const prepared: ContextRecord = {
      contextId,
      expiresAt,
      workspaceId: workspace.id,
      workspaceRevision: workspace.revision,
      intent: input.intent,
      policy: input.policy,
      sourceNodeIds,
      preGate,
      citations: [],
    }
    this.preparedContexts.set(contextId, prepared)
    return structuredClone(prepared)
  }

  /** Admit exact, Core-retrieved passages into one live prepared context.
   * Callers provide identity/hash requests only; they cannot submit arbitrary
   * citation text or provenance. The context revision is checked before and
   * during every fetch, and the aggregate citation budget is validated before
   * the in-memory context is changed. */
  async admitSearchCitations(contextId: string, requests: SearchFetchRequest[]) {
    const context = this.requirePreparedContext(contextId)
    if (!requests.length) {
      throw new ClarityPluginError('CITATION_REQUEST_EMPTY', 'Admit at least one exact search passage request.')
    }
    if (requests.length > SEARCH_ADMITTED_CITATION_MAX) {
      throw new ClarityPluginError(
        'CITATION_LIMIT_REACHED',
        `A prepared context can admit at most ${SEARCH_ADMITTED_CITATION_MAX} search citations.`,
      )
    }

    const current = await this.store.read(context.workspaceId)
    if (current.revision !== context.workspaceRevision) {
      this.preparedContexts.delete(contextId)
      throw new ClarityPluginError(
        'CONTEXT_STALE',
        'The Clarity workspace changed before citation admission. Run prepare_workflow_context again.',
      )
    }

    const passages: SearchPassage[] = []
    const requestedResultIds = new Set<string>()
    for (const request of requests) {
      if (requestedResultIds.has(request.resultId)) {
        throw new ClarityPluginError('CITATION_DUPLICATE', `Search result ${request.resultId} was requested more than once.`)
      }
      requestedResultIds.add(request.resultId)
      const passage = await this.retrieveSearchPassage(context.workspaceId, request)
      if (passage.workspaceRevision !== context.workspaceRevision || passage.workspaceId !== context.workspaceId) {
        this.preparedContexts.delete(contextId)
        throw new ClarityPluginError('CITATION_STALE', `Search result ${request.resultId} is not bound to the prepared context revision.`)
      }
      const backingNodeId = citationBackingNodeId(current, passage)
      if (!backingNodeId || !context.sourceNodeIds.includes(backingNodeId)) {
        throw new ClarityPluginError(
          'CITATION_SOURCE_NOT_ADMITTED',
          `Search result ${request.resultId} is not backed by a node in the prepared source bundle.`,
        )
      }
      passages.push(passage)
    }

    let admitted: SearchPassage[]
    try {
      const existingCitationIds = new Set(context.citations.map((citation) => citation.citationId))
      // Re-admitting the exact stable citation is idempotent; it never
      // duplicates source text in the prepared context. A different hash for
      // the same result was already rejected by Core during fetch.
      admitted = parseAdmittedSearchCitations([
        ...context.citations,
        ...passages.filter((passage) => !existingCitationIds.has(passage.citationId)),
      ])
    } catch (error) {
      if (error instanceof Error) {
        throw new ClarityPluginError('CITATION_LIMIT_REACHED', error.message)
      }
      throw error
    }
    context.citations = admitted
    return structuredClone({
      contextId: context.contextId,
      workspaceId: context.workspaceId,
      workspaceRevision: context.workspaceRevision,
      citations: context.citations,
      citationCount: context.citations.length,
      citationsTruncated: false,
    })
  }

  async getPreparedSources(contextId: string) {
    const context = this.requirePreparedContext(contextId)
    const workspace = await this.getWorkspace(context.workspaceId)
    if (workspace.revision !== context.workspaceRevision) {
      this.preparedContexts.delete(contextId)
      throw new ClarityPluginError(
        'CONTEXT_STALE',
        'The Clarity workspace changed after this context was prepared. Run prepare_workflow_context again.',
      )
    }
    const nodeById = new Map(workspace.nodes.map((node) => [node.id, node]))
    const sourceIds = new Set(context.sourceNodeIds)
    const sources = context.sourceNodeIds
      .map((id) => nodeById.get(id))
      .filter((node): node is ClarityNode => Boolean(node))
    const relationships = workspace.edges.filter(
      (edge) => sourceIds.has(edge.source) && sourceIds.has(edge.target),
    )
    const matchingAnnotations = workspace.annotations.filter((annotation) => sourceIds.has(annotation.nodeId))
    const annotations: ClarityAnnotation[] = []
    let annotationBytes = 0
    // Prefer the newest notes when the explicit context budget is exhausted,
    // then restore chronological order in the returned bundle.
    for (const annotation of [...matchingAnnotations].reverse()) {
      if (annotations.length >= MAX_PREPARED_ANNOTATIONS) break
      const bytes = Buffer.byteLength(JSON.stringify(annotation), 'utf8')
      if (annotationBytes + bytes > MAX_PREPARED_ANNOTATION_BYTES) continue
      annotations.push(annotation)
      annotationBytes += bytes
    }
    annotations.reverse()
    const citations = parseAdmittedSearchCitations(context.citations)
    const { citations: _contextCitations, ...contextSummary } = context
    return {
      context: structuredClone(contextSummary),
      sources,
      relationships,
      annotations,
      annotationCount: matchingAnnotations.length,
      annotationsTruncated: annotations.length !== matchingAnnotations.length,
      citations,
      citationCount: citations.length,
      citationsTruncated: false,
    }
  }

  async stageCandidate(contextId: string, candidateInput: CandidateResult): Promise<StageResult> {
    const context = this.requirePreparedContext(contextId)
    const current = await this.store.read(context.workspaceId)
    if (current.status === 'archived') {
      this.preparedContexts.delete(contextId)
      throw new ClarityPluginError('WORKSPACE_ARCHIVED', 'This workspace is archived and cannot stage workflow candidates until it is restored.')
    }
    if (current.revision !== context.workspaceRevision) {
      this.preparedContexts.delete(contextId)
      throw new ClarityPluginError(
        'CONTEXT_STALE',
        'The Clarity workspace changed after this context was prepared. Run prepare_workflow_context again.',
      )
    }
    const { citationPresentations: _untrustedPresentations, ...candidateForValidation } = candidateInput
    const parsed = candidateResultSchema.safeParse(candidateForValidation)
    const issues: string[] = []

    if (!parsed.success) {
      issues.push(...parsed.error.issues.map((issue) => `${issue.path.join('.') || 'candidate'}: ${issue.message}`))
    }

    const candidate = parsed.success ? parsed.data : candidateInput
    const evidenceNodeIds = unique(Array.isArray(candidate.evidenceNodeIds)
      ? candidate.evidenceNodeIds.filter((value): value is string => typeof value === 'string')
      : [])
    const invalidEvidence = evidenceNodeIds.filter((id) => !context.sourceNodeIds.includes(id))
    if (invalidEvidence.length) {
      issues.push(`Evidence must come from the prepared source bundle: ${invalidEvidence.join(', ')}.`)
    }
    if (!evidenceNodeIds.length) issues.push('At least one prepared source must be linked as evidence.')

    // If the model does not narrow the admitted set, persist every exact
    // citation that was made available to it. Explicit ids are still checked
    // against the context so a caller cannot launder an arbitrary citation
    // reference into a durable workflow run.
    const admittedCitationIds = context.citations.map((citation) => citation.citationId)
    const requestedCitationIds = Array.isArray(candidate.citationIds)
      ? candidate.citationIds.filter((value): value is string => typeof value === 'string')
      : undefined
    const citationIds = requestedCitationIds === undefined
      ? admittedCitationIds
      : unique(requestedCitationIds)
    const invalidCitationIds = citationIds.filter((id) => !admittedCitationIds.includes(id))
    if (invalidCitationIds.length) {
      issues.push(`Citations must come from the admitted search passage bundle: ${invalidCitationIds.join(', ')}.`)
    }

    const admittedById = new Map(context.citations.map((citation) => [citation.citationId, citation]))
    const revalidatedPassages: SearchPassage[] = []
    if (parsed.success && invalidCitationIds.length === 0) {
      for (const citationId of citationIds) {
        const admitted = admittedById.get(citationId)
        if (!admitted) continue
        const revalidated = await this.retrieveSearchPassage(context.workspaceId, {
          resultId: admitted.provenance.chunkId,
          expectedWorkspaceRevision: admitted.workspaceRevision,
          expectedContentHash: admitted.provenance.contentHash,
          maxCharacters: admitted.contentCharacterCount,
        })
        if (!exactValue(revalidated, admitted)) {
          throw new ClarityPluginError(
            'CITATION_STALE',
            `Citation ${citationId} changed after admission. Search and admit the source again before staging.`,
          )
        }
        revalidatedPassages.push(revalidated)
      }
    }
    const trustedCitationPresentations = revalidatedPassages
      .map((passage) => citationPresentation(current, passage))

    const postGate = report(issues)
    if (!postGate.passed || !parsed.success) return { run: null, postGate }

    const now = new Date().toISOString()
    // Citation presentation is always reconstructed from Core-refetched
    // passages. A direct service caller may include a schema-valid
    // citationPresentations field, but it is deliberately discarded here so
    // preview text, provenance, trust, and policy can never be caller-forged.
    const {
      citationIds: _callerCitationIds,
      citationPresentations: _callerCitationPresentations,
      ...candidateFields
    } = parsed.data
    const run: WorkflowRun = {
      id: `run-${randomUUID()}`,
      workspaceId: context.workspaceId,
      contextId,
      intent: context.intent,
      sourceNodeIds: context.sourceNodeIds,
      evidenceRevision: context.workspaceRevision,
      status: 'awaiting_approval',
      preGate: context.preGate,
      postGate,
      candidate: {
        ...candidateFields,
        evidenceNodeIds,
        ...(citationIds.length ? { citationIds } : {}),
        ...(trustedCitationPresentations.length ? { citationPresentations: trustedCitationPresentations } : {}),
      },
      createdAt: now,
      updatedAt: now,
    }

    try {
      const persisted = await this.store.mutate(context.workspaceId, (workspace) => {
        // The read above gives an early, useful error; this check inside the
        // serialized SQLite transaction closes the read/write race.
        if (workspace.revision !== context.workspaceRevision) {
          throw new ClarityPluginError(
            'CONTEXT_STALE',
            'The Clarity workspace changed after this context was prepared. Run prepare_workflow_context again.',
          )
        }
        if (workspace.status === 'archived') {
          throw new ClarityPluginError('WORKSPACE_ARCHIVED', 'This workspace is archived and cannot stage workflow candidates until it is restored.')
        }
        if (workspace.runs.some((item) => item.contextId === contextId)) {
          throw new ClarityPluginError('CONTEXT_CONSUMED', 'This prepared context has already staged a workflow run.')
        }

        if (workspace.runs.length >= 1_000) {
          const pendingIds = new Set(workspace.runs.filter((item) => item.status === 'awaiting_approval').map((item) => item.id))
          if (pendingIds.size >= 1_000) {
            throw new ClarityPluginError('RUN_LIMIT_REACHED', 'Resolve at least one pending workflow run before staging another candidate.')
          }
          const terminalCapacity = 999 - pendingIds.size
          const terminalRuns = workspace.runs.filter((item) => !pendingIds.has(item.id))
          const terminalToKeep = new Set((terminalCapacity > 0 ? terminalRuns.slice(-terminalCapacity) : []).map((item) => item.id))
          const retainedIds = new Set([...pendingIds, ...terminalToKeep])
          workspace.runs = workspace.runs.filter((item) => retainedIds.has(item.id))
          workspace.approvals = workspace.approvals.filter((approval) => retainedIds.has(approval.runId))
        }

        workspace.runs.push(run)
        workspace.approvals.push({
          id: `approval-${run.id}`,
          workspaceId: workspace.id,
          runId: run.id,
          status: 'pending',
          createdAt: now,
          updatedAt: now,
        })
        workspace.activities.push(workflowActivity(
          workspace.id,
          now,
          'ai',
          'staged',
          'workflow-run',
          run.id,
          `Staged candidate “${run.candidate.title}” for human review.`,
        ))
      }, {
        incrementRevision: false,
        markSearchDirty: false,
        verifyArtifactIds: artifactCitationIds(revalidatedPassages),
      })
      const persistedRun = persisted.runs.find((item) => item.id === run.id)
      if (!persistedRun) throw new ClarityPluginError('STAGE_PERSISTENCE_FAILED', 'The staged run was not found after its transaction committed.')
      Object.assign(run, persistedRun)
    } catch (error) {
      if (error instanceof ClarityPluginError && (error.code === 'CONTEXT_STALE' || error.code === 'CONTEXT_CONSUMED')) {
        this.preparedContexts.delete(contextId)
      }
      throw error
    }
    this.preparedContexts.delete(contextId)
    return { run: structuredClone(run), postGate }
  }

  async getView(runId?: string, workspaceId?: string): Promise<WorkflowView> {
    const resolvedWorkspaceId = workspaceId ?? (runId ? await this.store.findWorkspaceIdByRun(runId) ?? undefined : undefined)
    let completeWorkspace: WorkspaceState
    try {
      completeWorkspace = await this.store.read(resolvedWorkspaceId)
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw new ClarityPluginError(error.code, error.message)
      throw error
    }
    const completeActiveRun = runId
      ? completeWorkspace.runs.find((run) => run.id === runId) ?? null
      : completeWorkspace.runs.at(-1) ?? null

    if (runId && !completeActiveRun) throw new ClarityPluginError('RUN_NOT_FOUND', `Workflow run ${runId} was not found.`)

    const citations = completeActiveRun?.candidate.citationPresentations ?? []
    if (Buffer.byteLength(JSON.stringify(citations), 'utf8') > MAX_WORKFLOW_VIEW_CITATION_BYTES) {
      throw new ClarityPluginError('WORKFLOW_VIEW_TOO_LARGE', 'The bounded citation review projection exceeds its transport budget.')
    }
    const activeRun = completeActiveRun ? publicRun(completeActiveRun) : null

    return {
      workspace: publicWorkspace(completeWorkspace),
      activeRun,
      citations: structuredClone(citations),
      citationCount: citations.length,
      citationsTruncated: false,
      safety: {
        mode: 'two-gates-pure-agent',
        preToolGate: activeRun?.preGate.passed ? 'passed' : 'ready',
        pureAgent: 'side-effect-free',
        postToolGate: activeRun?.postGate.passed ? 'passed' : 'ready',
        humanApproval:
          activeRun?.status === 'committed'
            ? 'complete'
            : activeRun?.status === 'rejected'
              ? 'rejected'
              : 'required',
      },
    }
  }

  async issueApprovalChallenge(workspaceId: string, runId: string) {
    this.pruneExpired()
    let workspace: WorkspaceState
    try {
      workspace = await this.store.read(workspaceId)
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw new ClarityPluginError(error.code, error.message)
      throw error
    }
    const run = workspace.runs.find((candidate) => candidate.id === runId)
    if (!run) throw new ClarityPluginError('RUN_NOT_FOUND', `Workflow run ${runId} was not found.`)
    if (run.status !== 'awaiting_approval') {
      throw new ClarityPluginError('RUN_NOT_PENDING', 'Only a staged candidate awaiting approval can be reviewed.')
    }
    if (run.evidenceRevision === undefined) {
      throw new ClarityPluginError('RUN_CONTEXT_UNVERIFIED', 'This imported legacy run has no verifiable prepared-workspace revision and cannot be approved.')
    }
    if (workspace.revision !== run.evidenceRevision) {
      throw new ClarityPluginError('STAGED_EVIDENCE_STALE', 'The workspace changed after this candidate was staged. Prepare and stage it again before review.')
    }
    await this.revalidateRunCitations(workspace, run)

    const token = randomBytes(32).toString('base64url')
    const expiresAt = Date.now() + APPROVAL_TTL_MS
    this.approvalChallenges.set(approvalKey(workspaceId, runId), {
      digest: digestToken(token),
      expiresAt,
      workspaceId,
      workspaceRevision: workspace.revision,
      runDigest: reviewDigest(run),
    })
    return { workspaceId, runId, approvalToken: token, expiresAt: new Date(expiresAt).toISOString() }
  }

  async approve(workspaceId: string, runId: string, approvalToken: string) {
    const challenge = await this.requireApproval(workspaceId, runId, approvalToken)
    const reviewWorkspace = await this.store.read(workspaceId)
    const reviewRun = reviewWorkspace.runs.find((candidate) => candidate.id === runId)
    if (!reviewRun) throw new ClarityPluginError('RUN_NOT_FOUND', `Workflow run ${runId} was not found.`)
    try {
      await this.revalidateRunCitations(reviewWorkspace, reviewRun)
    } catch (error) {
      this.approvalChallenges.delete(approvalKey(workspaceId, runId))
      throw error
    }
    this.approvalChallenges.delete(approvalKey(workspaceId, runId))

    await this.store.mutate(workspaceId, (workspace) => {
      const run = workspace.runs.find((candidate) => candidate.id === runId)
      if (!run) throw new ClarityPluginError('RUN_NOT_FOUND', `Workflow run ${runId} was not found.`)
      if (workspace.revision !== challenge.workspaceRevision || reviewDigest(run) !== challenge.runDigest) {
        throw new ClarityPluginError('APPROVAL_STALE', 'The workspace or candidate changed after review opened. Request a fresh approval challenge.')
      }
      if (run.status === 'committed') return
      if (run.status !== 'awaiting_approval') {
        throw new ClarityPluginError('RUN_NOT_PENDING', 'The candidate is no longer awaiting approval.')
      }
      if (workspace.status === 'archived') {
        throw new ClarityPluginError('WORKSPACE_ARCHIVED', 'This workspace is archived and cannot commit workflow candidates until it is restored.')
      }

      const committedNodeId = `result-${run.id}`
      if (workspace.nodes.some((node) => node.id === committedNodeId)) {
        throw new ClarityPluginError(
          'RESULT_ID_COLLISION',
          `A graph node already uses the reserved result identity ${committedNodeId}; the candidate was not committed.`,
        )
      }
      const maxX = workspace.nodes.reduce((maximum, node) => Math.max(maximum, node.position.x), 0)
      const resultNode: ClarityNode = {
        id: committedNodeId,
        origin: 'approved-ai',
        kind: 'result',
        title: run.candidate.title,
        description: run.candidate.synthesis,
        schemaType: 'CreativeWork',
        status: 'complete',
        tags: ['ChatGPT synthesis', run.candidate.decision, `confidence:${run.candidate.confidence.toFixed(2)}`],
        provenance: `Staged by ChatGPT and committed through Clarity run ${run.id}`,
        position: { x: Math.max(-99_720, Math.min(99_720, maxX + 280)), y: 180 + (workspace.runs.length % 4) * 90 },
        humanAnnotation: 'Explicitly approved in the Clarity MCP App.',
        aiAnnotation: `Hypothesis: ${run.candidate.hypothesis}\nCounterargument: ${run.candidate.counterargument}\nPressure test: ${run.candidate.pressureTest}`,
        evidenceCount: run.candidate.evidenceNodeIds.length,
      }

      workspace.nodes.push(resultNode)
      for (const evidenceId of run.candidate.evidenceNodeIds) {
        const edge: ClarityEdge = {
          id: `evidence-${createHash('sha256').update(`${workspace.id}\u0000${run.id}\u0000${evidenceId}`).digest('hex').slice(0, 32)}`,
          source: evidenceId,
          target: committedNodeId,
          relation: 'supports candidate result',
        }
        if (workspace.edges.some((candidate) => candidate.id === edge.id)) {
          throw new ClarityPluginError('RESULT_EDGE_ID_COLLISION', `A graph edge already uses the reserved result relationship identity ${edge.id}; the candidate was not committed.`)
        }
        workspace.edges.push(edge)
      }

      run.status = 'committed'
      run.committedNodeId = committedNodeId
      run.updatedAt = new Date().toISOString()
      const approval = workspace.approvals.find((candidate) => candidate.runId === runId)
      if (!approval) throw new ClarityPluginError('APPROVAL_RECORD_MISSING', `Workflow run ${runId} has no durable approval record.`)
      approval.status = 'approved'
      approval.decidedBy = 'human-operator'
      approval.decidedAt = run.updatedAt
      approval.updatedAt = run.updatedAt
      workspace.activities.push(workflowActivity(
        workspace.id,
        run.updatedAt,
        'human',
        'approved',
        'approval',
        approval.id,
        `Approved candidate “${run.candidate.title}” and committed its result.`,
      ))
      // Committing a graph result advances the authoritative revision. Any
      // sibling candidate prepared against the previous revision can no
      // longer be approved safely, so close it atomically instead of leaving
      // an unresolvable pending approval behind.
      for (const staleRun of workspace.runs) {
        if (staleRun.id === run.id || staleRun.status !== 'awaiting_approval') continue
        staleRun.status = 'rejected'
        staleRun.updatedAt = run.updatedAt
        const staleApproval = workspace.approvals.find((candidate) => candidate.runId === staleRun.id)
        if (staleApproval?.status === 'pending') {
          staleApproval.status = 'rejected'
          staleApproval.decidedBy = 'system-stale-evidence'
          staleApproval.decidedAt = run.updatedAt
          staleApproval.updatedAt = run.updatedAt
        }
        workspace.activities.push(workflowActivity(
          workspace.id,
          run.updatedAt,
          'system',
          'rejected',
          'workflow-run',
          staleRun.id,
          `Closed stale candidate “${staleRun.candidate.title}” after another result advanced the workspace revision.`,
        ))
      }
    }, { verifyArtifactIds: presentationArtifactIds(reviewRun) })

    return this.getView(runId, workspaceId)
  }

  async reject(workspaceId: string, runId: string, approvalToken: string) {
    const challenge = await this.requireApproval(workspaceId, runId, approvalToken)
    this.approvalChallenges.delete(approvalKey(workspaceId, runId))

    await this.store.mutate(workspaceId, (workspace) => {
      const run = workspace.runs.find((candidate) => candidate.id === runId)
      if (!run) throw new ClarityPluginError('RUN_NOT_FOUND', `Workflow run ${runId} was not found.`)
      if (workspace.revision !== challenge.workspaceRevision || reviewDigest(run) !== challenge.runDigest) {
        throw new ClarityPluginError('APPROVAL_STALE', 'The workspace or candidate changed after review opened. Request a fresh approval challenge.')
      }
      if (run.status !== 'awaiting_approval') {
        throw new ClarityPluginError('RUN_NOT_PENDING', 'The candidate is no longer awaiting approval.')
      }
      if (workspace.status === 'archived') {
        throw new ClarityPluginError('WORKSPACE_ARCHIVED', 'This workspace is archived and cannot reject workflow candidates until it is restored.')
      }
      run.status = 'rejected'
      run.updatedAt = new Date().toISOString()
      const approval = workspace.approvals.find((candidate) => candidate.runId === runId)
      if (!approval) throw new ClarityPluginError('APPROVAL_RECORD_MISSING', `Workflow run ${runId} has no durable approval record.`)
      approval.status = 'rejected'
      approval.decidedBy = 'human-operator'
      approval.decidedAt = run.updatedAt
      approval.updatedAt = run.updatedAt
      workspace.activities.push(workflowActivity(
        workspace.id,
        run.updatedAt,
        'human',
        'rejected',
        'approval',
        approval.id,
        `Rejected candidate “${run.candidate.title}”; graph topology was unchanged.`,
      ))
    }, { incrementRevision: false, markSearchDirty: false })

    return this.getView(runId, workspaceId)
  }

  private requirePreparedContext(contextId: string): ContextRecord {
    this.pruneExpired()
    const context = this.preparedContexts.get(contextId)
    if (!context) {
      throw new ClarityPluginError(
        'CONTEXT_NOT_FOUND',
        'The prepared context is missing or expired. Run prepare_workflow_context again.',
      )
    }
    return context
  }

  private async revalidateRunCitations(workspace: WorkspaceState, run: WorkflowRun) {
    const citationIds = run.candidate.citationIds ?? []
    const presentations = run.candidate.citationPresentations ?? []
    if (citationIds.length !== presentations.length
      || new Set(citationIds).size !== citationIds.length
      || new Set(presentations.map((presentation) => presentation.citationId)).size !== presentations.length
      || citationIds.some((citationId) => !presentations.some((presentation) => presentation.citationId === citationId))) {
      throw new ClarityPluginError('CITATION_STALE', 'The staged citation set no longer matches the reviewed candidate.')
    }
    for (const presentation of presentations) {
      let passage: SearchPassage
      try {
        passage = await this.store.fetchSearchPassage(workspace.id, {
          resultId: presentation.provenance.chunkId,
          expectedWorkspaceRevision: presentation.provenance.workspaceRevision,
          expectedContentHash: presentation.provenance.contentHash,
          maxCharacters: presentation.passageCharacterCount,
        })
      } catch (error) {
        if (error instanceof WorkspaceStoreError || error instanceof SearchContractError) {
          throw new ClarityPluginError(error.code, error.message)
        }
        throw error
      }
      const expected = citationPresentation(workspace, passage)
      if (!exactValue(expected, presentation)) {
        throw new ClarityPluginError(
          'CITATION_STALE',
          `Citation ${presentation.citationId} no longer matches its authoritative search passage.`,
        )
      }
    }
  }

  private async requireApproval(workspaceId: string, runId: string, token: string) {
    this.pruneExpired()
    const key = approvalKey(workspaceId, runId)
    const challenge = this.approvalChallenges.get(key)
    if (!challenge) {
      throw new ClarityPluginError('APPROVAL_REQUIRED', 'Open the Clarity component and request a fresh approval challenge.')
    }
    const supplied = digestToken(token)
    if (supplied.length !== challenge.digest.length || !timingSafeEqual(supplied, challenge.digest)) {
      throw new ClarityPluginError('INVALID_APPROVAL', 'The approval challenge is invalid or expired.')
    }
    const workspace = await this.store.read(workspaceId)
    const run = workspace.runs.find((candidate) => candidate.id === runId)
    if (!run) throw new ClarityPluginError('RUN_NOT_FOUND', `Workflow run ${runId} was not found in workspace ${workspaceId}.`)
    if (workspace.revision !== challenge.workspaceRevision || reviewDigest(run) !== challenge.runDigest) {
      this.approvalChallenges.delete(key)
      throw new ClarityPluginError('APPROVAL_STALE', 'The workspace or candidate changed after review opened. Request a fresh approval challenge.')
    }
    return challenge
  }

  private pruneExpired() {
    const now = Date.now()
    for (const [id, context] of this.preparedContexts) {
      if (Date.parse(context.expiresAt) <= now) this.preparedContexts.delete(id)
    }
    for (const [key, challenge] of this.approvalChallenges) {
      if (challenge.expiresAt <= now) this.approvalChallenges.delete(key)
    }
  }
}
