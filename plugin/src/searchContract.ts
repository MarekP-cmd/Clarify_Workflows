import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ClarityAnnotation, ClarityNode } from './types.js'
import {
  ANNOTATION_AUTHORS,
  ANNOTATION_ORIGINS,
  EXTRACTION_STATUSES,
  INGESTION_FORMATS,
  NODE_ORIGINS,
} from './types.js'

/**
 * Chunk 4 Stage 1 freezes the data boundary used by every later search
 * implementation. These limits are deliberately smaller than the existing
 * workspace limits so a search response cannot become a second document
 * transport. They are contract values, not UI suggestions.
 */
export const SEARCH_CONTRACT_VERSION = 1 as const
export const SEARCH_QUERY_MAX_CHARACTERS = 512
export const SEARCH_QUERY_MAX_TERMS = 32
export const SEARCH_QUERY_SCAN_MAX_CHARACTERS = 50_000_000
export const SEARCH_QUERY_MAX_CANDIDATES = 20_000
export const SEARCH_RESULT_PAGE_MAX = 50
export const SEARCH_MAX_FILTER_IDS = 50
export const SEARCH_SNIPPET_MAX_CHARACTERS = 2_000
export const SEARCH_SNIPPET_MAX_BYTES = 8_000
export const SEARCH_PASSAGE_MAX_CHARACTERS = 100_000
export const SEARCH_PASSAGE_MAX_BYTES = 400_000
export const SEARCH_RESPONSE_MAX_BYTES = 256_000
export const SEARCH_MAX_MATCH_RANGES = 32
/** A prepared workflow may admit only a small, bounded set of exact passages. */
export const SEARCH_ADMITTED_CITATION_MAX = 8
export const SEARCH_ADMITTED_CITATION_MAX_CHARACTERS = 100_000
export const SEARCH_ADMITTED_CITATION_MAX_BYTES = 400_000

export const SEARCH_SOURCE_KINDS = ['node', 'annotation', 'artifact'] as const
export const SEARCH_SCOPE_KINDS = ['all', 'nodes', 'annotations', 'artifacts'] as const
export const SEARCH_TRUST_LABELS = [
  'human',
  'approved-ai',
  'native-ai',
  'native-system',
  'imported-unverified',
  'unknown',
] as const

export type SearchSourceKind = (typeof SEARCH_SOURCE_KINDS)[number]
export type SearchScopeKind = (typeof SEARCH_SCOPE_KINDS)[number]
export type SearchTrustLabel = (typeof SEARCH_TRUST_LABELS)[number]

/** Search text is source data. It is never an instruction channel. */
export const SEARCH_CONTENT_POLICY = 'untrusted-source-data' as const
export const SEARCH_INSTRUCTION_POLICY = 'treat-source-text-as-data' as const

const identifierSchema = z.string().trim().min(1).max(160)
const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
const nonNegativeIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER)
const boundedSourceKindSchema = z.enum(SEARCH_SOURCE_KINDS)
const boundedTrustLabelSchema = z.enum(SEARCH_TRUST_LABELS)
/** Stable ids emitted by the Stage 5 citation builder and persisted in runs. */
export const searchCitationIdReferenceSchema = z.string().regex(/^search-citation-[a-f0-9]{32}$/)

function hasDisallowedControlCharacter(value: string) {
  for (const character of value) {
    const codePoint = character.codePointAt(0) ?? 0
    if (codePoint < 0x20 && codePoint !== 0x09 && codePoint !== 0x0a && codePoint !== 0x0d) return true
  }
  return false
}

function codePointCount(value: string) {
  return Array.from(value).length
}

/**
 * Normalize only layout-level whitespace. Search syntax is intentionally
 * plain text; a future index adapter must escape its own query language
 * rather than passing this value directly to an FTS parser.
 */
export function normalizeSearchQuery(value: string) {
  const normalized = value.normalize('NFKC').replace(/\s+/gu, ' ').trim()
  if (!normalized) throw new SearchContractError('SEARCH_QUERY_EMPTY', 'Search query must contain at least one non-whitespace character.')
  if (codePointCount(normalized) > SEARCH_QUERY_MAX_CHARACTERS) {
    throw new SearchContractError('SEARCH_QUERY_TOO_LONG', `Search queries are limited to ${SEARCH_QUERY_MAX_CHARACTERS} characters.`)
  }
  if (hasDisallowedControlCharacter(normalized)) {
    throw new SearchContractError('SEARCH_QUERY_CONTROL_CHARACTER', 'Search queries cannot contain control characters.')
  }
  if (new Set(normalized.split(' ')).size > SEARCH_QUERY_MAX_TERMS) {
    throw new SearchContractError(
      'SEARCH_QUERY_TOO_MANY_TERMS',
      `Search queries are limited to ${SEARCH_QUERY_MAX_TERMS} unique terms.`,
    )
  }
  return normalized
}

