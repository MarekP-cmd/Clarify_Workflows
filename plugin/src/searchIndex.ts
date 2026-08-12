import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  INGESTION_FORMATS,
  EXTRACTION_STATUSES,
} from './types.js'
import {
  SEARCH_SOURCE_KINDS,
  SEARCH_TRUST_LABELS,
  SEARCH_QUERY_MAX_CHARACTERS,
  hashSearchContent,
  boundedSearchText,
  searchProvenanceSchema,
  searchTrustSchema,
  trustForAnnotation,
  trustForNode,
} from './searchContract.js'
import type {
  SearchProvenance,
  SearchSourceKind,
  SearchTrust,
} from './searchContract.js'
import type {
  ClarityAnnotation,
  ClarityArtifact,
  ClarityNode,
  WorkspaceState,
} from './types.js'

/**
 * Chunk 4 Stage 2/3 search rows are derived from the graph and managed
 * artifact bytes; they are never the authority for workspace state and are
 * safe to rebuild from scratch.
 */
export const SEARCH_INDEX_MODEL_VERSION = 1 as const
export const SEARCH_INDEX_STATUSES = ['unbuilt', 'dirty', 'building', 'ready', 'failed'] as const
export type SearchIndexStatus = (typeof SEARCH_INDEX_STATUSES)[number]

export const SEARCH_INDEX_MAX_DOCUMENTS = 75_000
export const SEARCH_INDEX_MAX_CHUNKS = 200_000
export const SEARCH_CHUNK_MAX_CHARACTERS = 16_000
export const SEARCH_CHUNK_MAX_BYTES = 64_000
/** Keep every legal query inside at least one deterministic chunk even when
 * its text crosses a nominal 16,000-character boundary. */
export const SEARCH_CHUNK_OVERLAP_CHARACTERS = SEARCH_QUERY_MAX_CHARACTERS - 1
export const SEARCH_CHUNK_OVERLAP_MAX_BYTES = SEARCH_CHUNK_OVERLAP_CHARACTERS * 4
export const SEARCH_INDEX_ERROR_MAX_CHARACTERS = 2_000

export type SearchIndexBuildErrorCode =
  | 'SEARCH_INDEX_CAPACITY'
  | 'SEARCH_EXTRACTION_MISSING'
  | 'SEARCH_EXTRACTION_METADATA_MISSING'

export class SearchIndexBuildError extends Error {
  constructor(readonly code: SearchIndexBuildErrorCode, message: string) {
    super(message)
    this.name = 'SearchIndexBuildError'
  }
}

const identifierSchema = z.string().trim().min(1).max(160)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const timestampSchema = z.string().datetime({ offset: true }).max(100)
const nonNegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const boundedChunkTextSchema = z.string().superRefine((value, context) => {
  const characterCount = Array.from(value).length
  const byteCount = Buffer.byteLength(value, 'utf8')
  if (characterCount > SEARCH_CHUNK_MAX_CHARACTERS) {
    context.addIssue({ code: 'custom', message: `Search chunks are limited to ${SEARCH_CHUNK_MAX_CHARACTERS} characters.` })
  }
  if (byteCount > SEARCH_CHUNK_MAX_BYTES) {
    context.addIssue({ code: 'custom', message: `Search chunks are limited to ${SEARCH_CHUNK_MAX_BYTES} UTF-8 bytes.` })
  }
})

export const searchIndexDocumentSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  sourceKind: z.enum(SEARCH_SOURCE_KINDS),
  sourceId: identifierSchema,
  title: z.string().trim().min(1).max(500),
  sourceUri: z.string().max(4_000).optional(),
  contentHash: digestSchema,
  sourceSha256: digestSchema.optional(),
  workspaceRevision: nonNegativeIntegerSchema,
  extractionStatus: z.enum(EXTRACTION_STATUSES).optional(),
  extractionFormat: z.enum(INGESTION_FORMATS).optional(),
  trust: searchTrustSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict().superRefine((value, context) => {
  if (value.sourceKind === 'artifact') {
    if (value.extractionStatus !== 'extracted') {
      context.addIssue({ code: 'custom', message: 'Only extracted artifacts can enter the search index.', path: ['extractionStatus'] })
    }
    if (!value.sourceSha256) {
      context.addIssue({ code: 'custom', message: 'Artifact search documents require the managed-byte SHA-256.', path: ['sourceSha256'] })
    }
    if (!value.extractionFormat) {
      context.addIssue({ code: 'custom', message: 'Artifact search documents require an extraction format.', path: ['extractionFormat'] })
    }
  } else if (value.extractionStatus !== undefined || value.extractionFormat !== undefined || value.sourceSha256 !== undefined) {
    context.addIssue({ code: 'custom', message: 'Extraction metadata is only valid for artifact search documents.', path: ['sourceKind'] })
  }
})

