import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { chmod, mkdir, readFile, rename, rm, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { DatabaseSync } from 'node:sqlite'
import { resolveClarityDataPaths } from './dataPaths.js'
import {
  clarityArtifactSchema,
  clarityEdgeSchema,
  clarityNodeSchema,
  clarityWorkspaceDocumentV1Schema,
  humanWorkspaceSaveSchema,
  legacyWorkspaceV1Schema,
  workspaceSchema,
} from './schema.js'
import { extractManagedIngestionContent, MAX_EXTRACTABLE_SOURCE_BYTES } from './ingestion.js'
import {
  hashSearchContent,
  parseSearchFetchRequest,
  parseSearchQuery,
  trustForAnnotation,
  trustForNode,
} from './searchContract.js'
import { executeSearchQuery } from './searchQuery.js'
import { buildSearchPassage } from './searchRetrieval.js'
import {
  buildCanonicalSearchSource,
  buildSearchIndexInput,
  createSearchIndexState,
  derivedSearchIndexInputSchema,
  parseDerivedSearchIndexInput,
  searchIndexChunkSchema,
  searchIndexDocumentSchema,
  searchIndexStateSchema,
  SEARCH_INDEX_ERROR_MAX_CHARACTERS,
} from './searchIndex.js'
import type {
  DerivedSearchIndexInput,
  SearchIndexChunk,
  SearchIndexDocument,
  SearchIndexSnapshot,
  SearchIndexState,
} from './searchIndex.js'
import type { SearchFetchRequest, SearchPassage, SearchQueryInput, SearchResultPage } from './searchContract.js'
import type {
  ApprovalRecord,
  ClarityActivity,
  ClarityAnnotation,
  ClarityArtifact,
  ClarityEdge,
  ClarityNode,
  ClarityProject,
  GateDefinition,
  HumanWorkspaceSaveInput,
  IngestionNodeInput,
  LegacyWorkspaceV1,
  DeleteWorkspaceResult,
  WorkflowDefinition,
  WorkflowRun,
  WorkspaceState,
  WorkspaceSummary,
} from './types.js'

export const CLARITY_DATABASE_SCHEMA_VERSION = 6
const DEFAULT_WORKSPACE_NAME = 'Untitled workspace'
const MAX_ARTIFACT_BYTES = 2 * 1024 * 1024 * 1024
const HUMAN_NODE_KINDS = new Set<ClarityNode['kind']>([
  'paper', 'book', 'dataset', 'code', 'hypothesis', 'question', 'dashboard', 'project',
])

type SqlRow = Record<string, string | number | null>
type WorkspaceMutator = (workspace: WorkspaceState) => WorkspaceState | void
type WorkspaceMutationOptions = {
  incrementRevision?: boolean
  markSearchDirty?: boolean
  /** Re-verify these managed artifacts while holding the Store write queue,
   * immediately before the SQLite mutation is opened. */
  verifyArtifactIds?: string[]
}

export type WorkspaceStoreOptions = {
  databasePath?: string
  artifactDirectory?: string
  legacyJsonPaths?: string[]
  /** Testable filesystem boundary; production uses recursive force removal. */
  removeArtifactDirectory?: (directory: string) => Promise<void>
}

type NormalizedStoreOptions = Required<Pick<WorkspaceStoreOptions, 'databasePath' | 'artifactDirectory' | 'legacyJsonPaths'>>

export type AddArtifactOptions = {
  nodeId?: string
  originalName?: string
  mimeType?: string
}

export type IngestFileAsNodeOptions = {
  node: IngestionNodeInput
  originalName?: string
  mimeType?: string
}

export class WorkspaceStoreError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'WorkspaceStoreError'
  }
}

function cloneWorkspace(workspace: WorkspaceState): WorkspaceState {
  return structuredClone(workspace)
}

function searchSourceFingerprint(workspace: WorkspaceState) {
  return JSON.stringify({
    projects: workspace.projects,
    nodes: workspace.nodes,
    artifacts: workspace.artifacts,
    annotations: workspace.annotations,
  })
}

function sameProjectionRecords<T extends { id: string }>(left: T[], right: T[]) {
  if (left.length !== right.length) return false
  const expected = new Map(right.map((record) => [record.id, JSON.stringify(record)]))
  return left.every((record) => expected.get(record.id) === JSON.stringify(record))
}

function parseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function optionalString(value: string | null) {
  return value ?? undefined
}

function optionalNumber(value: number | null) {
  return value ?? undefined
}

function asBoolean(value: number | null) {
  return value === null ? undefined : value === 1
}

function nowIso() {
  return new Date().toISOString()
}

function normalizedTimestamp(value: string | undefined, fallback: string) {
  return value ? new Date(value).toISOString() : fallback
}

function mutationTimestamp(workspace: WorkspaceState) {
  const timestamps = [workspace.updatedAt]
  for (const collection of [workspace.projects, workspace.nodes, workspace.edges, workspace.annotations, workspace.artifacts]) {
    for (const entity of collection) if (entity.updatedAt) timestamps.push(entity.updatedAt)
  }
  const latest = Math.max(Date.now(), ...timestamps.map((value) => Date.parse(value)))
  return new Date(latest + 1).toISOString()
}

function equalValue(left: unknown, right: unknown) {
  return JSON.stringify(left) === JSON.stringify(right)
}

function changedFields<T extends object>(before: T, after: T, fields: readonly (keyof T)[]) {
  return fields.filter((field) => !equalValue(before[field], after[field])).map(String)
}

function entityChanged(before: object, after: object) {
  const withoutTimestamps = (value: object) => Object.fromEntries(
    Object.entries(value).filter(([key]) => key !== 'createdAt' && key !== 'updatedAt'),
  )
  return !equalValue(withoutTimestamps(before), withoutTimestamps(after))
}

function activity(
  workspaceId: string,
  timestamp: string,
  actor: ClarityActivity['actor'],
  action: ClarityActivity['action'],
  entityType: ClarityActivity['entityType'],
  summary: string,
  entityId?: string,
  fields: string[] = [],
): ClarityActivity {
  return {
    id: `activity-${randomUUID()}`,
    workspaceId,
    actor,
    action,
    entityType,
    entityId,
    summary,
    changedFields: fields,
    createdAt: timestamp,
  }
}

const PROJECT_DIFF_FIELDS = ['name', 'description', 'status'] as const
const NODE_DIFF_FIELDS = [
  'projectId', 'kind', 'title', 'description', 'schemaType', 'status', 'tags', 'provenance', 'position',
  'humanAnnotation', 'priority', 'evidenceCount', 'pinned', 'sourceUri', 'instruction', 'agentMode',
] as const
const EDGE_DIFF_FIELDS = ['projectId', 'source', 'target', 'relation', 'color', 'dashed'] as const
const ANNOTATION_DIFF_FIELDS = ['nodeId', 'body'] as const

function normalizeStoreOptions(input?: string | WorkspaceStoreOptions): NormalizedStoreOptions {
  const defaults = resolveClarityDataPaths()
  if (typeof input === 'string') {
    const resolved = path.resolve(input)
    if (path.extname(resolved).toLowerCase() === '.json') {
      return {
        databasePath: path.join(path.dirname(resolved), 'clarity.sqlite3'),
        artifactDirectory: path.join(path.dirname(resolved), 'artifacts'),
        legacyJsonPaths: [resolved],
      }
    }
    return {
      databasePath: resolved,
      artifactDirectory: path.join(path.dirname(resolved), 'artifacts'),
      legacyJsonPaths: defaults.legacyWorkspaceFiles,
    }
  }

  return {
    databasePath: path.resolve(input?.databasePath ?? defaults.databaseFile),
    artifactDirectory: path.resolve(input?.artifactDirectory ?? defaults.artifactDirectory),
    legacyJsonPaths: input?.legacyJsonPaths ?? defaults.legacyWorkspaceFiles,
  }
}

function safeTimestamp() {
  return new Date().toISOString().replaceAll(':', '-').replaceAll('.', '-')
}

function storageWorkspaceToken(workspaceId: string) {
  return createHash('sha256').update(workspaceId).digest('hex').slice(0, 24)
}

function cleanupArtifactDirectory(rootDirectory: string, workspaceToken: string) {
  if (!/^[a-f0-9]{24}$/.test(workspaceToken)) {
    throw new WorkspaceStoreError('INVALID_ARTIFACT_CLEANUP_TOKEN', 'A managed artifact cleanup record contains an invalid workspace token.')
  }
  const root = path.resolve(rootDirectory)
  const candidate = path.resolve(root, workspaceToken)
  if (!candidate.startsWith(`${root}${path.sep}`)) {
    throw new WorkspaceStoreError('INVALID_ARTIFACT_CLEANUP_TOKEN', 'A managed artifact cleanup record escapes the artifact directory.')
  }
  return candidate
}

function safeArtifactExtension(fileName: string) {
  const extension = path.extname(fileName).toLowerCase()
  return /^\.[a-z0-9]{1,16}$/.test(extension) ? extension : ''
}

function isRecoverableDatabaseCorruption(error: unknown) {
  if (error instanceof WorkspaceStoreError) return error.code === 'DATABASE_CORRUPT'
  const message = error instanceof Error ? error.message : String(error)
  return /database disk image is malformed|file is not a database|database corruption/i.test(message)
}

function isTransientDatabaseLock(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return /database is locked|database table is locked|SQLITE_BUSY/i.test(message)
}

function isSearchIndexRevisionConflict(error: unknown) {
  return error instanceof WorkspaceStoreError
    && (error.code === 'SEARCH_INDEX_CONFLICT' || error.code === 'WORKSPACE_CONFLICT')
}

export function isKnownDemoWorkspace(workspace: Pick<LegacyWorkspaceV1, 'id' | 'name' | 'nodes'>) {
  if (workspace.id === 'clarity-default') return true
  const titles = new Set(workspace.nodes.map((node) => node.title))
  return workspace.name === 'Clarity Workflows — Research Graph'
    && titles.has('Why We Sleep')
    && titles.has('Sleep Study 2024')
    && titles.has('Sleep-window training may improve learning transfer')
}