function boundedTextSchema(maxCharacters: number, maxBytes: number, label: string) {
  return z.string().superRefine((value, context) => {
    if (codePointCount(value) > maxCharacters) {
      context.addIssue({ code: 'custom', message: `${label} exceeds the ${maxCharacters}-character limit.` })
    }
    if (Buffer.byteLength(value, 'utf8') > maxBytes) {
      context.addIssue({ code: 'custom', message: `${label} exceeds the ${maxBytes}-byte UTF-8 limit.` })
    }
  })
}

const queryTextSchema = z.string().trim().min(1).superRefine((value, context) => {
  if (codePointCount(value) > SEARCH_QUERY_MAX_CHARACTERS) {
    context.addIssue({ code: 'custom', message: `Search queries are limited to ${SEARCH_QUERY_MAX_CHARACTERS} characters.` })
  }
  if (hasDisallowedControlCharacter(value)) {
    context.addIssue({ code: 'custom', message: 'Search queries cannot contain control characters.' })
  }
  if (new Set(value.split(/\s+/u).filter(Boolean)).size > SEARCH_QUERY_MAX_TERMS) {
    context.addIssue({ code: 'custom', message: `Search queries are limited to ${SEARCH_QUERY_MAX_TERMS} unique terms.` })
  }
})

export const searchQuerySchema = z.object({
  /** Stage 1 accepts plain text only; FTS/semantic syntax is not public yet. */
  queryMode: z.literal('plain-text').default('plain-text'),
  query: queryTextSchema,
  scope: z.enum(SEARCH_SCOPE_KINDS).default('all'),
  sourceKinds: z.array(boundedSourceKindSchema).max(SEARCH_SOURCE_KINDS.length).optional(),
  projectIds: z.array(identifierSchema).max(SEARCH_MAX_FILTER_IDS).optional(),
  nodeIds: z.array(identifierSchema).max(SEARCH_MAX_FILTER_IDS).optional(),
  artifactIds: z.array(identifierSchema).max(SEARCH_MAX_FILTER_IDS).optional(),
  trust: z.array(boundedTrustLabelSchema).max(SEARCH_TRUST_LABELS.length).optional(),
  limit: z.number().int().min(1).max(SEARCH_RESULT_PAGE_MAX).default(20),
  cursor: z.string().regex(/^\d+$/).max(12).optional(),
  expectedWorkspaceRevision: nonNegativeIntegerSchema.optional(),
}).strict()

export type SearchQueryInput = z.input<typeof searchQuerySchema>
export type SearchQuery = z.output<typeof searchQuerySchema>

export function parseSearchQuery(input: unknown): SearchQuery {
  // Normalize before schema parsing so whitespace-only, overlong, and
  // control-containing input consistently returns the typed contract error
  // rather than an implementation-specific Zod shape error. The schema still
  // validates the normalized object and rejects missing/non-string queries.
  if (typeof input === 'object' && input !== null && 'query' in input) {
    const candidate = input as { query?: unknown }
    if (typeof candidate.query === 'string') {
      const normalized = normalizeSearchQuery(candidate.query)
      const parsed = searchQuerySchema.parse({ ...input, query: normalized })
      return { ...parsed, query: normalized }
    }
  }
  const parsed = searchQuerySchema.parse(input)
  return { ...parsed, query: normalizeSearchQuery(parsed.query) }
}

export const searchTrustSchema = z.object({
  label: boundedTrustLabelSchema,
  effectiveAuthor: z.enum([...ANNOTATION_AUTHORS, 'unknown'] as const),
  declaredAuthor: z.enum(ANNOTATION_AUTHORS).optional(),
  verified: z.boolean(),
}).strict()

export type SearchTrust = z.infer<typeof searchTrustSchema>