export type SearchIndexDocument = z.infer<typeof searchIndexDocumentSchema>

export const searchIndexChunkSchema = z.object({
  id: identifierSchema,
  workspaceId: identifierSchema,
  documentId: identifierSchema,
  sequence: z.number().int().min(0).max(1_000_000),
  text: boundedChunkTextSchema,
  characterCount: nonNegativeIntegerSchema.max(SEARCH_CHUNK_MAX_CHARACTERS),
  byteCount: nonNegativeIntegerSchema.max(SEARCH_CHUNK_MAX_BYTES),
  provenance: searchProvenanceSchema,
  trust: searchTrustSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
}).strict().superRefine((value, context) => {
  const expectedCharacterCount = Array.from(value.text).length
  const expectedByteCount = Buffer.byteLength(value.text, 'utf8')
  if (value.characterCount !== expectedCharacterCount) {
    context.addIssue({ code: 'custom', message: 'Search chunk characterCount must match its UTF-8-safe text.', path: ['characterCount'] })
  }
  if (value.byteCount !== expectedByteCount) {
    context.addIssue({ code: 'custom', message: 'Search chunk byteCount must match its UTF-8-safe text.', path: ['byteCount'] })
  }
  if (value.provenance.chunkId !== value.id) {
    context.addIssue({ code: 'custom', message: 'Search chunk provenance must identify the same chunk id.', path: ['provenance', 'chunkId'] })
  }
  if (value.provenance.contentHash !== hashSearchContent(value.text)) {
    context.addIssue({ code: 'custom', message: 'Search chunk provenance contentHash must match its text.', path: ['provenance', 'contentHash'] })
  }
  if (value.provenance.endCharacter - value.provenance.startCharacter !== value.characterCount) {
    context.addIssue({ code: 'custom', message: 'Search chunk character offsets must span exactly its text.', path: ['provenance', 'endCharacter'] })
  }
  if (value.provenance.endByte - value.provenance.startByte !== value.byteCount) {
    context.addIssue({ code: 'custom', message: 'Search chunk byte offsets must span exactly its text.', path: ['provenance', 'endByte'] })
  }
  const hasStartLine = value.provenance.startLine !== undefined
  const hasEndLine = value.provenance.endLine !== undefined
  if (hasStartLine !== hasEndLine) {
    context.addIssue({ code: 'custom', message: 'Search chunk line offsets must be supplied together.', path: ['provenance'] })
  } else if (hasStartLine && hasEndLine) {
    // A trailing newline terminates the final line; it does not create a
    // second line containing searchable characters. Keep this in lockstep
    // with chunkSearchText's line-span calculation.
    const lineCount = Array.from(value.text).filter((character) => character === '\n').length
      + (value.text.endsWith('\n') ? 0 : 1)
    if (value.provenance.endLine! - value.provenance.startLine! + 1 !== lineCount) {
      context.addIssue({ code: 'custom', message: 'Search chunk line offsets must span exactly its text.', path: ['provenance', 'endLine'] })
    }
  }
})

export type SearchIndexChunk = z.infer<typeof searchIndexChunkSchema>

export const searchIndexStateSchema = z.object({
  workspaceId: identifierSchema,
  status: z.enum(SEARCH_INDEX_STATUSES),
  indexedRevision: nonNegativeIntegerSchema,
  generation: nonNegativeIntegerSchema,
  documentCount: z.number().int().min(0).max(SEARCH_INDEX_MAX_DOCUMENTS),
  chunkCount: z.number().int().min(0).max(SEARCH_INDEX_MAX_CHUNKS),
  rebuildRequestedAt: timestampSchema.optional(),
  lastIndexedAt: timestampSchema.optional(),
  lastError: z.string().max(SEARCH_INDEX_ERROR_MAX_CHARACTERS).optional(),
  updatedAt: timestampSchema,
}).strict()