function upgradeLegacyWorkspace(legacy: LegacyWorkspaceV1): WorkspaceState {
  const timestamp = legacy.updatedAt || nowIso()
  // A pre-Chunk-2 pending run has no immutable evidence revision. It cannot be
  // reviewed safely, so import closes it explicitly instead of leaving an
  // unresolvable pending approval that looks actionable.
  const runs: WorkflowRun[] = legacy.runs.map((run) => ({
    ...run,
    workspaceId: legacy.id,
    ...(run.status === 'awaiting_approval' ? { status: 'rejected' as const, updatedAt: timestamp } : {}),
  }))
  const approvals: ApprovalRecord[] = runs.map((run) => {
    const status: ApprovalRecord['status'] = run.status === 'committed' ? 'approved' : 'rejected'
    return {
      id: `approval-${createHash('sha256').update(`${legacy.id}\u0000${run.id}`).digest('hex').slice(0, 32)}`,
      workspaceId: legacy.id,
      runId: run.id,
      status,
      decidedBy: 'legacy-import-unverified',
      decidedAt: run.updatedAt,
      createdAt: run.createdAt,
      updatedAt: run.updatedAt,
    }
  })
  return {
    version: 2,
    id: legacy.id,
    name: legacy.name,
    status: 'active',
    revision: 0,
    schemaContext: legacy.schemaContext,
    projects: [],
    nodes: legacy.nodes.map((node) => ({
      ...node,
      origin: 'imported-unverified' as const,
      createdAt: timestamp,
      updatedAt: timestamp,
    })),
    edges: legacy.edges.map((edge) => ({ ...edge, createdAt: timestamp, updatedAt: timestamp })),
    artifacts: [],
    annotations: [],
    workflowDefinitions: [],
    runs,
    gates: [],
    approvals,
    activities: [
      activity(legacy.id, timestamp, 'system', 'imported', 'workspace', `Imported legacy workspace “${legacy.name}”.`, legacy.id),
      ...legacy.runs
        .filter((run) => run.status === 'awaiting_approval')
        .map((run) => activity(
          legacy.id,
          timestamp,
          'system',
          'rejected',
          'workflow-run',
          'Closed a legacy pending run because its evidence revision cannot be verified safely.',
          run.id,
          ['status'],
        )),
    ],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export function createEmptyWorkspace(name = DEFAULT_WORKSPACE_NAME, id = `workspace-${randomUUID()}`): WorkspaceState {
  const timestamp = nowIso()
  const normalizedName = name.trim()
  return {
    version: 2,
    id,
    name: normalizedName,
    status: 'active',
    revision: 0,
    schemaContext: {
      schema: 'https://schema.org/',
      clarity: 'urn:clarity-workflows:',
    },
    projects: [],
    nodes: [],
    edges: [],
    artifacts: [],
    annotations: [],
    workflowDefinitions: [],
    runs: [],
    gates: [],
    approvals: [],
    activities: [activity(id, timestamp, 'human', 'created', 'workspace', `Created workspace “${normalizedName}”.`, id)],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

export class WorkspaceStore {
  readonly databasePath: string
  readonly artifactDirectory: string
  readonly legacyJsonPaths: string[]
  private readonly removeArtifactDirectory: (directory: string) => Promise<void>
  private database: DatabaseSync | null = null
  private initialized: Promise<void> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private readonly searchRebuilds = new Map<string, Promise<void>>()

  constructor(options?: string | WorkspaceStoreOptions) {
    const normalized = normalizeStoreOptions(options)
    this.databasePath = normalized.databasePath
    this.artifactDirectory = normalized.artifactDirectory
    this.legacyJsonPaths = normalized.legacyJsonPaths.map((candidate) => path.resolve(candidate))
    this.removeArtifactDirectory = typeof options === 'object' && options.removeArtifactDirectory
      ? options.removeArtifactDirectory
      : (directory) => rm(directory, { recursive: true, force: true })
  }

  async initialize() {
    this.initialized ??= this.initializeOnce()
    await this.initialized
  }

  async close() {
    await this.writeQueue
    this.database?.close()
    this.database = null
    this.initialized = null
  }

  async list(): Promise<WorkspaceSummary[]> {
    await this.initialize()
    const rows = this.requireDatabase().prepare(`
      SELECT
        w.id,
        w.name,
        w.status,
        w.revision,
        w.created_at,
        w.updated_at,
        (SELECT COUNT(*) FROM nodes n WHERE n.workspace_id = w.id) AS node_count,
        (SELECT COUNT(*) FROM edges e WHERE e.workspace_id = w.id) AS edge_count
      FROM workspaces w
      ORDER BY w.updated_at DESC, w.name COLLATE NOCASE ASC
    `).all() as SqlRow[]

    return rows.map((row) => ({
      id: String(row.id),
      name: String(row.name),
      status: String(row.status) as WorkspaceSummary['status'],
      revision: Number(row.revision),
      nodeCount: Number(row.node_count),
      edgeCount: Number(row.edge_count),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
    }))
  }

  async create(name = DEFAULT_WORKSPACE_NAME, id?: string): Promise<WorkspaceState> {
    await this.initialize()
    const workspace = workspaceSchema.parse(createEmptyWorkspace(name, id))
    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => this.insertWorkspace(workspace))
    })
    return cloneWorkspace(workspace)
  }

  async read(workspaceId?: string): Promise<WorkspaceState> {
    await this.initialize()
    await this.writeQueue
    const resolvedId = workspaceId ?? this.latestWorkspaceId()
    if (!resolvedId) {
      throw new WorkspaceStoreError('WORKSPACE_REQUIRED', 'No Clarity workspace exists yet. Create one in the desktop application first.')
    }
    return cloneWorkspace(this.readWorkspaceSync(resolvedId))
  }

  /**
   * Read only the disposable search projection. The graph, annotations and
   * managed artifact metadata remain the authority; a missing or corrupt
   * projection never changes the workspace returned by read().
   */
  async readSearchIndex(workspaceId: string): Promise<SearchIndexSnapshot> {
    await this.initialize()
    await this.writeQueue
    return structuredClone(this.readSearchIndexSync(workspaceId))
  }

  /**
   * Execute the Stage 4 bounded plain-text query against the disposable
   * projection. Search is read-only: it never scans managed bytes, mutates the
   * graph, interprets query text as SQL/FTS syntax, or returns an index that is
   * not current for the authoritative workspace revision.
   */
  async search(workspaceId: string, input: SearchQueryInput): Promise<SearchResultPage> {
    await this.initialize()
    const query = parseSearchQuery(input)
    await this.writeQueue

    let workspace = this.readWorkspaceSync(workspaceId)
    if (query.expectedWorkspaceRevision !== undefined && query.expectedWorkspaceRevision !== workspace.revision) {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_CONFLICT',
        `Search requested workspace revision ${query.expectedWorkspaceRevision}, but the current revision is ${workspace.revision}. Reload and rebuild before searching.`,
      )
    }

    let index = this.readSearchIndexSync(workspaceId)
    if (index.state.status !== 'ready' || index.state.indexedRevision !== workspace.revision) {
      // Search is semantically read-only even though its disposable local
      // projection may need maintenance. This is the production activation
      // and recovery path for fresh, dirty, failed, or crash-interrupted
      // workspaces. Concurrent callers in this process join one rebuild;
      // persisted `building` state is safe to reclaim after a restart.
      await this.ensureSearchIndexReady(workspaceId)
      await this.writeQueue
      workspace = this.readWorkspaceSync(workspaceId)
      index = this.readSearchIndexSync(workspaceId)
    }
    if (query.expectedWorkspaceRevision !== undefined && query.expectedWorkspaceRevision !== workspace.revision) {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_CONFLICT',
        `Search requested workspace revision ${query.expectedWorkspaceRevision}, but the current revision is ${workspace.revision}. Reload and search again.`,
      )
    }
    if (index.state.status !== 'ready') {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_NOT_READY',
        `The search index is ${index.state.status}; rebuild it from the current workspace before searching.`,
      )
    }
    if (index.state.indexedRevision !== workspace.revision) {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_STALE',
        `The search index covers workspace revision ${index.state.indexedRevision}, but the current workspace is revision ${workspace.revision}. Rebuild before searching.`,
      )
    }

    const nodeMetadata = new Map(workspace.nodes.map((node) => [node.id, { nodeId: node.id, projectId: node.projectId }]))
    const sourceMetadata = new Map<string, { nodeId?: string; projectId?: string }>()
    for (const node of workspace.nodes) {
      sourceMetadata.set(`node\u0000${node.id}`, { nodeId: node.id, projectId: node.projectId })
    }
    for (const annotation of workspace.annotations) {
      const node = nodeMetadata.get(annotation.nodeId)
      sourceMetadata.set(`annotation\u0000${annotation.id}`, { nodeId: annotation.nodeId, projectId: node?.projectId })
    }
    for (const artifact of workspace.artifacts) {
      const node = artifact.nodeId ? nodeMetadata.get(artifact.nodeId) : undefined
      sourceMetadata.set(`artifact\u0000${artifact.id}`, { nodeId: artifact.nodeId, projectId: node?.projectId })
    }

    for (const document of index.documents) {
      if (!sourceMetadata.has(`${document.sourceKind}\u0000${document.sourceId}`)) {
        throw new WorkspaceStoreError(
          'SEARCH_INDEX_STALE',
          `Search document ${document.id} references a source that no longer exists. Rebuild before searching.`,
        )
      }
    }

    return structuredClone(executeSearchQuery({
      workspaceId,
      workspaceRevision: workspace.revision,
      index,
      sourceMetadata,
    }, query))
  }

  /** Explicitly named alias for callers that prefer the workspace-oriented
   * Core API. Both methods share the same revision and trust boundary. */
  async searchWorkspace(workspaceId: string, input: SearchQueryInput): Promise<SearchResultPage> {
    return this.search(workspaceId, input)
  }

  /**
   * Fetch the exact bounded projection chunk identified by a Stage 4 result.
   * The request must carry both the workspace revision and the indexed content
   * digest observed by the caller. Artifact passages additionally re-verify
   * managed bytes before any content is returned.
   */
  async fetchSearchPassage(workspaceId: string, input: SearchFetchRequest): Promise<SearchPassage> {
    await this.initialize()
    const request = parseSearchFetchRequest(input)
    await this.writeQueue

    const workspace = this.readWorkspaceSync(workspaceId)
    if (request.expectedWorkspaceRevision > workspace.revision) {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_CONFLICT',
        `Passage retrieval requested future workspace revision ${request.expectedWorkspaceRevision}, but the current revision is ${workspace.revision}. Reload and search again.`,
      )
    }

    const index = this.readSearchIndexSync(workspaceId)
    if (index.state.status !== 'ready' && index.state.status !== 'dirty') {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_NOT_READY',
        `The search index is ${index.state.status}; rebuild it before retrieving a passage.`,
      )
    }

    const chunk = index.chunks.find((candidate) => candidate.id === request.resultId)
    if (!chunk) throw new WorkspaceStoreError('SEARCH_RESULT_NOT_FOUND', `Search result ${request.resultId} was not found in the current projection.`)
    if (request.expectedWorkspaceRevision !== chunk.provenance.workspaceRevision) {
      throw new WorkspaceStoreError(
        'SEARCH_INDEX_CONFLICT',
        `Passage retrieval requested workspace revision ${request.expectedWorkspaceRevision}, but result ${request.resultId} was indexed at revision ${chunk.provenance.workspaceRevision}.`,
      )
    }
    if (chunk.provenance.contentHash !== request.expectedContentHash || hashSearchContent(chunk.text) !== request.expectedContentHash) {
      throw new WorkspaceStoreError('SEARCH_SOURCE_CHANGED', `Search result ${request.resultId} no longer matches the expected indexed content hash.`)
    }

    const node = chunk.provenance.nodeId
      ? workspace.nodes.find((candidate) => candidate.id === chunk.provenance.nodeId)
      : undefined
    const annotation = chunk.provenance.annotationId
      ? workspace.annotations.find((candidate) => candidate.id === chunk.provenance.annotationId)
      : undefined
    const artifact = chunk.provenance.artifactId
      ? workspace.artifacts.find((candidate) => candidate.id === chunk.provenance.artifactId)
      : undefined
    const sourceExists = chunk.provenance.sourceKind === 'node' ? Boolean(node)
      : chunk.provenance.sourceKind === 'annotation' ? Boolean(annotation)
        : Boolean(artifact)
    if (!sourceExists) throw new WorkspaceStoreError('SEARCH_SOURCE_REMOVED', `Search source for result ${request.resultId} no longer exists.`)

    const canonical = buildCanonicalSearchSource(workspace, chunk.provenance.sourceKind, chunk.provenance.sourceId)
    const canonicalChunk = canonical?.chunks.find((candidate) => candidate.id === request.resultId)
    if (
      !canonicalChunk
      || canonicalChunk.text !== chunk.text
      || canonicalChunk.provenance.contentHash !== request.expectedContentHash
    ) {
      throw new WorkspaceStoreError('SEARCH_SOURCE_CHANGED', `Search result ${request.resultId} no longer represents the current authoritative source.`)
    }

    const expectedTrust = chunk.provenance.sourceKind === 'node'
      ? node ? trustForNode(node) : undefined
      : chunk.provenance.sourceKind === 'annotation'
        ? annotation ? trustForAnnotation(annotation) : undefined
        : artifact
          ? artifact.nodeId
            ? (() => {
              const linkedNode = workspace.nodes.find((candidate) => candidate.id === artifact.nodeId)
              return linkedNode ? trustForNode(linkedNode) : { label: 'human' as const, effectiveAuthor: 'human' as const, verified: true }
            })()
            : { label: 'human' as const, effectiveAuthor: 'human' as const, verified: true }
          : undefined
    if (!expectedTrust) throw new WorkspaceStoreError('SEARCH_SOURCE_REMOVED', `Search source for result ${request.resultId} no longer exists.`)
    if (JSON.stringify(chunk.trust) !== JSON.stringify(expectedTrust)) {
      throw new WorkspaceStoreError('SEARCH_TRUST_MISMATCH', `Search result ${request.resultId} no longer matches authoritative source trust.`)
    }

    if (artifact) {
      if (artifact.extractionStatus !== 'extracted' || artifact.sha256 !== chunk.provenance.sourceSha256) {
        throw new WorkspaceStoreError('SEARCH_SOURCE_CHANGED', `Extracted artifact for result ${request.resultId} is no longer the indexed source.`)
      }
      await this.verifyManagedArtifactIntegrity(artifact)
      const latest = await this.read(workspaceId)
      if (latest.revision !== workspace.revision) {
        throw new WorkspaceStoreError('SEARCH_INDEX_STALE', 'The workspace changed while managed artifact bytes were verified. Search again.')
      }
    }

    return structuredClone(buildSearchPassage({
      workspaceId,
      workspaceRevision: request.expectedWorkspaceRevision,
      request,
      chunk,
      trust: expectedTrust,
    }))
  }

  async retrieveSearchPassage(workspaceId: string, input: SearchFetchRequest): Promise<SearchPassage> {
    return this.fetchSearchPassage(workspaceId, input)
  }

  /**
   * Replace a derived search projection atomically. Callers must identify the
   * workspace revision used to build every document. A stale rebuild is
   * rejected rather than being allowed to overwrite a newer graph revision.
   */
  async replaceSearchIndex(workspaceId: string, input: DerivedSearchIndexInput): Promise<SearchIndexSnapshot> {
    await this.initialize()
    const parsed = parseDerivedSearchIndexInput(input)
    let result: SearchIndexSnapshot | null = null

    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        const current = this.readWorkspaceSync(workspaceId)
        if (parsed.expectedWorkspaceRevision !== current.revision) {
          throw new WorkspaceStoreError(
            'SEARCH_INDEX_CONFLICT',
            `Search index was built for workspace revision ${parsed.expectedWorkspaceRevision}, but the current revision is ${current.revision}. Rebuild from the latest workspace.`,
          )
        }
        const canonical = buildSearchIndexInput(current)
        if (
          !sameProjectionRecords(parsed.documents, canonical.documents)
          || !sameProjectionRecords(parsed.chunks, canonical.chunks)
        ) {
          throw new WorkspaceStoreError(
            'SEARCH_INDEX_NON_CANONICAL',
            'Only the exact deterministic projection derived from the authoritative Clarity Core may replace the search index.',
          )
        }
        const invalidWorkspaceRecord = [...parsed.documents, ...parsed.chunks]
          .find((record) => record.workspaceId !== workspaceId)
        if (invalidWorkspaceRecord) {
          throw new WorkspaceStoreError('SEARCH_INDEX_WORKSPACE_MISMATCH', 'Search index records must belong to the requested workspace.')
        }

        for (const document of parsed.documents) {
          if (document.sourceKind === 'node') {
            const node = current.nodes.find((candidate) => candidate.id === document.sourceId)
            if (!node) throw new WorkspaceStoreError('SEARCH_SOURCE_NOT_FOUND', `Search document ${document.id} references missing node ${document.sourceId}.`)
            if (JSON.stringify(document.trust) !== JSON.stringify(trustForNode(node))) {
              throw new WorkspaceStoreError('SEARCH_TRUST_MISMATCH', `Search document ${document.id} does not preserve the node's authoritative trust metadata.`)
            }
          } else if (document.sourceKind === 'annotation') {
            const annotation = current.annotations.find((candidate) => candidate.id === document.sourceId)
            if (!annotation) throw new WorkspaceStoreError('SEARCH_SOURCE_NOT_FOUND', `Search document ${document.id} references missing annotation ${document.sourceId}.`)
            if (JSON.stringify(document.trust) !== JSON.stringify(trustForAnnotation(annotation))) {
              throw new WorkspaceStoreError('SEARCH_TRUST_MISMATCH', `Search document ${document.id} does not preserve the annotation's authoritative trust metadata.`)
            }
          } else {
            const artifact = current.artifacts.find((candidate) => candidate.id === document.sourceId)
            if (!artifact) throw new WorkspaceStoreError('SEARCH_SOURCE_NOT_FOUND', `Search document ${document.id} references missing artifact ${document.sourceId}.`)
            if (artifact.extractionStatus !== 'extracted' || document.sourceSha256 !== artifact.sha256) {
              throw new WorkspaceStoreError('SEARCH_SOURCE_CHANGED', `Search document ${document.id} is not bound to the current extracted artifact bytes.`)
            }
            const linkedNode = artifact.nodeId ? current.nodes.find((candidate) => candidate.id === artifact.nodeId) : undefined
            const expectedTrust = linkedNode
              ? trustForNode(linkedNode)
              : { label: 'human' as const, effectiveAuthor: 'human' as const, verified: true }
            if (JSON.stringify(document.trust) !== JSON.stringify(expectedTrust)) {
              throw new WorkspaceStoreError('SEARCH_TRUST_MISMATCH', `Search document ${document.id} does not preserve the artifact's authoritative trust metadata.`)
            }
          }
        }

        const currentIndexState = this.readSearchIndexStateSync(workspaceId)
        const generation = currentIndexState.generation + 1
        const timestamp = nowIso()
        const database = this.requireDatabase()
        database.prepare('DELETE FROM search_documents WHERE workspace_id = ?').run(workspaceId)

        const documentInsert = database.prepare(`
          INSERT INTO search_documents(
            workspace_id,id,source_kind,source_id,title,source_uri,content_hash,source_sha256,
            workspace_revision,extraction_status,extraction_format,trust_json,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `)
        for (const document of parsed.documents) {
          documentInsert.run(
            workspaceId,
            document.id,
            document.sourceKind,
            document.sourceId,
            document.title,
            document.sourceUri ?? null,
            document.contentHash,
            document.sourceSha256 ?? null,
            document.workspaceRevision,
            document.extractionStatus ?? null,
            document.extractionFormat ?? null,
            JSON.stringify(document.trust),
            document.createdAt,
            document.updatedAt,
          )
        }

        const chunkInsert = database.prepare(`
          INSERT INTO search_chunks(
            workspace_id,id,document_id,sequence,text,character_count,byte_count,
            provenance_json,trust_json,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `)
        for (const chunk of parsed.chunks) {
          chunkInsert.run(
            workspaceId,
            chunk.id,
            chunk.documentId,
            chunk.sequence,
            chunk.text,
            chunk.characterCount,
            chunk.byteCount,
            JSON.stringify(chunk.provenance),
            JSON.stringify(chunk.trust),
            chunk.createdAt,
            chunk.updatedAt,
          )
        }

        database.prepare(`
          UPDATE search_index_state
          SET status = 'ready', indexed_revision = ?, generation = ?,
              document_count = ?, chunk_count = ?, rebuild_requested_at = NULL,
              last_indexed_at = ?, last_error = NULL, updated_at = ?
          WHERE workspace_id = ?
        `).run(current.revision, generation, parsed.documents.length, parsed.chunks.length, timestamp, timestamp, workspaceId)
        result = this.readSearchIndexSync(workspaceId)
      })
    })

    if (!result) throw new WorkspaceStoreError('SEARCH_INDEX_REBUILD_FAILED', 'The search index transaction completed without a result.')
    return structuredClone(result)
  }

  /** Mark the disposable projection stale without changing the graph revision. */
  async markSearchIndexDirty(workspaceId: string, reason = 'Workspace content changed; the derived search index must be rebuilt.') {
    await this.initialize()
    const boundedReason = reason.slice(0, SEARCH_INDEX_ERROR_MAX_CHARACTERS)
    let result: SearchIndexState | null = null
    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        this.readWorkspaceSync(workspaceId)
        const state = this.readSearchIndexStateSync(workspaceId)
        const timestamp = nowIso()
        const status = state.status === 'unbuilt' ? 'unbuilt' : 'dirty'
        this.requireDatabase().prepare(`
          UPDATE search_index_state
          SET status = ?, rebuild_requested_at = ?, last_error = ?, updated_at = ?
          WHERE workspace_id = ?
        `).run(status, timestamp, boundedReason, timestamp, workspaceId)
        result = this.readSearchIndexStateSync(workspaceId)
      })
    })
    if (!result) throw new WorkspaceStoreError('SEARCH_INDEX_UNAVAILABLE', 'The search index state transaction completed without a result.')
    return structuredClone(result)
  }

  /**
   * Rebuild the disposable projection from one immutable workspace snapshot.
   *
   * The builder is deliberately kept outside SQLite: graph state remains the
   * authority, managed artifact bytes are verified before their extracted text
   * is admitted, and the final replace transaction is revision-checked. A
   * failed build therefore leaves the previous ready projection intact while
   * making the failure visible in the state row for an operator retry.
   */
  async rebuildSearchIndex(workspaceId: string): Promise<SearchIndexSnapshot> {
    await this.initialize()
    const snapshot = await this.read(workspaceId)
    await this.markSearchIndexBuilding(workspaceId, snapshot.revision)

    try {
      for (const artifact of snapshot.artifacts) {
        if (artifact.extractionStatus === 'extracted') {
          await this.verifyManagedArtifactIntegrity(artifact)
        }
      }
      const input = buildSearchIndexInput(snapshot)
      return await this.replaceSearchIndex(workspaceId, input)
    } catch (error) {
      // A graph revision conflict means another writer has already marked the
      // projection dirty. Do not overwrite that newer state with this build's
      // failure message; the caller must rebuild from the new snapshot.
      if (!isSearchIndexRevisionConflict(error)) {
        await this.markSearchIndexFailed(workspaceId, snapshot.revision, error)
      }
      throw error
    }
  }

  private async ensureSearchIndexReady(workspaceId: string) {
    const existing = this.searchRebuilds.get(workspaceId)
    if (existing) return existing

    let rebuild!: Promise<void>
    rebuild = this.rebuildSearchIndex(workspaceId)
      .then(() => undefined)
      .finally(() => {
        if (this.searchRebuilds.get(workspaceId) === rebuild) this.searchRebuilds.delete(workspaceId)
      })
    this.searchRebuilds.set(workspaceId, rebuild)
    return rebuild
  }

  private async markSearchIndexBuilding(workspaceId: string, expectedRevision: number) {
    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        const current = this.readWorkspaceSync(workspaceId)
        if (current.revision !== expectedRevision) {
          throw new WorkspaceStoreError(
            'SEARCH_INDEX_CONFLICT',
            `Search index build started at workspace revision ${expectedRevision}, but the current revision is ${current.revision}. Rebuild from the latest workspace.`,
          )
        }
        this.readSearchIndexStateSync(workspaceId)
        const timestamp = nowIso()
        this.requireDatabase().prepare(`
          UPDATE search_index_state
          SET status = 'building', rebuild_requested_at = ?, last_error = NULL, updated_at = ?
          WHERE workspace_id = ?
        `).run(timestamp, timestamp, workspaceId)
      })
    })
  }

  private async markSearchIndexFailed(workspaceId: string, expectedRevision: number, error: unknown) {
    try {
      await this.enqueueWrite(() => {
        this.withImmediateTransaction(() => {
          const current = this.readWorkspaceSync(workspaceId)
          if (current.revision !== expectedRevision) {
            throw new WorkspaceStoreError(
              'SEARCH_INDEX_CONFLICT',
              `Search index failure belongs to workspace revision ${expectedRevision}, but the current revision is ${current.revision}.`,
            )
          }
          this.readSearchIndexStateSync(workspaceId)
          const timestamp = nowIso()
          const message = error instanceof Error ? error.message : String(error)
          this.requireDatabase().prepare(`
            UPDATE search_index_state
            SET status = 'failed', last_error = ?, updated_at = ?
            WHERE workspace_id = ?
          `).run(message.slice(0, SEARCH_INDEX_ERROR_MAX_CHARACTERS), timestamp, workspaceId)
        })
      })
    } catch (failure) {
      // The original build error is more actionable to callers. A concurrent
      // revision change is expected during rebuild and is represented by the
      // newer dirty state; other bookkeeping failures are also non-fatal to
      // the graph and will be surfaced by the next state read/retry.
      if (!isSearchIndexRevisionConflict(failure)) return
    }
  }

  async findWorkspaceIdByRun(runId: string) {
    await this.initialize()
    await this.writeQueue
    const rows = this.requireDatabase().prepare('SELECT workspace_id FROM workflow_runs WHERE id = ? ORDER BY workspace_id').all(runId) as SqlRow[]
    if (rows.length > 1) {
      throw new WorkspaceStoreError('RUN_ID_AMBIGUOUS', `Workflow run ${runId} exists in more than one workspace; provide the workspace id explicitly.`)
    }
    return rows[0] ? String(rows[0].workspace_id) : null
  }

  async mutate(mutator: WorkspaceMutator): Promise<WorkspaceState>
  async mutate(workspaceId: string, mutator: WorkspaceMutator, options?: WorkspaceMutationOptions): Promise<WorkspaceState>
  async mutate(
    workspaceIdOrMutator: string | WorkspaceMutator,
    maybeMutator?: WorkspaceMutator,
    options: WorkspaceMutationOptions = {},
  ): Promise<WorkspaceState> {
    await this.initialize()
    const workspaceId = typeof workspaceIdOrMutator === 'string'
      ? workspaceIdOrMutator
      : undefined
    const mutator = typeof workspaceIdOrMutator === 'function'
      ? workspaceIdOrMutator
      : maybeMutator
    if (!mutator) throw new WorkspaceStoreError('INVALID_MUTATION', 'A workspace mutation function is required.')

    let result: WorkspaceState | null = null
    await this.enqueueWrite(async () => {
      const resolvedId = workspaceId ?? this.latestWorkspaceId()
      if (!resolvedId) throw new WorkspaceStoreError('WORKSPACE_REQUIRED', 'No Clarity workspace exists yet.')
      const verifyArtifactIds = [...new Set(options.verifyArtifactIds ?? [])]
      if (verifyArtifactIds.length) {
        const verificationWorkspace = this.readWorkspaceSync(resolvedId)
        for (const artifactId of verifyArtifactIds) {
          const artifact = verificationWorkspace.artifacts.find((candidate) => candidate.id === artifactId)
          if (!artifact) throw new WorkspaceStoreError('ARTIFACT_NOT_FOUND', `Artifact ${artifactId} was not found.`)
          await this.verifyManagedArtifactIntegrity(artifact)
        }
      }
      this.withImmediateTransaction(() => {
        const current = this.readWorkspaceSync(resolvedId)
        const working = cloneWorkspace(current)
        const next = mutator(working) ?? working
        const markSearchDirty = options.markSearchDirty ?? true
        const incrementRevision = options.incrementRevision ?? true
        if (!incrementRevision && markSearchDirty) {
          throw new WorkspaceStoreError('INVALID_MUTATION_OPTIONS', 'A search-content mutation must increment the authoritative workspace revision.')
        }
        if (!markSearchDirty && searchSourceFingerprint(next) !== searchSourceFingerprint(current)) {
          throw new WorkspaceStoreError('SEARCH_SOURCE_MUTATION_REQUIRED', 'A non-search mutation cannot alter projects, nodes, artifacts, or annotations.')
        }
        const timestamp = mutationTimestamp(current)
        const currentProjects = new Map(current.projects.map((project) => [project.id, project]))
        const currentNodes = new Map(current.nodes.map((node) => [node.id, node]))
        const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]))
        const currentAnnotations = new Map(current.annotations.map((annotation) => [annotation.id, annotation]))
        const currentDefinitions = new Map(current.workflowDefinitions.map((definition) => [definition.id, definition]))
        const currentRuns = new Map(current.runs.map((run) => [run.id, run]))
        const currentGates = new Map(current.gates.map((gate) => [gate.id, gate]))
        const currentApprovals = new Map(current.approvals.map((approval) => [approval.id, approval]))
        const currentActivityIds = new Set(current.activities.map((item) => item.id))
        next.projects = next.projects.map((project) => {
          const previous = currentProjects.get(project.id)
          return {
            ...project,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: !previous || changedFields(previous, project, PROJECT_DIFF_FIELDS).length ? timestamp : previous.updatedAt,
          }
        })
        next.nodes = next.nodes.map((node) => {
          const previous = currentNodes.get(node.id)
          return {
            ...node,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: !previous || changedFields(previous, node, NODE_DIFF_FIELDS).length ? timestamp : previous.updatedAt,
          }
        })
        next.edges = next.edges.map((edge) => {
          const previous = currentEdges.get(edge.id)
          return {
            ...edge,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: !previous || changedFields(previous, edge, EDGE_DIFF_FIELDS).length ? timestamp : previous.updatedAt,
          }
        })
        next.annotations = next.annotations.map((annotation) => {
          const previous = currentAnnotations.get(annotation.id)
          return {
            ...annotation,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: !previous || changedFields(previous, annotation, ANNOTATION_DIFF_FIELDS).length ? timestamp : previous.updatedAt,
          }
        })
        next.workflowDefinitions = next.workflowDefinitions.map((definition) => {
          const previous = currentDefinitions.get(definition.id)
          return { ...definition, createdAt: previous?.createdAt ?? timestamp, updatedAt: !previous || entityChanged(previous, definition) ? timestamp : previous.updatedAt }
        })
        next.runs = next.runs.map((run) => {
          const previous = currentRuns.get(run.id)
          return { ...run, createdAt: previous?.createdAt ?? timestamp, updatedAt: !previous || entityChanged(previous, run) ? timestamp : previous.updatedAt }
        })
        next.gates = next.gates.map((gate) => {
          const previous = currentGates.get(gate.id)
          return { ...gate, createdAt: previous?.createdAt ?? timestamp, updatedAt: !previous || entityChanged(previous, gate) ? timestamp : previous.updatedAt }
        })
        next.approvals = next.approvals.map((approval) => {
          const previous = currentApprovals.get(approval.id)
          return { ...approval, createdAt: previous?.createdAt ?? timestamp, updatedAt: !previous || entityChanged(previous, approval) ? timestamp : previous.updatedAt }
        })
        next.activities = next.activities.map((item) => currentActivityIds.has(item.id) ? item : { ...item, createdAt: timestamp })
        next.updatedAt = timestamp
        next.revision = current.revision + (incrementRevision ? 1 : 0)
        const validated = workspaceSchema.parse(next)
        if (validated.id !== current.id) {
          throw new WorkspaceStoreError('WORKSPACE_ID_IMMUTABLE', 'A workspace mutation cannot change its identity.')
        }
        this.replaceWorkspaceChildren(validated, markSearchDirty)
        result = this.readWorkspaceSync(validated.id)
      })
    })
    if (!result) throw new WorkspaceStoreError('MUTATION_FAILED', 'The workspace transaction completed without a result.')
    return cloneWorkspace(result as WorkspaceState)
  }

  async saveHumanWorkspace(workspaceId: string, input: HumanWorkspaceSaveInput): Promise<WorkspaceState> {
    await this.initialize()
    const parsed = humanWorkspaceSaveSchema.parse(input)
    let result: WorkspaceState | null = null

    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        const current = this.readWorkspaceSync(workspaceId)
        if (parsed.expectedRevision !== current.revision) {
          throw new WorkspaceStoreError(
            'WORKSPACE_CONFLICT',
            `Workspace ${workspaceId} changed from revision ${parsed.expectedRevision} to ${current.revision}. Reload it before saving or deleting anything.`,
          )
        }

        const timestamp = mutationTimestamp(current)
        const currentProjects = new Map(current.projects.map((project) => [project.id, project]))
        const currentNodes = new Map(current.nodes.map((node) => [node.id, node]))
        const currentEdges = new Map(current.edges.map((edge) => [edge.id, edge]))
        const currentHumanAnnotations = new Map(current.annotations.filter((annotation) => annotation.author === 'human').map((annotation) => [annotation.id, annotation]))
        const protectedAnnotations = current.annotations.filter((annotation) => annotation.author !== 'human')

        const projects: ClarityProject[] = parsed.projects.map((project) => {
          if (project.workspaceId && project.workspaceId !== workspaceId) {
            throw new WorkspaceStoreError('WORKSPACE_ID_MISMATCH', `Project ${project.id} belongs to another workspace.`)
          }
          const previous = currentProjects.get(project.id)
          const candidate: ClarityProject = {
            id: project.id,
            workspaceId,
            name: project.name,
            description: project.description,
            status: project.status,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: previous?.updatedAt ?? timestamp,
          }
          if (previous && changedFields(previous, candidate, PROJECT_DIFF_FIELDS).length) candidate.updatedAt = timestamp
          return candidate
        })

        const nodes: ClarityNode[] = parsed.nodes.map((node) => {
          const previous = currentNodes.get(node.id)
          if (!previous && !HUMAN_NODE_KINDS.has(node.kind)) {
            throw new WorkspaceStoreError('HUMAN_NODE_KIND_RESERVED', `Node kind ${node.kind} is reserved for Clarity-managed workflow state.`)
          }
          if (previous?.origin === 'human' && previous.kind !== node.kind && !HUMAN_NODE_KINDS.has(node.kind)) {
            throw new WorkspaceStoreError('HUMAN_NODE_KIND_RESERVED', `Human node ${node.id} cannot be converted to reserved kind ${node.kind}.`)
          }
          const candidate: ClarityNode = {
            id: node.id,
            projectId: node.projectId,
            origin: previous?.origin ?? 'human',
            kind: node.kind,
            title: node.title,
            description: node.description,
            schemaType: node.schemaType,
            status: node.status,
            tags: node.tags,
            provenance: node.provenance,
            position: node.position,
            humanAnnotation: node.humanAnnotation,
            aiAnnotation: previous?.aiAnnotation,
            priority: node.priority,
            evidenceCount: node.evidenceCount,
            pinned: node.pinned,
            sourceUri: node.sourceUri,
            instruction: node.instruction,
            agentMode: node.agentMode,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: previous?.updatedAt ?? timestamp,
          }
          if (previous && changedFields(previous, candidate, NODE_DIFF_FIELDS).length) candidate.updatedAt = timestamp
          return candidate
        })

        const edges: ClarityEdge[] = parsed.edges.map((edge) => {
          const previous = currentEdges.get(edge.id)
          const candidate: ClarityEdge = {
            id: edge.id,
            projectId: edge.projectId,
            source: edge.source,
            target: edge.target,
            relation: edge.relation,
            color: edge.color,
            dashed: edge.dashed,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: previous?.updatedAt ?? timestamp,
          }
          if (previous && changedFields(previous, candidate, EDGE_DIFF_FIELDS).length) candidate.updatedAt = timestamp
          return candidate
        })

        const protectedAnnotationIds = new Set(protectedAnnotations.map((annotation) => annotation.id))
        const humanAnnotations: ClarityAnnotation[] = parsed.annotations.map((annotation) => {
          if (annotation.workspaceId && annotation.workspaceId !== workspaceId) {
            throw new WorkspaceStoreError('WORKSPACE_ID_MISMATCH', `Annotation ${annotation.id} belongs to another workspace.`)
          }
          if (protectedAnnotationIds.has(annotation.id)) {
            throw new WorkspaceStoreError('PROTECTED_ANNOTATION', `Annotation ${annotation.id} is owned by Clarity and cannot be replaced by a human save.`)
          }
          const previous = currentHumanAnnotations.get(annotation.id)
          const candidate: ClarityAnnotation = {
            id: annotation.id,
            workspaceId,
            nodeId: annotation.nodeId,
            author: 'human',
            origin: previous?.origin ?? 'local',
            declaredAuthor: previous?.declaredAuthor,
            body: annotation.body,
            createdAt: previous?.createdAt ?? timestamp,
            updatedAt: previous?.updatedAt ?? timestamp,
          }
          if (previous && changedFields(previous, candidate, ANNOTATION_DIFF_FIELDS).length) candidate.updatedAt = timestamp
          return candidate
        })

        const desiredProjectIds = new Set(projects.map((project) => project.id))
        const desiredNodeIds = new Set(nodes.map((node) => node.id))

        // An archived project is a durable read-only boundary, not merely a
        // renderer convention. The only permitted transition is changing its
        // status, and graph entities owned by or touching it must remain exact.
        for (const currentProject of current.projects) {
          const desiredProject = projects.find((project) => project.id === currentProject.id)
          const crossesArchiveBoundary = currentProject.status === 'archived' || desiredProject?.status === 'archived'
          if (!crossesArchiveBoundary) continue
          if (!desiredProject) {
            throw new WorkspaceStoreError('PROJECT_ARCHIVED', `Archived project ${currentProject.id} must be restored before it can be deleted.`)
          }
          const projectChanges = changedFields(currentProject, desiredProject, PROJECT_DIFF_FIELDS)
          if (projectChanges.some((field) => field !== 'status')) {
            throw new WorkspaceStoreError('PROJECT_ARCHIVED', `Project ${currentProject.id} may only be archived or restored; rename and description changes require an active project.`)
          }

          const beforeNodeIds = new Set(current.nodes.filter((node) => node.projectId === currentProject.id).map((node) => node.id))
          const afterNodeIds = new Set(nodes.filter((node) => node.projectId === currentProject.id).map((node) => node.id))
          if (beforeNodeIds.size !== afterNodeIds.size || [...beforeNodeIds].some((nodeId) => !afterNodeIds.has(nodeId))) {
            throw new WorkspaceStoreError('PROJECT_ARCHIVED', `Items cannot be added to, removed from, or moved across archived project ${currentProject.id}.`)
          }
          for (const nodeId of beforeNodeIds) {
            const before = currentNodes.get(nodeId)
            const after = nodes.find((node) => node.id === nodeId)
            if (!before || !after || changedFields(before, after, NODE_DIFF_FIELDS).length) {
              throw new WorkspaceStoreError('PROJECT_ARCHIVED', `Items in archived project ${currentProject.id} are read-only until it is restored.`)
            }
          }

          const beforeAnnotations = new Map([...currentHumanAnnotations.values()]
            .filter((annotation) => beforeNodeIds.has(annotation.nodeId))
            .map((annotation) => [annotation.id, annotation]))
          const afterAnnotations = new Map(humanAnnotations
            .filter((annotation) => afterNodeIds.has(annotation.nodeId))
            .map((annotation) => [annotation.id, annotation]))
          if (beforeAnnotations.size !== afterAnnotations.size || [...beforeAnnotations].some(([annotationId, before]) => {
            const after = afterAnnotations.get(annotationId)
            return !after || changedFields(before, after, ANNOTATION_DIFF_FIELDS).length > 0
          })) {
            throw new WorkspaceStoreError('PROJECT_ARCHIVED', `Annotations on items in archived project ${currentProject.id} are read-only until it is restored.`)
          }

          const touchesProject = (edge: ClarityEdge, projectNodeIds: Set<string>) => edge.projectId === currentProject.id
            || projectNodeIds.has(edge.source)
            || projectNodeIds.has(edge.target)
          const beforeEdges = new Map(current.edges.filter((edge) => touchesProject(edge, beforeNodeIds)).map((edge) => [edge.id, edge]))
          const afterEdges = new Map(edges.filter((edge) => touchesProject(edge, afterNodeIds)).map((edge) => [edge.id, edge]))
          if (beforeEdges.size !== afterEdges.size || [...beforeEdges].some(([edgeId, before]) => {
            const after = afterEdges.get(edgeId)
            return !after || changedFields(before, after, EDGE_DIFF_FIELDS).length > 0
          })) {
            throw new WorkspaceStoreError('PROJECT_ARCHIVED', `Relationships touching archived project ${currentProject.id} are read-only until it is restored.`)
          }
        }

        const protectedProjectIds = new Set([
          ...current.workflowDefinitions.map((definition) => definition.projectId),
          ...current.runs.map((run) => run.projectId),
        ].filter((id): id is string => Boolean(id)))
        for (const protectedProjectId of protectedProjectIds) {
          if (!desiredProjectIds.has(protectedProjectId)) {
            throw new WorkspaceStoreError('PROTECTED_STATE_CONFLICT', `Project ${protectedProjectId} is referenced by workflow history and cannot be deleted.`)
          }
        }

        const protectedNodeIds = new Set<string>()
        for (const annotation of protectedAnnotations) protectedNodeIds.add(annotation.nodeId)
        for (const node of current.nodes) if (node.aiAnnotation) protectedNodeIds.add(node.id)
        for (const run of current.runs) {
          for (const sourceId of run.sourceNodeIds) protectedNodeIds.add(sourceId)
          for (const evidenceId of run.candidate.evidenceNodeIds) protectedNodeIds.add(evidenceId)
          if (run.committedNodeId) protectedNodeIds.add(run.committedNodeId)
        }
        for (const protectedNodeId of protectedNodeIds) {
          if (!desiredNodeIds.has(protectedNodeId)) {
            throw new WorkspaceStoreError('PROTECTED_STATE_CONFLICT', `Node ${protectedNodeId} is referenced by AI annotations or workflow history and cannot be deleted.`)
          }
        }

        const committedNodeIds = new Set(current.runs.map((run) => run.committedNodeId).filter((id): id is string => Boolean(id)))
        for (const committedNodeId of committedNodeIds) {
          const before = currentNodes.get(committedNodeId)
          const after = nodes.find((node) => node.id === committedNodeId)
          if (!before || !after) continue
          const protectedChanges = changedFields(before, after, NODE_DIFF_FIELDS)
            .filter((field) => !['position', 'humanAnnotation', 'pinned'].includes(field))
          if (protectedChanges.length) {
            throw new WorkspaceStoreError('PROTECTED_STATE_CONFLICT', `Approved result ${committedNodeId} cannot be rewritten by a human workspace save.`)
          }
        }

        const protectedEvidenceEdgeIds = new Set<string>()
        for (const run of current.runs) {
          if (!run.committedNodeId) continue
          for (const edge of current.edges) {
            if (edge.target === run.committedNodeId && run.candidate.evidenceNodeIds.includes(edge.source)) protectedEvidenceEdgeIds.add(edge.id)
          }
        }
        const desiredEdges = new Map(edges.map((edge) => [edge.id, edge]))
        for (const edgeId of protectedEvidenceEdgeIds) {
          const before = currentEdges.get(edgeId)
          const after = desiredEdges.get(edgeId)
          if (!before || !after || changedFields(before, after, EDGE_DIFF_FIELDS).length) {
            throw new WorkspaceStoreError('PROTECTED_STATE_CONFLICT', `Approved evidence relationship ${edgeId} cannot be removed or rewritten.`)
          }
        }

        const nextActivities: ClarityActivity[] = []
        const workspaceFields = [
          ...(current.name === parsed.name ? [] : ['name']),
          ...(current.status === parsed.status ? [] : ['status']),
        ]
        if (workspaceFields.length) {
          nextActivities.push(activity(workspaceId, timestamp, 'human', 'updated', 'workspace', `Updated workspace “${parsed.name}”.`, workspaceId, workspaceFields))
        }

        for (const project of projects) {
          const previous = currentProjects.get(project.id)
          if (!previous) nextActivities.push(activity(workspaceId, timestamp, 'human', 'created', 'project', `Created project “${project.name}”.`, project.id))
          else {
            const fields = changedFields(previous, project, PROJECT_DIFF_FIELDS)
            if (fields.length) nextActivities.push(activity(workspaceId, timestamp, 'human', 'updated', 'project', `Updated project “${project.name}”.`, project.id, fields))
          }
        }
        for (const project of current.projects) if (!desiredProjectIds.has(project.id)) {
          nextActivities.push(activity(workspaceId, timestamp, 'human', 'deleted', 'project', `Deleted project “${project.name}”.`, project.id))
        }

        for (const node of nodes) {
          const previous = currentNodes.get(node.id)
          if (!previous) nextActivities.push(activity(workspaceId, timestamp, 'human', 'created', 'node', `Created ${node.kind} “${node.title}”.`, node.id))
          else {
            const fields = changedFields(previous, node, NODE_DIFF_FIELDS)
            if (fields.length) nextActivities.push(activity(workspaceId, timestamp, 'human', 'updated', 'node', `Updated ${node.kind} “${node.title}”.`, node.id, fields))
          }
        }
        for (const node of current.nodes) if (!desiredNodeIds.has(node.id)) {
          nextActivities.push(activity(workspaceId, timestamp, 'human', 'deleted', 'node', `Deleted ${node.kind} “${node.title}”.`, node.id))
        }

        const desiredEdgeIds = new Set(edges.map((edge) => edge.id))
        for (const edge of edges) {
          const previous = currentEdges.get(edge.id)
          if (!previous) nextActivities.push(activity(workspaceId, timestamp, 'human', 'created', 'edge', `Created relationship “${edge.relation}”.`, edge.id))
          else {
            const fields = changedFields(previous, edge, EDGE_DIFF_FIELDS)
            if (fields.length) nextActivities.push(activity(workspaceId, timestamp, 'human', 'updated', 'edge', `Updated relationship “${edge.relation}”.`, edge.id, fields))
          }
        }
        for (const edge of current.edges) if (!desiredEdgeIds.has(edge.id)) {
          nextActivities.push(activity(workspaceId, timestamp, 'human', 'deleted', 'edge', `Deleted relationship “${edge.relation}”.`, edge.id))
        }

        const desiredHumanAnnotationIds = new Set(humanAnnotations.map((annotation) => annotation.id))
        for (const annotation of humanAnnotations) {
          const previous = currentHumanAnnotations.get(annotation.id)
          if (!previous) nextActivities.push(activity(workspaceId, timestamp, 'human', 'created', 'annotation', 'Added a human annotation.', annotation.id))
          else {
            const fields = changedFields(previous, annotation, ANNOTATION_DIFF_FIELDS)
            if (fields.length) nextActivities.push(activity(workspaceId, timestamp, 'human', 'updated', 'annotation', 'Updated a human annotation.', annotation.id, fields))
          }
        }
        for (const annotation of currentHumanAnnotations.values()) if (!desiredHumanAnnotationIds.has(annotation.id)) {
          nextActivities.push(activity(workspaceId, timestamp, 'human', 'deleted', 'annotation', 'Deleted a human annotation.', annotation.id))
        }

        const artifacts = current.artifacts.map((artifact) => {
          if (!artifact.nodeId || desiredNodeIds.has(artifact.nodeId)) return artifact
          nextActivities.push(activity(workspaceId, timestamp, 'system', 'updated', 'artifact', `Detached artifact “${artifact.originalName}” from a deleted node.`, artifact.id, ['nodeId']))
          return { ...artifact, nodeId: undefined, updatedAt: timestamp }
        })

        if (current.status === 'archived') {
          const restoringOnly = parsed.status === 'active'
            && nextActivities.length === 1
            && nextActivities[0].entityType === 'workspace'
            && nextActivities[0].changedFields.length === 1
            && nextActivities[0].changedFields[0] === 'status'
          if (nextActivities.length && !restoringOnly) {
            throw new WorkspaceStoreError(
              'WORKSPACE_ARCHIVED',
              'This workspace is archived and read-only. Restore it before changing its graph, projects, or annotations.',
            )
          }
        }

        if (!nextActivities.length) {
          result = current
          return
        }

        const next = workspaceSchema.parse({
          ...current,
          name: parsed.name,
          status: parsed.status,
          revision: current.revision + 1,
          projects,
          nodes,
          edges,
          artifacts,
          annotations: [...protectedAnnotations, ...humanAnnotations],
          activities: [...current.activities, ...nextActivities],
          updatedAt: timestamp,
        })
        this.replaceWorkspaceChildren(next)
        result = this.readWorkspaceSync(next.id)
      })
    })

    if (!result) throw new WorkspaceStoreError('MUTATION_FAILED', 'The human workspace transaction completed without a result.')
    return cloneWorkspace(result as WorkspaceState)
  }

  async replaceGraph(workspaceId: string, nodes: ClarityNode[], edges: ClarityEdge[]) {
    const current = await this.read(workspaceId)
    const nodeIds = new Set(nodes.map((node) => node.id))
    return this.saveHumanWorkspace(workspaceId, {
      expectedRevision: current.revision,
      name: current.name,
      status: current.status,
      projects: current.projects,
      nodes: nodes.map((node) => clarityNodeSchema.parse(node)),
      edges: edges.map((edge) => clarityEdgeSchema.parse(edge)),
      annotations: current.annotations.filter((annotation): annotation is typeof annotation & { author: 'human' } => annotation.author === 'human' && nodeIds.has(annotation.nodeId)),
    })
  }

  async deleteWorkspace(workspaceId: string, expectedRevision: number): Promise<DeleteWorkspaceResult> {
    await this.initialize()
    let result: DeleteWorkspaceResult | null = null
    const workspaceToken = storageWorkspaceToken(workspaceId)
    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        const current = this.readWorkspaceSync(workspaceId)
        if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 0) {
          throw new WorkspaceStoreError('INVALID_REVISION', 'A non-negative expected workspace revision is required.')
        }
        if (current.revision !== expectedRevision) {
          throw new WorkspaceStoreError('WORKSPACE_CONFLICT', `Workspace ${workspaceId} changed from revision ${expectedRevision} to ${current.revision}. Reload it before deleting.`)
        }
        const deletedAt = mutationTimestamp(current)
        this.requireDatabase().prepare(`
          INSERT INTO artifact_cleanup(workspace_token, requested_at)
          VALUES (?, ?)
          ON CONFLICT(workspace_token) DO UPDATE SET requested_at = excluded.requested_at
        `).run(workspaceToken, deletedAt)
        this.requireDatabase().prepare('DELETE FROM workspaces WHERE id = ?').run(workspaceId)
        result = { workspaceId, name: current.name, deleted: true, deletedAt }
      })
    })
    if (!result) throw new WorkspaceStoreError('DELETE_FAILED', `Workspace ${workspaceId} could not be deleted.`)
    try {
      await this.removeArtifactDirectory(cleanupArtifactDirectory(this.artifactDirectory, workspaceToken))
      await this.enqueueWrite(() => {
        this.withImmediateTransaction(() => {
          this.requireDatabase().prepare('DELETE FROM artifact_cleanup WHERE workspace_token = ?').run(workspaceToken)
        })
      })
    } catch (error) {
      throw new WorkspaceStoreError(
        'WORKSPACE_DELETED_ARTIFACT_CLEANUP_PENDING',
        `Workspace metadata was deleted, but its managed artifact bytes could not be removed. Restart Clarity to retry cleanup. ${error instanceof Error ? error.message : ''}`.trim(),
      )
    }
    return result
  }

  async importWorkspaceDocument(input: unknown): Promise<WorkspaceState> {
    await this.initialize()
    const document = clarityWorkspaceDocumentV1Schema.parse(input)
    const id = `workspace-${randomUUID()}`
    const importedAt = nowIso()
    const titles = new Set(document.nodes.map((node) => node.title))
    if (document.name === 'Clarity Workflows — Research Graph' && titles.has('Why We Sleep') && titles.has('Sleep Study 2024')) {
      throw new WorkspaceStoreError('DEMO_WORKSPACE_REJECTED', 'The bundled sleep-research demonstration workspace was not imported.')
    }

    const workspace = workspaceSchema.parse({
      version: 2,
      id,
      name: document.name,
      status: document.status,
      revision: 0,
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      projects: document.projects.map((project) => ({ ...project, workspaceId: id, createdAt: importedAt, updatedAt: importedAt })),
      nodes: document.nodes.map((node) => ({ ...node, origin: 'imported-unverified', createdAt: importedAt, updatedAt: importedAt })),
      edges: document.edges.map((edge) => ({ ...edge, createdAt: importedAt, updatedAt: importedAt })),
      artifacts: [],
      annotations: document.annotations.map((annotation) => {
        const createdAt = normalizedTimestamp(annotation.createdAt, importedAt)
        return {
          ...annotation,
          author: 'human' as const,
          origin: 'imported-unverified' as const,
          declaredAuthor: annotation.declaredAuthor ?? annotation.author,
          body: annotation.body,
          workspaceId: id,
          createdAt,
          updatedAt: normalizedTimestamp(annotation.updatedAt, createdAt),
        }
      }),
      workflowDefinitions: [],
      runs: [],
      gates: [],
      approvals: [],
      activities: [activity(id, importedAt, 'human', 'imported', 'workspace', `Imported portable workspace “${document.name}”.`, id)],
      createdAt: importedAt,
      updatedAt: importedAt,
    })

    let committed: WorkspaceState | null = null
    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        this.insertWorkspace(workspace)
        committed = this.readWorkspaceSync(workspace.id)
      })
    })
    if (!committed) throw new WorkspaceStoreError('IMPORT_FAILED', 'The portable workspace transaction completed without a result.')
    return cloneWorkspace(committed as WorkspaceState)
  }

  async importLegacyWorkspace(input: unknown, allowKnownDemo = false): Promise<WorkspaceState> {
    await this.initialize()
    const legacy = legacyWorkspaceV1Schema.parse(input)
    if (!allowKnownDemo && isKnownDemoWorkspace(legacy)) {
      throw new WorkspaceStoreError('DEMO_WORKSPACE_REJECTED', 'The bundled sleep-research demonstration workspace was not imported.')
    }

    const upgraded = workspaceSchema.parse(upgradeLegacyWorkspace(legacy))
    await this.enqueueWrite(() => {
      this.withImmediateTransaction(() => {
        if (this.workspaceExists(upgraded.id)) {
          throw new WorkspaceStoreError('WORKSPACE_EXISTS', `Workspace ${upgraded.id} already exists.`)
        }
        this.insertWorkspace(upgraded)
      })
    })
    return cloneWorkspace(upgraded)
  }

  async addArtifactFromFile(workspaceId: string, sourcePath: string, options: AddArtifactOptions = {}): Promise<ClarityArtifact> {
    await this.initialize()
    await this.read(workspaceId)
    const copied = await this.copyArtifactToManagedStorage(workspaceId, sourcePath, options)
    try {
      await this.mutate(workspaceId, (workspace) => {
        if (copied.artifact.nodeId && !workspace.nodes.some((node) => node.id === copied.artifact.nodeId)) {
          throw new WorkspaceStoreError('NODE_NOT_FOUND', `Node ${copied.artifact.nodeId} does not exist.`)
        }
        workspace.artifacts.push(copied.artifact)
        workspace.activities.push(activity(workspace.id, copied.artifact.createdAt, 'human', 'created', 'artifact', `Added artifact “${copied.artifact.originalName}”.`, copied.artifact.id))
      })
      return copied.artifact
    } catch (error) {
      await unlink(copied.destination).catch(() => undefined)
      throw error
    }
  }

  /** Ingests a real local file and its human-created source node in one Core
   * mutation. The managed bytes are copied before the metadata transaction;
   * any failed transaction removes the destination and leaves no graph node. */
  async ingestFileAsNode(workspaceId: string, sourcePath: string, options: IngestFileAsNodeOptions): Promise<WorkspaceState> {
    await this.initialize()
    const current = await this.read(workspaceId)
    if (current.status === 'archived') throw new WorkspaceStoreError('WORKSPACE_ARCHIVED', 'Archived workspaces are restore-only.')
    if (current.nodes.length >= 5_000) throw new WorkspaceStoreError('NODE_LIMIT_REACHED', 'The workspace has reached the 5,000 work-item limit.')
    const parsedNode = clarityNodeSchema.parse({ ...options.node, origin: 'human' })
    if (!HUMAN_NODE_KINDS.has(parsedNode.kind)) throw new WorkspaceStoreError('HUMAN_NODE_KIND_REQUIRED', `The human ingestion boundary cannot create workflow-managed kind ${parsedNode.kind}.`)
    if (current.nodes.some((node) => node.id === parsedNode.id)) throw new WorkspaceStoreError('NODE_EXISTS', `Node ${parsedNode.id} already exists.`)
    const copied = await this.copyArtifactToManagedStorage(workspaceId, sourcePath, {
      nodeId: parsedNode.id,
      originalName: options.originalName,
      mimeType: options.mimeType,
    })
    try {
      const bytes = copied.artifact.sizeBytes <= MAX_EXTRACTABLE_SOURCE_BYTES
        ? new Uint8Array(await readFile(copied.destination))
        : new Uint8Array()
      const extracted = extractManagedIngestionContent(copied.artifact.originalName, copied.artifact.mimeType, copied.artifact.sizeBytes, bytes)
      const timestamp = nowIso()
      const artifact = clarityArtifactSchema.parse({
        ...copied.artifact,
        extractionStatus: extracted.status,
        extractionFormat: extracted.status === 'extracted' ? extracted.format : undefined,
        extractedText: extracted.status === 'extracted' ? extracted.text : undefined,
        extractedByteCount: extracted.status === 'extracted' ? copied.artifact.sizeBytes : undefined,
        extractedCharacterCount: extracted.status === 'extracted' ? extracted.characterCount : undefined,
        extractedLineCount: extracted.status === 'extracted' ? extracted.lineCount : undefined,
        extractedAt: timestamp,
        extractionError: extracted.status === 'extracted' ? undefined : extracted.error,
        updatedAt: timestamp,
      })
      const node = clarityNodeSchema.parse({
        ...parsedNode,
        sourceUri: parsedNode.sourceUri ?? `clarity://artifact/${artifact.id}`,
        provenance: parsedNode.provenance || `Ingested from the operator-selected file “${artifact.originalName}”.`,
        updatedAt: timestamp,
        createdAt: parsedNode.createdAt ?? timestamp,
      })
      let result: WorkspaceState | null = null
      await this.enqueueWrite(() => {
        this.withImmediateTransaction(() => {
          const latest = this.readWorkspaceSync(workspaceId)
          if (latest.revision !== current.revision) throw new WorkspaceStoreError('WORKSPACE_CONFLICT', 'The workspace changed while the file was being copied. Refresh before ingesting again.')
          latest.nodes.push(node)
          latest.artifacts.push(artifact)
          latest.activities.push(activity(workspaceId, timestamp, 'human', 'created', 'node', `Created “${node.title}” from “${artifact.originalName}”.`, node.id, ['sourceUri']))
          latest.activities.push(activity(workspaceId, timestamp, 'system', 'updated', 'artifact', extracted.status === 'extracted' ? `Extracted ${artifact.extractedCharacterCount ?? 0} characters from “${artifact.originalName}”.` : `Stored “${artifact.originalName}” without extracted content: ${artifact.extractionError ?? 'unsupported format'}.`, artifact.id, ['extractionStatus']))
          const validated = workspaceSchema.parse({ ...latest, revision: latest.revision + 1, updatedAt: timestamp })
          this.replaceWorkspaceChildren(validated)
          result = this.readWorkspaceSync(workspaceId)
        })
      })
      if (!result) throw new WorkspaceStoreError('INGESTION_FAILED', 'The file was copied but the Core transaction returned no workspace.')
      return cloneWorkspace(result)
    } catch (error) {
      await unlink(copied.destination).catch(() => undefined)
      throw error
    }
  }

  async retryArtifactExtraction(workspaceId: string, artifactId: string): Promise<ClarityArtifact> {
    await this.initialize()
    const workspace = await this.read(workspaceId)
    const artifact = workspace.artifacts.find((item) => item.id === artifactId)
    if (!artifact) throw new WorkspaceStoreError('ARTIFACT_NOT_FOUND', `Artifact ${artifactId} was not found.`)
    if (workspace.status === 'archived') throw new WorkspaceStoreError('WORKSPACE_ARCHIVED', 'Archived workspaces are restore-only.')
    const filePath = this.resolveArtifactPath(artifact)
    const fileStats = await stat(filePath)
    if (!fileStats.isFile() || fileStats.size !== artifact.sizeBytes) {
      throw new WorkspaceStoreError('ARTIFACT_INTEGRITY_MISMATCH', `Managed bytes for “${artifact.originalName}” no longer match their recorded size; extraction was not attempted.`)
    }
    let bytes = new Uint8Array()
    const digest = createHash('sha256')
    if (artifact.sizeBytes <= MAX_EXTRACTABLE_SOURCE_BYTES) {
      bytes = new Uint8Array(await readFile(filePath))
      digest.update(bytes)
    } else {
      for await (const chunk of createReadStream(filePath)) digest.update(chunk)
    }
    if (digest.digest('hex') !== artifact.sha256) {
      throw new WorkspaceStoreError('ARTIFACT_INTEGRITY_MISMATCH', `Managed bytes for “${artifact.originalName}” no longer match their recorded digest; extraction was not attempted.`)
    }
    const extracted = extractManagedIngestionContent(artifact.originalName, artifact.mimeType, artifact.sizeBytes, bytes)
    const timestamp = nowIso()
    let updated: ClarityArtifact | undefined
    await this.mutate(workspaceId, (next) => {
      const target = next.artifacts.find((item) => item.id === artifactId)
      if (!target) throw new WorkspaceStoreError('ARTIFACT_NOT_FOUND', `Artifact ${artifactId} was not found.`)
      Object.assign(target, {
        extractionStatus: extracted.status,
        extractionFormat: extracted.status === 'extracted' ? extracted.format : undefined,
        extractedText: extracted.status === 'extracted' ? extracted.text : undefined,
        extractedByteCount: extracted.status === 'extracted' ? target.sizeBytes : undefined,
        extractedCharacterCount: extracted.status === 'extracted' ? extracted.characterCount : undefined,
        extractedLineCount: extracted.status === 'extracted' ? extracted.lineCount : undefined,
        extractedAt: timestamp,
        extractionError: extracted.status === 'extracted' ? undefined : extracted.error,
        updatedAt: timestamp,
      })
      updated = target
      next.activities.push(activity(workspaceId, timestamp, 'system', 'updated', 'artifact', extracted.status === 'extracted' ? `Retried extraction for “${target.originalName}”.` : `Extraction retry did not produce readable content for “${target.originalName}”.`, artifactId, ['extractionStatus']))
    })
    if (!updated) throw new WorkspaceStoreError('EXTRACTION_FAILED', 'The extraction transaction returned no artifact.')
    return structuredClone(updated)
  }

  private async copyArtifactToManagedStorage(workspaceId: string, sourcePath: string, options: AddArtifactOptions) {
    const source = path.resolve(sourcePath)
    const sourceStats = await stat(source)
    if (!sourceStats.isFile()) throw new WorkspaceStoreError('ARTIFACT_NOT_FILE', 'Only regular files can enter managed artifact storage.')
    if (sourceStats.size > MAX_ARTIFACT_BYTES) throw new WorkspaceStoreError('ARTIFACT_TOO_LARGE', `Artifacts may not exceed ${MAX_ARTIFACT_BYTES} bytes.`)
    const requestedName = options.originalName ?? path.basename(source)
    const id = `artifact-${randomUUID()}`
    const workspaceDirectory = storageWorkspaceToken(workspaceId)
    const extension = safeArtifactExtension(requestedName.trim())
    const storageKey = `${workspaceDirectory}/${id}${extension}`
    const timestamp = nowIso()
    const destinationDirectory = path.join(this.artifactDirectory, workspaceDirectory)
    const destination = path.join(this.artifactDirectory, storageKey)
    const temporary = `${destination}.pending-${randomUUID()}`
    await mkdir(destinationDirectory, { recursive: true, mode: 0o700 })
    const digest = createHash('sha256')
    let copiedBytes = 0
    const hashingTransform = new Transform({
      transform(chunk, _encoding, callback) {
        copiedBytes += Buffer.isBuffer(chunk) ? chunk.length : Buffer.byteLength(chunk)
        if (copiedBytes > MAX_ARTIFACT_BYTES) {
          callback(new WorkspaceStoreError('ARTIFACT_TOO_LARGE', `Artifacts may not exceed ${MAX_ARTIFACT_BYTES} bytes.`))
          return
        }
        digest.update(chunk)
        callback(null, chunk)
      },
    })
    try {
      await pipeline(createReadStream(source), hashingTransform, createWriteStream(temporary, { flags: 'wx', mode: 0o600 }))
      const copiedStats = await stat(temporary)
      if (!copiedStats.isFile() || copiedStats.size !== copiedBytes) throw new WorkspaceStoreError('ARTIFACT_SIZE_MISMATCH', 'The managed artifact byte count changed during ingestion; no metadata was committed.')
      await rename(temporary, destination)
      const artifact = clarityArtifactSchema.parse({
        id,
        workspaceId,
        nodeId: options.nodeId,
        originalName: requestedName,
        storageKey,
        mimeType: options.mimeType ?? 'application/octet-stream',
        sizeBytes: copiedBytes,
        sha256: digest.digest('hex'),
        status: 'stored',
        extractionStatus: 'pending',
        createdAt: timestamp,
        updatedAt: timestamp,
      })
      return { artifact, destination }
    } catch (error) {
      await unlink(temporary).catch(() => undefined)
      await unlink(destination).catch(() => undefined)
      throw error
    }
  }

  resolveArtifactPath(artifact: Pick<ClarityArtifact, 'storageKey'>) {
    const root = path.resolve(this.artifactDirectory)
    const resolved = path.resolve(root, artifact.storageKey)
    if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
      throw new WorkspaceStoreError('INVALID_STORAGE_KEY', 'Artifact storage key escapes the managed directory.')
    }
    return resolved
  }

  /** Verify managed bytes before a persisted extraction is exposed to MCP. */
  async assertArtifactIntegrity(workspaceId: string, artifactId: string): Promise<ClarityArtifact> {
    await this.initialize()
    const workspace = await this.read(workspaceId)
    const artifact = workspace.artifacts.find((candidate) => candidate.id === artifactId)
    if (!artifact) throw new WorkspaceStoreError('ARTIFACT_NOT_FOUND', `Artifact ${artifactId} was not found.`)
    await this.verifyManagedArtifactIntegrity(artifact)
    return artifact
  }

  private async verifyManagedArtifactIntegrity(artifact: ClarityArtifact) {
    const filePath = this.resolveArtifactPath(artifact)
    let fileStats: Awaited<ReturnType<typeof stat>>
    try {
      fileStats = await stat(filePath)
    } catch {
      throw new WorkspaceStoreError('ARTIFACT_INTEGRITY_MISMATCH', `Managed bytes for “${artifact.originalName}” are missing; readable content was withheld.`)
    }
    if (!fileStats.isFile() || fileStats.size !== artifact.sizeBytes) {
      throw new WorkspaceStoreError('ARTIFACT_INTEGRITY_MISMATCH', `Managed bytes for “${artifact.originalName}” no longer match their recorded size; readable content was withheld.`)
    }
    const digest = createHash('sha256')
    let byteCount = 0
    try {
      for await (const chunk of createReadStream(filePath)) {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
        byteCount += bytes.length
        digest.update(bytes)
      }
    } catch {
      throw new WorkspaceStoreError('ARTIFACT_INTEGRITY_MISMATCH', `Managed bytes for “${artifact.originalName}” could not be verified; readable content was withheld.`)
    }
    if (byteCount !== artifact.sizeBytes || digest.digest('hex') !== artifact.sha256) {
      throw new WorkspaceStoreError('ARTIFACT_INTEGRITY_MISMATCH', `Managed bytes for “${artifact.originalName}” no longer match their recorded digest; readable content was withheld.`)
    }
  }

  private async initializeOnce() {
    await mkdir(path.dirname(this.databasePath), { recursive: true, mode: 0o700 })
    await mkdir(this.artifactDirectory, { recursive: true, mode: 0o700 })
    try {
      await this.openAndMigrateWithRetry()
    } catch (error) {
      this.database?.close()
      this.database = null
      if (error instanceof WorkspaceStoreError && error.code === 'DATABASE_TOO_NEW') throw error
      if (!isRecoverableDatabaseCorruption(error)) throw error
      await this.preserveCorruptDatabase()
      await this.openAndMigrateWithRetry()
    }
    await chmod(this.databasePath, 0o600).catch(() => undefined)
    await this.cleanupPendingArtifactDirectories()
    await this.importLegacyFilesIfEmpty()
  }

  private async openAndMigrateWithRetry() {
    const deadline = Date.now() + 10_000
    let delayMs = 10
    while (true) {
      try {
        this.openAndMigrate()
        return
      } catch (error) {
        this.database?.close()
        this.database = null
        if (!isTransientDatabaseLock(error) || Date.now() >= deadline) throw error
        await new Promise<void>((resolve) => setTimeout(resolve, delayMs))
        delayMs = Math.min(delayMs * 2, 250)
      }
    }
  }

  private async cleanupPendingArtifactDirectories() {
    const rows = this.requireDatabase().prepare('SELECT workspace_token FROM artifact_cleanup ORDER BY requested_at').all() as SqlRow[]
    const activeTokens = new Set((this.requireDatabase().prepare('SELECT id FROM workspaces').all() as SqlRow[])
      .map((row) => storageWorkspaceToken(String(row.id))))
    for (const row of rows) {
      const workspaceToken = String(row.workspace_token)
      if (activeTokens.has(workspaceToken)) {
        throw new WorkspaceStoreError('ARTIFACT_CLEANUP_IDENTITY_CONFLICT', 'A pending artifact cleanup token now belongs to an active workspace; no bytes were removed.')
      }
      const targetDirectory = cleanupArtifactDirectory(this.artifactDirectory, workspaceToken)
      try {
        await this.removeArtifactDirectory(targetDirectory)
        this.withImmediateTransaction(() => {
          this.requireDatabase().prepare('DELETE FROM artifact_cleanup WHERE workspace_token = ?').run(workspaceToken)
        })
      } catch (error) {
        throw new WorkspaceStoreError(
          'ARTIFACT_CLEANUP_FAILED',
          `Clarity could not finish removing managed artifact bytes for a deleted workspace. Restart Clarity to retry cleanup. ${error instanceof Error ? error.message : ''}`.trim(),
        )
      }
    }
  }

  private openAndMigrate() {
    this.database = new DatabaseSync(this.databasePath, {
      enableForeignKeyConstraints: true,
      enableDoubleQuotedStringLiterals: false,
    })
    const database = this.requireDatabase()
    // Install the lock wait before WAL/schema negotiation so simultaneous
    // first-launch desktop and MCP processes do not fail at journal setup.
    database.exec('PRAGMA busy_timeout = 5000')
    database.exec('PRAGMA journal_mode = WAL')
    database.exec('PRAGMA synchronous = FULL')
    database.exec('PRAGMA foreign_keys = ON')
    const quickCheck = database.prepare('PRAGMA quick_check(1)').get() as SqlRow
    if (String(quickCheck.quick_check) !== 'ok') {
      throw new WorkspaceStoreError('DATABASE_CORRUPT', `SQLite integrity check failed: ${String(quickCheck.quick_check)}`)
    }
    database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      );
    `)
    const current = database.prepare('SELECT COALESCE(MAX(version), 0) AS version FROM schema_migrations').get() as SqlRow
    const currentVersion = Number(current.version)
    if (currentVersion > CLARITY_DATABASE_SCHEMA_VERSION) {
      throw new WorkspaceStoreError('DATABASE_TOO_NEW', `This Clarity database uses schema ${currentVersion}; this build supports ${CLARITY_DATABASE_SCHEMA_VERSION}.`)
    }
    if (currentVersion < 1) this.applyMigrationOne()
    if (currentVersion < 2) this.applyMigrationTwo()
    if (currentVersion < 3) this.applyMigrationThree()
    if (currentVersion < 4) this.applyMigrationFour()
    if (currentVersion < 5) this.applyMigrationFive()
    if (currentVersion < 6) this.applyMigrationSix()
  }

  private applyMigrationOne() {
    this.withImmediateTransaction(() => {
      const applied = this.requireDatabase().prepare('SELECT 1 AS present FROM schema_migrations WHERE version >= 1 LIMIT 1').get()
      if (applied) return
      this.requireDatabase().exec(`
        CREATE TABLE workspaces (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );

        CREATE TABLE projects (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE nodes (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          project_id TEXT,
          kind TEXT NOT NULL,
          title TEXT NOT NULL,
          description TEXT NOT NULL,
          schema_type TEXT NOT NULL,
          status TEXT NOT NULL,
          tags_json TEXT NOT NULL,
          provenance TEXT NOT NULL,
          position_x REAL NOT NULL,
          position_y REAL NOT NULL,
          human_annotation TEXT,
          ai_annotation TEXT,
          priority TEXT,
          evidence_count INTEGER,
          pinned INTEGER,
          source_uri TEXT,
          instruction TEXT,
          agent_mode TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE NO ACTION
        );

        CREATE TABLE edges (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          project_id TEXT,
          source_id TEXT NOT NULL,
          target_id TEXT NOT NULL,
          relation TEXT NOT NULL,
          color TEXT,
          dashed INTEGER,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, source_id) REFERENCES nodes(workspace_id, id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, target_id) REFERENCES nodes(workspace_id, id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE NO ACTION
        );

        CREATE TABLE artifacts (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          node_id TEXT,
          original_name TEXT NOT NULL,
          storage_key TEXT NOT NULL UNIQUE,
          mime_type TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          sha256 TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, node_id) REFERENCES nodes(workspace_id, id) ON DELETE NO ACTION
        );

        CREATE TABLE annotations (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          node_id TEXT NOT NULL,
          author TEXT NOT NULL,
          body TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, node_id) REFERENCES nodes(workspace_id, id) ON DELETE CASCADE
        );

        CREATE TABLE workflow_definitions (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          project_id TEXT,
          name TEXT NOT NULL,
          revision INTEGER NOT NULL,
          status TEXT NOT NULL,
          specification_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE NO ACTION
        );

        CREATE TABLE workflow_runs (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          project_id TEXT,
          context_id TEXT NOT NULL,
          intent TEXT NOT NULL,
          source_node_ids_json TEXT NOT NULL,
          status TEXT NOT NULL,
          pre_gate_json TEXT NOT NULL,
          post_gate_json TEXT NOT NULL,
          candidate_json TEXT NOT NULL,
          committed_node_id TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, project_id) REFERENCES projects(workspace_id, id) ON DELETE NO ACTION
        );

        CREATE TABLE gate_definitions (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          name TEXT NOT NULL,
          kind TEXT NOT NULL,
          enabled INTEGER NOT NULL,
          rules_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE approvals (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          run_id TEXT NOT NULL,
          status TEXT NOT NULL,
          decided_by TEXT,
          decided_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE,
          FOREIGN KEY (workspace_id, run_id) REFERENCES workflow_runs(workspace_id, id) ON DELETE CASCADE
        );

        CREATE TABLE legacy_imports (
          source_path TEXT PRIMARY KEY,
          sha256 TEXT NOT NULL,
          status TEXT NOT NULL,
          detail TEXT,
          imported_at TEXT NOT NULL
        );

        CREATE INDEX idx_nodes_workspace_updated ON nodes(workspace_id, updated_at);
        CREATE INDEX idx_edges_workspace ON edges(workspace_id);
        CREATE INDEX idx_artifacts_sha256 ON artifacts(workspace_id, sha256);
        CREATE INDEX idx_runs_workspace_updated ON workflow_runs(workspace_id, updated_at);
      `)
      this.requireDatabase().prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(1, nowIso())
    })
  }

  private applyMigrationTwo() {
    this.withImmediateTransaction(() => {
      const applied = this.requireDatabase().prepare('SELECT 1 AS present FROM schema_migrations WHERE version >= 2 LIMIT 1').get()
      if (applied) return
      this.requireDatabase().exec(`
        ALTER TABLE workspaces ADD COLUMN status TEXT NOT NULL DEFAULT 'active';
        ALTER TABLE workspaces ADD COLUMN revision INTEGER NOT NULL DEFAULT 0;

        CREATE TABLE activities (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          actor TEXT NOT NULL,
          action TEXT NOT NULL,
          entity_type TEXT NOT NULL,
          entity_id TEXT,
          summary TEXT NOT NULL,
          changed_fields_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE INDEX idx_activities_workspace_created ON activities(workspace_id, created_at, id);
      `)
      this.requireDatabase().prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(2, nowIso())
    })
  }

  private applyMigrationThree() {
    this.withImmediateTransaction(() => {
      const applied = this.requireDatabase().prepare('SELECT 1 AS present FROM schema_migrations WHERE version >= 3 LIMIT 1').get()
      if (applied) return
      this.requireDatabase().exec(`
        ALTER TABLE nodes ADD COLUMN origin TEXT NOT NULL DEFAULT 'human';
        ALTER TABLE annotations ADD COLUMN origin TEXT NOT NULL DEFAULT 'local';
        ALTER TABLE annotations ADD COLUMN declared_author TEXT;
        ALTER TABLE workflow_runs ADD COLUMN evidence_revision INTEGER;
        UPDATE nodes
        SET origin = 'approved-ai'
        WHERE EXISTS (
          SELECT 1 FROM workflow_runs r
          WHERE r.workspace_id = nodes.workspace_id
            AND r.committed_node_id = nodes.id
            AND r.status = 'committed'
        );
      `)
      const migrationTimestamp = nowIso()
      const pendingRuns = this.requireDatabase().prepare(`
        SELECT workspace_id, id, created_at
        FROM workflow_runs
        WHERE status = 'awaiting_approval'
      `).all() as SqlRow[]
      const changedWorkspaces = new Set<string>()
      for (const row of pendingRuns) {
        const workspaceId = String(row.workspace_id)
        const runId = String(row.id)
        const approvalCreatedAt = String(row.created_at)
        this.requireDatabase().prepare(`
          UPDATE workflow_runs
          SET status = 'rejected', updated_at = ?
          WHERE workspace_id = ? AND id = ?
        `).run(migrationTimestamp, workspaceId, runId)
        this.requireDatabase().prepare('DELETE FROM approvals WHERE workspace_id = ? AND run_id = ?').run(workspaceId, runId)
        this.requireDatabase().prepare(`
          INSERT INTO approvals(workspace_id,id,run_id,status,decided_by,decided_at,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?)
        `).run(
          workspaceId,
          `approval-${createHash('sha256').update(`${workspaceId}\u0000${runId}`).digest('hex').slice(0, 32)}`,
          runId,
          'rejected',
          'migration-unverified',
          migrationTimestamp,
          approvalCreatedAt,
          migrationTimestamp,
        )
        this.requireDatabase().prepare(`
          INSERT INTO activities(workspace_id,id,actor,action,entity_type,entity_id,summary,changed_fields_json,created_at)
          VALUES (?,?,?,?,?,?,?,?,?)
        `).run(
          workspaceId,
          `activity-${randomUUID()}`,
          'system',
          'rejected',
          'workflow-run',
          runId,
          'Closed a pre-Chunk-2 pending run because its evidence revision cannot be verified safely.',
          '["status"]',
          migrationTimestamp,
        )
        changedWorkspaces.add(workspaceId)
      }
      for (const workspaceId of changedWorkspaces) {
        this.requireDatabase().prepare(`
          UPDATE workspaces
          SET revision = revision + 1, updated_at = ?
          WHERE id = ?
        `).run(migrationTimestamp, workspaceId)
      }
      this.requireDatabase().prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(3, nowIso())
    })
  }

  private applyMigrationFour() {
    this.withImmediateTransaction(() => {
      const applied = this.requireDatabase().prepare('SELECT 1 AS present FROM schema_migrations WHERE version >= 4 LIMIT 1').get()
      if (applied) return
      this.requireDatabase().exec(`
        CREATE TABLE artifact_cleanup (
          workspace_token TEXT PRIMARY KEY
            CHECK (length(workspace_token) = 24 AND workspace_token NOT GLOB '*[^0-9a-f]*'),
          requested_at TEXT NOT NULL
        );
      `)
      this.requireDatabase().prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(4, nowIso())
    })
  }

  private applyMigrationFive() {
    this.withImmediateTransaction(() => {
      const applied = this.requireDatabase().prepare('SELECT 1 AS present FROM schema_migrations WHERE version >= 5 LIMIT 1').get()
      if (applied) return
      this.requireDatabase().exec(`
        ALTER TABLE artifacts ADD COLUMN extraction_status TEXT NOT NULL DEFAULT 'pending';
        ALTER TABLE artifacts ADD COLUMN extraction_format TEXT;
        ALTER TABLE artifacts ADD COLUMN extracted_text TEXT;
        ALTER TABLE artifacts ADD COLUMN extracted_byte_count INTEGER;
        ALTER TABLE artifacts ADD COLUMN extracted_character_count INTEGER;
        ALTER TABLE artifacts ADD COLUMN extracted_line_count INTEGER;
        ALTER TABLE artifacts ADD COLUMN extracted_at TEXT;
        ALTER TABLE artifacts ADD COLUMN extraction_error TEXT;
      `)
      this.requireDatabase().prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(5, nowIso())
    })
  }

  private applyMigrationSix() {
    this.withImmediateTransaction(() => {
      const applied = this.requireDatabase().prepare('SELECT 1 AS present FROM schema_migrations WHERE version >= 6 LIMIT 1').get()
      if (applied) return
      this.requireDatabase().exec(`
        CREATE TABLE search_index_state (
          workspace_id TEXT PRIMARY KEY,
          status TEXT NOT NULL CHECK (status IN ('unbuilt', 'dirty', 'building', 'ready', 'failed')),
          indexed_revision INTEGER NOT NULL CHECK (indexed_revision >= 0),
          generation INTEGER NOT NULL CHECK (generation >= 0),
          document_count INTEGER NOT NULL CHECK (document_count >= 0),
          chunk_count INTEGER NOT NULL CHECK (chunk_count >= 0),
          rebuild_requested_at TEXT,
          last_indexed_at TEXT,
          last_error TEXT,
          updated_at TEXT NOT NULL,
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE search_documents (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          source_kind TEXT NOT NULL CHECK (source_kind IN ('node', 'annotation', 'artifact')),
          source_id TEXT NOT NULL,
          title TEXT NOT NULL CHECK (length(title) > 0 AND length(title) <= 500),
          source_uri TEXT,
          content_hash TEXT NOT NULL CHECK (length(content_hash) = 64 AND content_hash NOT GLOB '*[^0-9a-f]*'),
          source_sha256 TEXT CHECK (source_sha256 IS NULL OR (length(source_sha256) = 64 AND source_sha256 NOT GLOB '*[^0-9a-f]*')),
          workspace_revision INTEGER NOT NULL CHECK (workspace_revision >= 0),
          extraction_status TEXT CHECK (extraction_status IS NULL OR extraction_status IN ('pending', 'extracted', 'unsupported', 'failed')),
          extraction_format TEXT,
          trust_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          UNIQUE (workspace_id, source_kind, source_id),
          FOREIGN KEY (workspace_id) REFERENCES workspaces(id) ON DELETE CASCADE
        );

        CREATE TABLE search_chunks (
          workspace_id TEXT NOT NULL,
          id TEXT NOT NULL,
          document_id TEXT NOT NULL,
          sequence INTEGER NOT NULL CHECK (sequence >= 0),
          text TEXT NOT NULL CHECK (length(text) <= 16000 AND length(CAST(text AS BLOB)) <= 64000),
          character_count INTEGER NOT NULL CHECK (character_count >= 0 AND character_count <= 16000),
          byte_count INTEGER NOT NULL CHECK (byte_count >= 0 AND byte_count <= 64000),
          provenance_json TEXT NOT NULL,
          trust_json TEXT NOT NULL,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          PRIMARY KEY (workspace_id, id),
          UNIQUE (workspace_id, document_id, sequence),
          FOREIGN KEY (workspace_id, document_id) REFERENCES search_documents(workspace_id, id) ON DELETE CASCADE
        );

        CREATE INDEX idx_search_documents_workspace_source ON search_documents(workspace_id, source_kind, source_id);
        CREATE INDEX idx_search_documents_workspace_revision ON search_documents(workspace_id, workspace_revision);
        CREATE INDEX idx_search_chunks_workspace_document_sequence ON search_chunks(workspace_id, document_id, sequence);

        INSERT INTO search_index_state(
          workspace_id,status,indexed_revision,generation,document_count,chunk_count,
          rebuild_requested_at,last_indexed_at,last_error,updated_at
        )
        SELECT id,'unbuilt',0,0,0,0,NULL,NULL,NULL,updated_at FROM workspaces;
      `)
      this.requireDatabase().prepare('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)')
        .run(6, nowIso())
    })
  }

  private async preserveCorruptDatabase() {
    const backup = `${this.databasePath}.corrupt-${safeTimestamp()}`
    // A same-directory rename is atomic. If it fails, initialization fails and
    // the sole copy is left untouched rather than being deleted optimistically.
    await rename(this.databasePath, backup)
    await rename(`${this.databasePath}-wal`, `${backup}-wal`).catch(() => undefined)
    await rename(`${this.databasePath}-shm`, `${backup}-shm`).catch(() => undefined)
  }

  private async importLegacyFilesIfEmpty() {
    if (this.latestWorkspaceId()) return
    for (const sourcePath of this.legacyJsonPaths) {
      let raw: string
      try {
        raw = await readFile(sourcePath, 'utf8')
      } catch {
        continue
      }
      const sha256 = createHash('sha256').update(raw).digest('hex')
      const already = this.requireDatabase().prepare('SELECT sha256, status FROM legacy_imports WHERE source_path = ?').get(sourcePath) as SqlRow | undefined
      if (already && (String(already.sha256) === sha256 || String(already.status) === 'imported')) continue
      try {
        const legacy = legacyWorkspaceV1Schema.parse(JSON.parse(raw) as unknown)
        if (isKnownDemoWorkspace(legacy)) {
          this.recordLegacyImport(sourcePath, sha256, 'skipped_demo', 'Bundled demonstration data is never imported into a real workspace.')
          continue
        }
        const upgraded = workspaceSchema.parse(upgradeLegacyWorkspace(legacy))
        this.withImmediateTransaction(() => {
          this.insertWorkspace(upgraded)
          this.recordLegacyImport(sourcePath, sha256, 'imported', upgraded.id)
        })
        return
      } catch (error) {
        this.recordLegacyImport(sourcePath, sha256, 'invalid', error instanceof Error ? error.message.slice(0, 1_000) : 'Unknown import error')
      }
    }
  }

  private recordLegacyImport(sourcePath: string, sha256: string, status: string, detail: string) {
    this.requireDatabase().prepare(`
      INSERT OR REPLACE INTO legacy_imports(source_path, sha256, status, detail, imported_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(sourcePath, sha256, status, detail, nowIso())
  }

  private latestWorkspaceId() {
    const row = this.requireDatabase().prepare('SELECT id FROM workspaces ORDER BY updated_at DESC LIMIT 1').get() as SqlRow | undefined
    return row ? String(row.id) : null
  }

  private workspaceExists(workspaceId: string) {
    return Boolean(this.requireDatabase().prepare('SELECT 1 AS present FROM workspaces WHERE id = ?').get(workspaceId))
  }

  private readSearchIndexStateSync(workspaceId: string): SearchIndexState {
    const row = this.requireDatabase().prepare('SELECT * FROM search_index_state WHERE workspace_id = ?').get(workspaceId) as SqlRow | undefined
    if (!row) {
      if (!this.workspaceExists(workspaceId)) throw new WorkspaceStoreError('WORKSPACE_NOT_FOUND', `Workspace ${workspaceId} was not found.`)
      throw new WorkspaceStoreError('SEARCH_INDEX_UNAVAILABLE', `Search index state for workspace ${workspaceId} is unavailable.`)
    }
    try {
      return searchIndexStateSchema.parse({
        workspaceId: String(row.workspace_id),
        status: String(row.status),
        indexedRevision: Number(row.indexed_revision),
        generation: Number(row.generation),
        documentCount: Number(row.document_count),
        chunkCount: Number(row.chunk_count),
        rebuildRequestedAt: optionalString(row.rebuild_requested_at as string | null),
        lastIndexedAt: optionalString(row.last_indexed_at as string | null),
        lastError: optionalString(row.last_error as string | null),
        updatedAt: String(row.updated_at),
      })
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw error
      throw new WorkspaceStoreError('SEARCH_INDEX_CORRUPT', `Search index state for workspace ${workspaceId} is invalid. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  private readSearchIndexSync(workspaceId: string): SearchIndexSnapshot {
    const state = this.readSearchIndexStateSync(workspaceId)
    const database = this.requireDatabase()
    try {
      const documents = (database.prepare('SELECT * FROM search_documents WHERE workspace_id = ? ORDER BY source_kind, source_id').all(workspaceId) as SqlRow[])
        .map((row): SearchIndexDocument => searchIndexDocumentSchema.parse({
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          sourceKind: String(row.source_kind),
          sourceId: String(row.source_id),
          title: String(row.title),
          sourceUri: optionalString(row.source_uri as string | null),
          contentHash: String(row.content_hash),
          sourceSha256: optionalString(row.source_sha256 as string | null),
          workspaceRevision: Number(row.workspace_revision),
          extractionStatus: optionalString(row.extraction_status as string | null),
          extractionFormat: optionalString(row.extraction_format as string | null),
          trust: JSON.parse(String(row.trust_json)),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }))
      const chunks = (database.prepare('SELECT * FROM search_chunks WHERE workspace_id = ? ORDER BY document_id, sequence').all(workspaceId) as SqlRow[])
        .map((row): SearchIndexChunk => searchIndexChunkSchema.parse({
          id: String(row.id),
          workspaceId: String(row.workspace_id),
          documentId: String(row.document_id),
          sequence: Number(row.sequence),
          text: String(row.text),
          characterCount: Number(row.character_count),
          byteCount: Number(row.byte_count),
          provenance: JSON.parse(String(row.provenance_json)),
          trust: JSON.parse(String(row.trust_json)),
          createdAt: String(row.created_at),
          updatedAt: String(row.updated_at),
        }))
      const validated = derivedSearchIndexInputSchema.parse({
        expectedWorkspaceRevision: state.indexedRevision,
        documents,
        chunks,
      })
      if (state.documentCount !== documents.length || state.chunkCount !== chunks.length) {
        throw new WorkspaceStoreError('SEARCH_INDEX_CORRUPT', `Search index counts for workspace ${workspaceId} do not match its rows.`)
      }
      return { state, documents: validated.documents, chunks: validated.chunks }
    } catch (error) {
      if (error instanceof WorkspaceStoreError) throw error
      throw new WorkspaceStoreError('SEARCH_INDEX_CORRUPT', `Search index rows for workspace ${workspaceId} are invalid. ${error instanceof Error ? error.message : ''}`.trim())
    }
  }

  private markSearchIndexDirtyInTransaction(workspaceId: string, timestamp: string, reason: string) {
    const state = this.requireDatabase().prepare('SELECT status FROM search_index_state WHERE workspace_id = ?').get(workspaceId) as SqlRow | undefined
    if (!state) throw new WorkspaceStoreError('SEARCH_INDEX_UNAVAILABLE', `Search index state for workspace ${workspaceId} is unavailable.`)
    const status = String(state.status) === 'unbuilt' ? 'unbuilt' : 'dirty'
    this.requireDatabase().prepare(`
      UPDATE search_index_state
      SET status = ?, rebuild_requested_at = ?, last_error = ?, updated_at = ?
      WHERE workspace_id = ?
    `).run(status, timestamp, reason.slice(0, SEARCH_INDEX_ERROR_MAX_CHARACTERS), timestamp, workspaceId)
  }

  private readWorkspaceSync(workspaceId: string): WorkspaceState {
    const database = this.requireDatabase()
    const workspaceRow = database.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId) as SqlRow | undefined
    if (!workspaceRow) throw new WorkspaceStoreError('WORKSPACE_NOT_FOUND', `Workspace ${workspaceId} was not found.`)

    const projects = (database.prepare('SELECT * FROM projects WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): ClarityProject => ({
        id: String(row.id), workspaceId, name: String(row.name), description: String(row.description),
        status: String(row.status) as ClarityProject['status'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const nodes = (database.prepare('SELECT * FROM nodes WHERE workspace_id = ? ORDER BY created_at, id').all(workspaceId) as SqlRow[])
      .map((row): ClarityNode => ({
        id: String(row.id), projectId: optionalString(row.project_id as string | null), origin: String(row.origin) as ClarityNode['origin'], kind: String(row.kind) as ClarityNode['kind'],
        title: String(row.title), description: String(row.description), schemaType: String(row.schema_type), status: String(row.status) as ClarityNode['status'],
        tags: parseJson(String(row.tags_json), []), provenance: String(row.provenance), position: { x: Number(row.position_x), y: Number(row.position_y) },
        humanAnnotation: optionalString(row.human_annotation as string | null), aiAnnotation: optionalString(row.ai_annotation as string | null),
        priority: optionalString(row.priority as string | null) as ClarityNode['priority'], evidenceCount: optionalNumber(row.evidence_count as number | null),
        pinned: asBoolean(row.pinned as number | null), sourceUri: optionalString(row.source_uri as string | null), instruction: optionalString(row.instruction as string | null),
        agentMode: optionalString(row.agent_mode as string | null) as ClarityNode['agentMode'], createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const edges = (database.prepare('SELECT * FROM edges WHERE workspace_id = ? ORDER BY created_at, id').all(workspaceId) as SqlRow[])
      .map((row): ClarityEdge => ({
        id: String(row.id), projectId: optionalString(row.project_id as string | null), source: String(row.source_id), target: String(row.target_id),
        relation: String(row.relation), color: optionalString(row.color as string | null), dashed: asBoolean(row.dashed as number | null),
        createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const artifacts = (database.prepare('SELECT * FROM artifacts WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): ClarityArtifact => ({
        id: String(row.id), workspaceId, nodeId: optionalString(row.node_id as string | null), originalName: String(row.original_name),
        storageKey: String(row.storage_key), mimeType: String(row.mime_type), sizeBytes: Number(row.size_bytes), sha256: String(row.sha256),
        status: String(row.status) as ClarityArtifact['status'], extractionStatus: String(row.extraction_status ?? 'pending') as ClarityArtifact['extractionStatus'],
        extractionFormat: optionalString(row.extraction_format as string | null) as ClarityArtifact['extractionFormat'], extractedText: optionalString(row.extracted_text as string | null),
        extractedByteCount: optionalNumber(row.extracted_byte_count as number | null), extractedCharacterCount: optionalNumber(row.extracted_character_count as number | null),
        extractedLineCount: optionalNumber(row.extracted_line_count as number | null), extractedAt: optionalString(row.extracted_at as string | null),
        extractionError: optionalString(row.extraction_error as string | null), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const annotations = (database.prepare('SELECT * FROM annotations WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): ClarityAnnotation => ({
        id: String(row.id), workspaceId, nodeId: String(row.node_id), author: String(row.author) as ClarityAnnotation['author'],
        origin: String(row.origin) as ClarityAnnotation['origin'], declaredAuthor: optionalString(row.declared_author as string | null) as ClarityAnnotation['declaredAuthor'],
        body: String(row.body), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const workflowDefinitions = (database.prepare('SELECT * FROM workflow_definitions WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): WorkflowDefinition => ({
        id: String(row.id), workspaceId, projectId: optionalString(row.project_id as string | null), name: String(row.name), revision: Number(row.revision),
        status: String(row.status) as WorkflowDefinition['status'], specification: parseJson(String(row.specification_json), {}),
        createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const runs = (database.prepare('SELECT * FROM workflow_runs WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): WorkflowRun => ({
        id: String(row.id), workspaceId, projectId: optionalString(row.project_id as string | null), contextId: String(row.context_id), intent: String(row.intent),
        sourceNodeIds: parseJson(String(row.source_node_ids_json), []), evidenceRevision: optionalNumber(row.evidence_revision as number | null), status: String(row.status) as WorkflowRun['status'],
        preGate: parseJson(String(row.pre_gate_json), { passed: false, issues: ['Unreadable pre-gate record.'] }),
        postGate: parseJson(String(row.post_gate_json), { passed: false, issues: ['Unreadable post-gate record.'] }),
        candidate: parseJson(String(row.candidate_json), {} as WorkflowRun['candidate']), committedNodeId: optionalString(row.committed_node_id as string | null),
        createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const gates = (database.prepare('SELECT * FROM gate_definitions WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): GateDefinition => ({
        id: String(row.id), workspaceId, name: String(row.name), kind: String(row.kind) as GateDefinition['kind'], enabled: row.enabled === 1,
        rules: parseJson(String(row.rules_json), {}), createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const approvals = (database.prepare('SELECT * FROM approvals WHERE workspace_id = ? ORDER BY created_at').all(workspaceId) as SqlRow[])
      .map((row): ApprovalRecord => ({
        id: String(row.id), workspaceId, runId: String(row.run_id), status: String(row.status) as ApprovalRecord['status'],
        decidedBy: optionalString(row.decided_by as string | null), decidedAt: optionalString(row.decided_at as string | null),
        createdAt: String(row.created_at), updatedAt: String(row.updated_at),
      }))
    const activities = (database.prepare('SELECT * FROM activities WHERE workspace_id = ? ORDER BY created_at, id').all(workspaceId) as SqlRow[])
      .map((row): ClarityActivity => ({
        id: String(row.id), workspaceId, actor: String(row.actor) as ClarityActivity['actor'],
        action: String(row.action) as ClarityActivity['action'], entityType: String(row.entity_type) as ClarityActivity['entityType'],
        entityId: optionalString(row.entity_id as string | null), summary: String(row.summary),
        changedFields: parseJson(String(row.changed_fields_json), []), createdAt: String(row.created_at),
      }))

    return workspaceSchema.parse({
      version: 2,
      id: workspaceId,
      name: String(workspaceRow.name),
      status: String(workspaceRow.status),
      revision: Number(workspaceRow.revision),
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      projects,
      nodes,
      edges,
      artifacts,
      annotations,
      workflowDefinitions,
      runs,
      gates,
      approvals,
      activities,
      createdAt: String(workspaceRow.created_at),
      updatedAt: String(workspaceRow.updated_at),
    })
  }

  private insertWorkspace(workspace: WorkspaceState) {
    const workspaceToken = storageWorkspaceToken(workspace.id)
    const pendingCleanup = this.requireDatabase().prepare('SELECT 1 AS present FROM artifact_cleanup WHERE workspace_token = ?').get(workspaceToken)
    if (pendingCleanup) {
      throw new WorkspaceStoreError('WORKSPACE_CLEANUP_PENDING', `Workspace identity ${workspace.id} cannot be reused until its managed artifact cleanup finishes.`)
    }
    this.requireDatabase().prepare('INSERT INTO workspaces(id, name, status, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(workspace.id, workspace.name, workspace.status, workspace.revision, workspace.createdAt, workspace.updatedAt)
    const indexState = createSearchIndexState(workspace.id, 'unbuilt', workspace.updatedAt)
    this.requireDatabase().prepare(`
      INSERT INTO search_index_state(
        workspace_id,status,indexed_revision,generation,document_count,chunk_count,
        rebuild_requested_at,last_indexed_at,last_error,updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?)
    `).run(
      indexState.workspaceId,
      indexState.status,
      indexState.indexedRevision,
      indexState.generation,
      indexState.documentCount,
      indexState.chunkCount,
      indexState.rebuildRequestedAt ?? null,
      indexState.lastIndexedAt ?? null,
      indexState.lastError ?? null,
      indexState.updatedAt,
    )
    this.insertWorkspaceChildren(workspace)
  }

  private replaceWorkspaceChildren(workspace: WorkspaceState, markSearchDirty = true) {
    const database = this.requireDatabase()
    database.prepare('UPDATE workspaces SET name = ?, status = ?, revision = ?, updated_at = ? WHERE id = ?')
      .run(workspace.name, workspace.status, workspace.revision, workspace.updatedAt, workspace.id)
    for (const table of ['activities', 'approvals', 'annotations', 'artifacts', 'edges', 'workflow_runs', 'workflow_definitions', 'gate_definitions', 'nodes', 'projects']) {
      database.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspace.id)
    }
    this.insertWorkspaceChildren(workspace, markSearchDirty)
  }

  private insertWorkspaceChildren(workspace: WorkspaceState, markSearchDirty = true) {
    const database = this.requireDatabase()
    const nodeInsert = database.prepare(`
      INSERT INTO nodes(workspace_id,id,project_id,origin,kind,title,description,schema_type,status,tags_json,provenance,position_x,position_y,human_annotation,ai_annotation,priority,evidence_count,pinned,source_uri,instruction,agent_mode,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `)
    const edgeInsert = database.prepare(`
      INSERT INTO edges(workspace_id,id,project_id,source_id,target_id,relation,color,dashed,created_at,updated_at)
      VALUES (?,?,?,?,?,?,?,?,?,?)
    `)
    for (const project of workspace.projects) {
      database.prepare('INSERT INTO projects(workspace_id,id,name,description,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?)')
        .run(workspace.id, project.id, project.name, project.description, project.status, project.createdAt, project.updatedAt)
    }
    for (const node of workspace.nodes) {
      const timestamp = node.createdAt ?? workspace.createdAt
      nodeInsert.run(workspace.id, node.id, node.projectId ?? null, node.origin ?? 'human', node.kind, node.title, node.description, node.schemaType, node.status,
        JSON.stringify(node.tags), node.provenance, node.position.x, node.position.y, node.humanAnnotation ?? null, node.aiAnnotation ?? null,
        node.priority ?? null, node.evidenceCount ?? null, node.pinned === undefined ? null : Number(node.pinned), node.sourceUri ?? null,
        node.instruction ?? null, node.agentMode ?? null, timestamp, node.updatedAt ?? workspace.updatedAt)
    }
    for (const edge of workspace.edges) {
      edgeInsert.run(workspace.id, edge.id, edge.projectId ?? null, edge.source, edge.target, edge.relation, edge.color ?? null,
        edge.dashed === undefined ? null : Number(edge.dashed), edge.createdAt ?? workspace.createdAt, edge.updatedAt ?? workspace.updatedAt)
    }
    for (const artifact of workspace.artifacts) {
      database.prepare(`INSERT INTO artifacts(workspace_id,id,node_id,original_name,storage_key,mime_type,size_bytes,sha256,status,extraction_status,extraction_format,extracted_text,extracted_byte_count,extracted_character_count,extracted_line_count,extracted_at,extraction_error,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(workspace.id, artifact.id, artifact.nodeId ?? null, artifact.originalName, artifact.storageKey, artifact.mimeType, artifact.sizeBytes, artifact.sha256, artifact.status, artifact.extractionStatus ?? 'pending', artifact.extractionFormat ?? null, artifact.extractedText ?? null, artifact.extractedByteCount ?? null, artifact.extractedCharacterCount ?? null, artifact.extractedLineCount ?? null, artifact.extractedAt ?? null, artifact.extractionError ?? null, artifact.createdAt, artifact.updatedAt)
    }
    for (const annotation of workspace.annotations) {
      database.prepare('INSERT INTO annotations(workspace_id,id,node_id,author,origin,declared_author,body,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)')
        .run(workspace.id, annotation.id, annotation.nodeId, annotation.author, annotation.origin ?? 'local', annotation.declaredAuthor ?? null, annotation.body, annotation.createdAt, annotation.updatedAt)
    }
    for (const definition of workspace.workflowDefinitions) {
      database.prepare(`INSERT INTO workflow_definitions(workspace_id,id,project_id,name,revision,status,specification_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(workspace.id, definition.id, definition.projectId ?? null, definition.name, definition.revision, definition.status, JSON.stringify(definition.specification), definition.createdAt, definition.updatedAt)
    }
    for (const run of workspace.runs) {
      database.prepare(`INSERT INTO workflow_runs(workspace_id,id,project_id,context_id,intent,source_node_ids_json,evidence_revision,status,pre_gate_json,post_gate_json,candidate_json,committed_node_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`)
        .run(workspace.id, run.id, run.projectId ?? null, run.contextId, run.intent, JSON.stringify(run.sourceNodeIds), run.evidenceRevision ?? null, run.status,
          JSON.stringify(run.preGate), JSON.stringify(run.postGate), JSON.stringify(run.candidate), run.committedNodeId ?? null, run.createdAt, run.updatedAt)
    }
    for (const gate of workspace.gates) {
      database.prepare('INSERT INTO gate_definitions(workspace_id,id,name,kind,enabled,rules_json,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)')
        .run(workspace.id, gate.id, gate.name, gate.kind, Number(gate.enabled), JSON.stringify(gate.rules), gate.createdAt, gate.updatedAt)
    }
    for (const approval of workspace.approvals) {
      database.prepare(`INSERT INTO approvals(workspace_id,id,run_id,status,decided_by,decided_at,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`)
        .run(workspace.id, approval.id, approval.runId, approval.status, approval.decidedBy ?? null, approval.decidedAt ?? null, approval.createdAt, approval.updatedAt)
    }
    for (const item of workspace.activities) {
      database.prepare(`INSERT INTO activities(workspace_id,id,actor,action,entity_type,entity_id,summary,changed_fields_json,created_at) VALUES (?,?,?,?,?,?,?,?,?)`)
        .run(workspace.id, item.id, item.actor, item.action, item.entityType, item.entityId ?? null, item.summary, JSON.stringify(item.changedFields), item.createdAt)
    }
    if (markSearchDirty) {
      this.markSearchIndexDirtyInTransaction(workspace.id, workspace.updatedAt, 'Workspace content changed; the derived search index must be rebuilt.')
    }
  }

  private withImmediateTransaction<T>(operation: () => T): T {
    const database = this.requireDatabase()
    database.exec('BEGIN IMMEDIATE')
    try {
      const result = operation()
      database.exec('COMMIT')
      return result
    } catch (error) {
      database.exec('ROLLBACK')
      throw error
    }
  }

  private async enqueueWrite(operation: () => void | Promise<void>) {
    const queued = this.writeQueue.then(operation)
    this.writeQueue = queued.then(() => undefined, () => undefined)
    await queued
  }

  private requireDatabase() {
    if (!this.database) throw new WorkspaceStoreError('DATABASE_CLOSED', 'Clarity Core has not been initialized.')
    return this.database
  }
}