export const searchProvenanceSchema = z.object({
  workspaceId: identifierSchema,
  workspaceRevision: nonNegativeIntegerSchema,
  sourceKind: boundedSourceKindSchema,
  sourceId: identifierSchema,
  nodeId: identifierSchema.optional(),
  artifactId: identifierSchema.optional(),
  annotationId: identifierSchema.optional(),
  sourceUri: z.string().max(4_000).optional(),
  /** Hash of the exact text indexed for this source/chunk. */
  contentHash: digestSchema,
  /** Original managed-byte digest when the source is an extracted artifact. */
  sourceSha256: digestSchema.optional(),
  extractionStatus: z.enum(EXTRACTION_STATUSES).optional(),
  extractionFormat: z.enum(INGESTION_FORMATS).optional(),
  chunkId: identifierSchema,
  startCharacter: nonNegativeIntegerSchema,
  endCharacter: nonNegativeIntegerSchema,
  startByte: nonNegativeIntegerSchema,
  endByte: nonNegativeIntegerSchema,
  startLine: nonNegativeIntegerSchema.optional(),
  endLine: nonNegativeIntegerSchema.optional(),
}).strict().superRefine((value, context) => {
  if (value.endCharacter < value.startCharacter) {
    context.addIssue({ code: 'custom', message: 'Provenance endCharacter must not precede startCharacter.', path: ['endCharacter'] })
  }
  if (value.endByte < value.startByte) {
    context.addIssue({ code: 'custom', message: 'Provenance endByte must not precede startByte.', path: ['endByte'] })
  }
  if (value.startLine !== undefined && value.endLine !== undefined && value.endLine < value.startLine) {
    context.addIssue({ code: 'custom', message: 'Provenance endLine must not precede startLine.', path: ['endLine'] })
  }
  const identityMatches = value.sourceKind === 'node'
    ? value.nodeId === value.sourceId && value.artifactId === undefined && value.annotationId === undefined
    : value.sourceKind === 'artifact'
      ? value.artifactId === value.sourceId && value.nodeId === undefined && value.annotationId === undefined
      : value.annotationId === value.sourceId && value.nodeId === undefined && value.artifactId === undefined
  if (!identityMatches) {
    context.addIssue({ code: 'custom', message: 'Provenance identity must match sourceKind and sourceId exactly.', path: ['sourceKind'] })
  }
  if (value.sourceKind === 'artifact' && value.extractionStatus !== 'extracted') {
    context.addIssue({ code: 'custom', message: 'Only explicitly extracted artifacts may have searchable provenance.', path: ['extractionStatus'] })
  }
  if (value.sourceKind === 'artifact' && !value.sourceSha256) {
    context.addIssue({ code: 'custom', message: 'Extracted artifact provenance requires the managed-byte SHA-256.', path: ['sourceSha256'] })
  }
})

export type SearchProvenance = z.infer<typeof searchProvenanceSchema>

export const searchMatchRangeSchema = z.object({
  startCharacter: nonNegativeIntegerSchema,
  endCharacter: nonNegativeIntegerSchema,
}).strict().superRefine((value, context) => {
  if (value.endCharacter < value.startCharacter) {
    context.addIssue({ code: 'custom', message: 'Match endCharacter must not precede startCharacter.', path: ['endCharacter'] })
  }
})

export const searchResultSchema = z.object({
  resultId: identifierSchema,
  rank: z.number().int().min(1).max(SEARCH_RESULT_PAGE_MAX),
  score: z.number().finite().min(0).max(Number.MAX_SAFE_INTEGER),
  title: z.string().trim().min(1).max(500),
  snippet: boundedTextSchema(SEARCH_SNIPPET_MAX_CHARACTERS, SEARCH_SNIPPET_MAX_BYTES, 'Search snippet'),
  snippetCharacterCount: nonNegativeIntegerSchema.max(SEARCH_SNIPPET_MAX_CHARACTERS),
  snippetByteCount: nonNegativeIntegerSchema.max(SEARCH_SNIPPET_MAX_BYTES),
  truncated: z.boolean(),
  matchRanges: z.array(searchMatchRangeSchema).max(SEARCH_MAX_MATCH_RANGES),
  provenance: searchProvenanceSchema,
  trust: searchTrustSchema,
}).strict().superRefine((value, context) => {
  if (value.snippetCharacterCount !== codePointCount(value.snippet)) {
    context.addIssue({ code: 'custom', message: 'snippetCharacterCount must match the UTF-8-safe snippet.', path: ['snippetCharacterCount'] })
  }
  if (value.snippetByteCount !== Buffer.byteLength(value.snippet, 'utf8')) {
    context.addIssue({ code: 'custom', message: 'snippetByteCount must match the UTF-8-safe snippet.', path: ['snippetByteCount'] })
  }
})

export type SearchResult = z.infer<typeof searchResultSchema>