export type SearchIndexState = z.infer<typeof searchIndexStateSchema>

export const derivedSearchIndexInputSchema = z.object({
  expectedWorkspaceRevision: nonNegativeIntegerSchema,
  documents: z.array(searchIndexDocumentSchema).max(SEARCH_INDEX_MAX_DOCUMENTS),
  chunks: z.array(searchIndexChunkSchema).max(SEARCH_INDEX_MAX_CHUNKS),
}).strict().superRefine((value, context) => {
  const documentIds = new Set<string>()
  const documentsById = new Map<string, SearchIndexDocument>()
  const documentSources = new Set<string>()
  const chunkIds = new Set<string>()
  const chunksByDocument = new Map<string, SearchIndexChunk[]>()

  for (const document of value.documents) {
    if (documentIds.has(document.id)) context.addIssue({ code: 'custom', message: `Duplicate search document id ${document.id}.`, path: ['documents'] })
    documentIds.add(document.id)
    documentsById.set(document.id, document)
    const sourceKey = `${document.sourceKind}\u0000${document.sourceId}`
    if (documentSources.has(sourceKey)) context.addIssue({ code: 'custom', message: `Duplicate search source ${document.sourceKind}:${document.sourceId}.`, path: ['documents'] })
    documentSources.add(sourceKey)
    if (document.workspaceRevision !== value.expectedWorkspaceRevision) {
      context.addIssue({ code: 'custom', message: 'Every search document must be indexed against the expected workspace revision.', path: ['documents'] })
    }
    if (document.id !== createSearchDocumentId(document.workspaceId, document.sourceKind, document.sourceId)) {
      context.addIssue({ code: 'custom', message: 'Search document ids must be stable hashes of workspace and source identity.', path: ['documents'] })
    }
  }

  for (const chunk of value.chunks) {
    if (chunkIds.has(chunk.id)) context.addIssue({ code: 'custom', message: `Duplicate search chunk id ${chunk.id}.`, path: ['chunks'] })
    chunkIds.add(chunk.id)
    const document = documentsById.get(chunk.documentId)
    if (!document) {
      context.addIssue({ code: 'custom', message: `Search chunk ${chunk.id} references a missing document.`, path: ['chunks'] })
      continue
    }
    if (chunk.workspaceId !== document.workspaceId || chunk.provenance.workspaceId !== document.workspaceId) {
      context.addIssue({ code: 'custom', message: 'Search chunk and provenance workspace ids must match the document.', path: ['chunks'] })
    }
    if (chunk.provenance.sourceKind !== document.sourceKind || chunk.provenance.sourceId !== document.sourceId) {
      context.addIssue({ code: 'custom', message: 'Search chunk provenance must remain bound to its document source.', path: ['chunks'] })
    }
    const provenanceIdentity = document.sourceKind === 'node'
      ? chunk.provenance.nodeId
      : document.sourceKind === 'annotation'
        ? chunk.provenance.annotationId
        : chunk.provenance.artifactId
    if (provenanceIdentity !== document.sourceId) {
      context.addIssue({ code: 'custom', message: 'Search chunk provenance identity must match its document source id.', path: ['chunks'] })
    }
    if (chunk.provenance.sourceUri !== document.sourceUri) {
      context.addIssue({ code: 'custom', message: 'Search chunk sourceUri must match its document metadata.', path: ['chunks'] })
    }
    if (chunk.provenance.workspaceRevision !== document.workspaceRevision) {
      context.addIssue({ code: 'custom', message: 'Search chunk and document revisions must match.', path: ['chunks'] })
    }
    if (JSON.stringify(chunk.trust) !== JSON.stringify(document.trust)) {
      context.addIssue({ code: 'custom', message: 'Search chunk trust metadata must remain bound to its document.', path: ['chunks'] })
    }
    if (document.sourceKind === 'artifact' && chunk.provenance.sourceSha256 !== document.sourceSha256) {
      context.addIssue({ code: 'custom', message: 'Search chunk artifact provenance must retain the document managed-byte SHA-256.', path: ['chunks'] })
    }
    if (chunk.provenance.extractionStatus !== document.extractionStatus || chunk.provenance.extractionFormat !== document.extractionFormat) {
      context.addIssue({ code: 'custom', message: 'Search chunk extraction metadata must match its document metadata.', path: ['chunks'] })
    }
    if (chunk.id !== createSearchChunkId(document.id, chunk.sequence)) {
      context.addIssue({ code: 'custom', message: 'Search chunk ids must be stable hashes of document and sequence.', path: ['chunks'] })
    }
    const chunks = chunksByDocument.get(document.id) ?? []
    chunks.push(chunk)
    chunksByDocument.set(document.id, chunks)
  }

  for (const [documentId, chunks] of chunksByDocument) {
    chunks.sort((left, right) => left.sequence - right.sequence)
    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1].provenance
      const current = chunks[index].provenance
      const characterOverlap = previous.endCharacter - current.startCharacter
      const byteOverlap = previous.endByte - current.startByte
      if (
        current.startCharacter <= previous.startCharacter
        || current.startByte <= previous.startByte
        || characterOverlap < 0
        || byteOverlap < 0
        || characterOverlap > SEARCH_CHUNK_OVERLAP_CHARACTERS
        || byteOverlap > SEARCH_CHUNK_OVERLAP_MAX_BYTES
      ) {
        context.addIssue({ code: 'custom', message: `Search chunks for ${documentId} have an invalid gap, overlap, or ordering.`, path: ['chunks'] })
      }
    }
  }
})