export const searchResultPageSchema = z.object({
  contractVersion: z.literal(SEARCH_CONTRACT_VERSION),
  workspaceId: identifierSchema,
  workspaceRevision: nonNegativeIntegerSchema,
  query: boundedTextSchema(SEARCH_QUERY_MAX_CHARACTERS, SEARCH_QUERY_MAX_CHARACTERS * 4, 'Search query'),
  results: z.array(searchResultSchema).max(SEARCH_RESULT_PAGE_MAX),
  totalCount: nonNegativeIntegerSchema,
  nextCursor: z.string().regex(/^\d+$/).max(12).nullable(),
  truncated: z.boolean(),
  warnings: z.array(z.string().trim().min(1).max(500)).max(20),
}).strict()

export type SearchResultPage = z.infer<typeof searchResultPageSchema>

/** Validate a complete page and enforce the aggregate response budget before
 * any future transport serializes it. */
export function parseSearchResultPage(input: unknown): SearchResultPage {
  const parsed = searchResultPageSchema.parse(input)
  const responseBytes = Buffer.byteLength(JSON.stringify(parsed), 'utf8')
  if (responseBytes > SEARCH_RESPONSE_MAX_BYTES) {
    throw new SearchContractError('SEARCH_RESPONSE_TOO_LARGE', `Search responses are limited to ${SEARCH_RESPONSE_MAX_BYTES} UTF-8 bytes.`)
  }
  return parsed
}

export const searchPassageSchema = z.object({
  contractVersion: z.literal(SEARCH_CONTRACT_VERSION),
  citationId: identifierSchema,
  workspaceId: identifierSchema,
  workspaceRevision: nonNegativeIntegerSchema,
  content: boundedTextSchema(SEARCH_PASSAGE_MAX_CHARACTERS, SEARCH_PASSAGE_MAX_BYTES, 'Retrieved passage'),
  contentCharacterCount: nonNegativeIntegerSchema.max(SEARCH_PASSAGE_MAX_CHARACTERS),
  contentByteCount: nonNegativeIntegerSchema.max(SEARCH_PASSAGE_MAX_BYTES),
  truncated: z.boolean(),
  provenance: searchProvenanceSchema,
  trust: searchTrustSchema,
  contentPolicy: z.literal(SEARCH_CONTENT_POLICY),
  instructionPolicy: z.literal(SEARCH_INSTRUCTION_POLICY),
}).strict().superRefine((value, context) => {
  if (value.contentCharacterCount !== codePointCount(value.content)) {
    context.addIssue({ code: 'custom', message: 'contentCharacterCount must match the returned passage.', path: ['contentCharacterCount'] })
  }
  if (value.contentByteCount !== Buffer.byteLength(value.content, 'utf8')) {
    context.addIssue({ code: 'custom', message: 'contentByteCount must match the returned passage.', path: ['contentByteCount'] })
  }
})

export type SearchPassage = z.infer<typeof searchPassageSchema>

/** Validate the aggregate citation budget before a passage bundle enters a
 * prepared workflow context. Individual passages remain governed by
 * searchPassageSchema; this prevents eight individually-valid passages from
 * becoming an unbounded second context document. */
export const admittedSearchCitationsSchema = z.array(searchPassageSchema).max(SEARCH_ADMITTED_CITATION_MAX).superRefine((citations, context) => {
  const citationIds = new Set<string>()
  let characterCount = 0
  let byteCount = 0
  for (const citation of citations) {
    if (citationIds.has(citation.citationId)) {
      context.addIssue({ code: 'custom', message: `Duplicate admitted citation ${citation.citationId}.`, path: ['citations'] })
    }
    citationIds.add(citation.citationId)
    characterCount += citation.contentCharacterCount
    byteCount += citation.contentByteCount
  }
  if (characterCount > SEARCH_ADMITTED_CITATION_MAX_CHARACTERS) {
    context.addIssue({ code: 'custom', message: `Admitted citations exceed the ${SEARCH_ADMITTED_CITATION_MAX_CHARACTERS}-character aggregate limit.`, path: ['citations'] })
  }
  if (byteCount > SEARCH_ADMITTED_CITATION_MAX_BYTES) {
    context.addIssue({ code: 'custom', message: `Admitted citations exceed the ${SEARCH_ADMITTED_CITATION_MAX_BYTES}-byte aggregate limit.`, path: ['citations'] })
  }
})

export type AdmittedSearchCitations = z.infer<typeof admittedSearchCitationsSchema>

export function parseAdmittedSearchCitations(input: unknown): AdmittedSearchCitations {
  return admittedSearchCitationsSchema.parse(input)
}

export const searchFetchRequestSchema = z.object({
  resultId: identifierSchema,
  expectedWorkspaceRevision: nonNegativeIntegerSchema,
  expectedContentHash: digestSchema,
  maxCharacters: z.number().int().min(1).max(SEARCH_PASSAGE_MAX_CHARACTERS).default(SEARCH_PASSAGE_MAX_CHARACTERS),
}).strict()

export type SearchFetchRequest = z.input<typeof searchFetchRequestSchema>
export type ParsedSearchFetchRequest = z.output<typeof searchFetchRequestSchema>

export function parseSearchFetchRequest(input: unknown): ParsedSearchFetchRequest {
  return searchFetchRequestSchema.parse(input)
}

export type SearchFreshness =
  | { fresh: true }
  | { fresh: false; reason: 'workspace-revision-changed' | 'source-content-changed' | 'source-removed' | 'index-rebuild-required' }

export function assessSearchFreshness(
  provenance: Pick<SearchProvenance, 'workspaceRevision' | 'contentHash'>,
  current: { workspaceRevision: number; contentHash?: string; sourceExists?: boolean; indexReady?: boolean },
): SearchFreshness {
  if (current.sourceExists === false) return { fresh: false, reason: 'source-removed' }
  if (current.indexReady === false) return { fresh: false, reason: 'index-rebuild-required' }
  if (provenance.workspaceRevision !== current.workspaceRevision) return { fresh: false, reason: 'workspace-revision-changed' }
  if (current.contentHash !== undefined && provenance.contentHash !== current.contentHash) {
    return { fresh: false, reason: 'source-content-changed' }
  }
  return { fresh: true }
}

export function boundedSearchText(
  text: string,
  maxCharacters: number,
  maxBytes: number,
) {
  let result = ''
  let characterCount = 0
  let byteCount = 0
  for (const character of text) {
    if (characterCount >= maxCharacters) break
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (byteCount + characterBytes > maxBytes) break
    result += character
    characterCount += 1
    byteCount += characterBytes
  }
  return {
    text: result,
    characterCount,
    byteCount,
    truncated: characterCount < codePointCount(text),
  }
}

export function hashSearchContent(text: string) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

export function trustForNode(node: Pick<ClarityNode, 'origin'>): SearchTrust {
  const origin = node.origin ?? 'unknown'
  if (origin === 'human') return { label: 'human', effectiveAuthor: 'human', verified: true }
  if (origin === 'approved-ai') return { label: 'approved-ai', effectiveAuthor: 'ai', verified: true }
  if (origin === 'imported-unverified') return { label: 'imported-unverified', effectiveAuthor: 'unknown', verified: false }
  return { label: 'unknown', effectiveAuthor: 'unknown', verified: false }
}

export function trustForAnnotation(annotation: Pick<ClarityAnnotation, 'author' | 'origin' | 'declaredAuthor'>): SearchTrust {
  if (annotation.origin === 'imported-unverified') {
    return {
      label: 'imported-unverified',
      effectiveAuthor: annotation.author,
      declaredAuthor: annotation.declaredAuthor,
      verified: false,
    }
  }
  if (annotation.author === 'human') return { label: 'human', effectiveAuthor: 'human', verified: true }
  if (annotation.author === 'ai') return { label: 'native-ai', effectiveAuthor: 'ai', verified: true }
  if (annotation.author === 'system') return { label: 'native-system', effectiveAuthor: 'system', verified: true }
  return { label: 'unknown', effectiveAuthor: 'unknown', verified: false }
}

export class SearchContractError extends Error {
  constructor(readonly code:
    | 'SEARCH_QUERY_EMPTY'
    | 'SEARCH_QUERY_TOO_LONG'
    | 'SEARCH_QUERY_TOO_MANY_TERMS'
    | 'SEARCH_QUERY_CONTROL_CHARACTER'
    | 'SEARCH_QUERY_BUDGET_EXCEEDED'
    | 'SEARCH_RESPONSE_TOO_LARGE', message: string) {
    super(message)
    this.name = 'SearchContractError'
  }
}

export const SEARCH_CONTRACT_NOTES = Object.freeze({
  queryMode: 'plain-text',
  sourceDataIsUntrusted: true,
  unsupportedArtifactsAreNeverSearchable: true,
  searchIndexIsDerived: true,
  staleResultsMustBeRejected: true,
})