export type DerivedSearchIndexInput = z.infer<typeof derivedSearchIndexInputSchema>

export type SearchIndexSnapshot = {
  state: SearchIndexState
  documents: SearchIndexDocument[]
  chunks: SearchIndexChunk[]
}

export type SearchChunkSource = {
  workspace: WorkspaceState
  sourceKind: SearchSourceKind
  sourceId: string
  nodeId?: string
  annotationId?: string
  artifactId?: string
  sourceUri?: string
  sourceSha256?: string
  extractionStatus?: 'extracted'
  extractionFormat?: (typeof INGESTION_FORMATS)[number]
  title: string
  text: string
  trust: SearchTrust
  createdAt: string
  updatedAt: string
}

export function createSearchDocumentId(workspaceId: string, sourceKind: SearchSourceKind, sourceId: string) {
  return `search-document-${createHash('sha256').update(`${workspaceId}\u0000${sourceKind}\u0000${sourceId}`).digest('hex').slice(0, 32)}`
}

export function createSearchChunkId(documentId: string, sequence: number) {
  return `search-chunk-${createHash('sha256').update(`${documentId}\u0000${sequence}`).digest('hex').slice(0, 32)}`
}

function lineSpanForText(text: string) {
  const newlineCount = Array.from(text).filter((character) => character === '\n').length
  return newlineCount + (text.endsWith('\n') ? 0 : 1)
}

/** Split source text deterministically without splitting a Unicode code point. */
export function chunkSearchText(source: SearchChunkSource) {
  const documentId = createSearchDocumentId(source.workspace.id, source.sourceKind, source.sourceId)
  const characters = Array.from(source.text)
  const byteOffsets = [0]
  const lineOffsets = [0]
  for (const character of characters) {
    byteOffsets.push(byteOffsets[byteOffsets.length - 1] + Buffer.byteLength(character, 'utf8'))
    lineOffsets.push(lineOffsets[lineOffsets.length - 1] + (character === '\n' ? 1 : 0))
  }

  const chunks: SearchIndexChunk[] = []
  for (let start = 0, sequence = 0; start < characters.length; sequence += 1) {
    const end = Math.min(start + SEARCH_CHUNK_MAX_CHARACTERS, characters.length)
    const text = characters.slice(start, end).join('')
    const id = createSearchChunkId(documentId, sequence)
    const startByte = byteOffsets[start]
    const endByte = byteOffsets[end]
    const startLine = lineOffsets[start]
    const endLine = startLine + lineSpanForText(text) - 1
    const provenance: SearchProvenance = {
      workspaceId: source.workspace.id,
      workspaceRevision: source.workspace.revision,
      sourceKind: source.sourceKind,
      sourceId: source.sourceId,
      ...(source.nodeId ? { nodeId: source.nodeId } : {}),
      ...(source.annotationId ? { annotationId: source.annotationId } : {}),
      ...(source.artifactId ? { artifactId: source.artifactId } : {}),
      ...(source.sourceUri ? { sourceUri: source.sourceUri } : {}),
      ...(source.sourceSha256 ? { sourceSha256: source.sourceSha256 } : {}),
      ...(source.extractionStatus ? { extractionStatus: source.extractionStatus } : {}),
      ...(source.extractionFormat ? { extractionFormat: source.extractionFormat } : {}),
      contentHash: hashSearchContent(text),
      chunkId: id,
      startCharacter: start,
      endCharacter: end,
      startByte,
      endByte,
      startLine,
      endLine,
    }
    chunks.push(searchIndexChunkSchema.parse({
      id,
      workspaceId: source.workspace.id,
      documentId,
      sequence,
      text,
      characterCount: end - start,
      byteCount: endByte - startByte,
      provenance,
      trust: source.trust,
      createdAt: source.createdAt,
      updatedAt: source.updatedAt,
    }))
    if (end === characters.length) break
    start = end - SEARCH_CHUNK_OVERLAP_CHARACTERS
  }
  return chunks
}

function nodeSearchText(node: ClarityNode) {
  return [
    `Title: ${node.title}`,
    `Kind: ${node.kind}`,
    `Status: ${node.status}`,
    `Schema: ${node.schemaType}`,
    `Description: ${node.description}`,
    node.tags.length ? `Tags: ${node.tags.join(', ')}` : undefined,
    `Provenance: ${node.provenance}`,
    node.sourceUri ? `Source URI: ${node.sourceUri}` : undefined,
    node.humanAnnotation ? `Human annotation: ${node.humanAnnotation}` : undefined,
    node.aiAnnotation ? `AI annotation: ${node.aiAnnotation}` : undefined,
    node.instruction ? `Instruction: ${node.instruction}` : undefined,
  ].filter((field): field is string => field !== undefined).join('\n')
}

function boundedTitle(value: string) {
  return boundedSearchText(value, 500, 2_000).text || 'Untitled source'
}

function documentForSource(source: SearchChunkSource): SearchIndexDocument {
  return searchIndexDocumentSchema.parse({
    id: createSearchDocumentId(source.workspace.id, source.sourceKind, source.sourceId),
    workspaceId: source.workspace.id,
    sourceKind: source.sourceKind,
    sourceId: source.sourceId,
    title: boundedTitle(source.title),
    sourceUri: source.sourceUri,
    contentHash: hashSearchContent(source.text),
    sourceSha256: source.sourceSha256,
    workspaceRevision: source.workspace.revision,
    extractionStatus: source.extractionStatus,
    extractionFormat: source.extractionFormat,
    trust: source.trust,
    createdAt: source.createdAt,
    updatedAt: source.updatedAt,
  })
}

function nodeSource(workspace: WorkspaceState, node: ClarityNode): SearchChunkSource {
  return {
    workspace,
    sourceKind: 'node',
    sourceId: node.id,
    nodeId: node.id,
    sourceUri: node.sourceUri,
    title: node.title,
    text: nodeSearchText(node),
    trust: trustForNode(node),
    createdAt: node.createdAt ?? workspace.createdAt,
    updatedAt: node.updatedAt ?? workspace.updatedAt,
  }
}

function annotationSource(workspace: WorkspaceState, annotation: ClarityAnnotation, node?: ClarityNode): SearchChunkSource {
  return {
    workspace,
    sourceKind: 'annotation',
    sourceId: annotation.id,
    annotationId: annotation.id,
    sourceUri: node?.sourceUri,
    title: node ? `Annotation on ${node.title}` : `Annotation ${annotation.id}`,
    text: annotation.body,
    trust: trustForAnnotation(annotation),
    createdAt: annotation.createdAt,
    updatedAt: annotation.updatedAt,
  }
}

function artifactSource(workspace: WorkspaceState, artifact: ClarityArtifact, node?: ClarityNode): SearchChunkSource {
  if (artifact.extractionStatus !== 'extracted' || artifact.extractedText === undefined) {
    throw new SearchIndexBuildError('SEARCH_EXTRACTION_MISSING', `Artifact ${artifact.id} is not explicitly extracted and cannot enter the search index.`)
  }
  if (!artifact.extractionFormat) {
    throw new SearchIndexBuildError('SEARCH_EXTRACTION_METADATA_MISSING', `Extracted artifact ${artifact.id} is missing its extraction format.`)
  }
  return {
    workspace,
    sourceKind: 'artifact',
    sourceId: artifact.id,
    artifactId: artifact.id,
    sourceUri: `clarity://artifact/${artifact.id}`,
    sourceSha256: artifact.sha256,
    extractionStatus: 'extracted',
    extractionFormat: artifact.extractionFormat,
    title: artifact.originalName,
    text: artifact.extractedText,
    trust: node ? trustForNode(node) : { label: 'human', effectiveAuthor: 'human', verified: true },
    createdAt: artifact.createdAt,
    updatedAt: artifact.updatedAt,
  }
}

/** Reconstruct one authoritative source projection without scanning every
 * other document. Exact passage retrieval uses this to prove that a durable
 * result still represents current graph/extraction content. */
export function buildCanonicalSearchSource(
  workspace: WorkspaceState,
  sourceKind: SearchSourceKind,
  sourceId: string,
) {
  const nodesById = new Map(workspace.nodes.map((node) => [node.id, node]))
  let source: SearchChunkSource | null = null
  if (sourceKind === 'node') {
    const node = nodesById.get(sourceId)
    if (node) source = nodeSource(workspace, node)
  } else if (sourceKind === 'annotation') {
    const annotation = workspace.annotations.find((candidate) => candidate.id === sourceId)
    if (annotation) source = annotationSource(workspace, annotation, nodesById.get(annotation.nodeId))
  } else {
    const artifact = workspace.artifacts.find((candidate) => candidate.id === sourceId)
    if (artifact?.extractionStatus === 'extracted') {
      source = artifactSource(workspace, artifact, artifact.nodeId ? nodesById.get(artifact.nodeId) : undefined)
    }
  }
  if (!source) return null
  return {
    document: documentForSource(source),
    chunks: chunkSearchText(source),
  }
}

/** Build the complete deterministic projection from one authoritative snapshot. */
export function buildSearchIndexInput(workspace: WorkspaceState): DerivedSearchIndexInput {
  const documents: SearchIndexDocument[] = []
  const chunks: SearchIndexChunk[] = []
  const addSource = (source: SearchChunkSource) => {
    const document = documentForSource(source)
    const sourceChunks = chunkSearchText(source)
    documents.push(document)
    chunks.push(...sourceChunks)
    if (documents.length > SEARCH_INDEX_MAX_DOCUMENTS || chunks.length > SEARCH_INDEX_MAX_CHUNKS) {
      throw new SearchIndexBuildError(
        'SEARCH_INDEX_CAPACITY',
        `The deterministic search projection exceeds its ${SEARCH_INDEX_MAX_DOCUMENTS}-document or ${SEARCH_INDEX_MAX_CHUNKS}-chunk capacity.`,
      )
    }
  }

  for (const node of [...workspace.nodes].sort((left, right) => left.id.localeCompare(right.id))) addSource(nodeSource(workspace, node))
  const nodesById = new Map(workspace.nodes.map((node) => [node.id, node]))
  for (const annotation of [...workspace.annotations].sort((left, right) => left.id.localeCompare(right.id))) {
    addSource(annotationSource(workspace, annotation, nodesById.get(annotation.nodeId)))
  }
  for (const artifact of [...workspace.artifacts].sort((left, right) => left.id.localeCompare(right.id))) {
    if (artifact.extractionStatus !== 'extracted') continue
    addSource(artifactSource(workspace, artifact, artifact.nodeId ? nodesById.get(artifact.nodeId) : undefined))
  }

  return derivedSearchIndexInputSchema.parse({
    expectedWorkspaceRevision: workspace.revision,
    documents,
    chunks,
  })
}

export function parseDerivedSearchIndexInput(input: unknown): DerivedSearchIndexInput {
  return derivedSearchIndexInputSchema.parse(input)
}

export function createSearchIndexState(
  workspaceId: string,
  status: SearchIndexStatus = 'unbuilt',
  updatedAt: string,
): SearchIndexState {
  return searchIndexStateSchema.parse({
    workspaceId,
    status,
    indexedRevision: 0,
    generation: 0,
    documentCount: 0,
    chunkCount: 0,
    updatedAt,
  })
}

export type SearchIndexTrust = SearchTrust
export type SearchIndexProvenance = SearchProvenance
export { SEARCH_SOURCE_KINDS, SEARCH_TRUST_LABELS }
