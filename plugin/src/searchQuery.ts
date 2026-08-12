import {
  boundedSearchText,
  parseSearchResultPage,
  SearchContractError,
  SEARCH_MAX_MATCH_RANGES,
  SEARCH_QUERY_MAX_CANDIDATES,
  SEARCH_QUERY_SCAN_MAX_CHARACTERS,
  SEARCH_RESULT_PAGE_MAX,
  type SearchQuery,
  type SearchResult,
  type SearchResultPage,
} from './searchContract.js'
import type { SearchIndexChunk, SearchIndexDocument, SearchIndexSnapshot } from './searchIndex.js'

/** Metadata resolved from authoritative graph records for filter evaluation.
 * The disposable index deliberately does not duplicate project membership. */
export type SearchSourceMetadata = {
  nodeId?: string
  projectId?: string
}

export type SearchQueryExecutionInput = {
  workspaceId: string
  workspaceRevision: number
  index: SearchIndexSnapshot
  sourceMetadata: Map<string, SearchSourceMetadata>
}

type MatchRange = { startCharacter: number; endCharacter: number }
type FoldedSearchText = {
  haystack: string
  foldedStartToSource: number[]
  foldedEndToSource: number[]
}

const SOURCE_KIND_ORDER = new Map([
  ['node', 0],
  ['annotation', 1],
  ['artifact', 2],
])

function sourceKey(document: Pick<SearchIndexDocument, 'sourceKind' | 'sourceId'>) {
  return `${document.sourceKind}\u0000${document.sourceId}`
}

function foldSearchText(text: string): FoldedSearchText {
  const sourceCharacters = Array.from(text)
  let haystack = ''
  const foldedStartToSource = [] as number[]
  const foldedEndToSource = [] as number[]
  sourceCharacters.forEach((character, sourceIndex) => {
    const foldedCharacter = character.toLocaleLowerCase('en-US')
    haystack += foldedCharacter
    for (let index = 0; index < foldedCharacter.length; index += 1) {
      foldedStartToSource.push(sourceIndex)
      foldedEndToSource.push(sourceIndex + 1)
    }
  })
  return { haystack, foldedStartToSource, foldedEndToSource }
}

function scanLiteral(folded: FoldedSearchText, term: string, rangeLimit = SEARCH_MAX_MATCH_RANGES) {
  if (!term) return { count: 0, ranges: [] as MatchRange[] }
  const needle = Array.from(term).map((character) => character.toLocaleLowerCase('en-US')).join('')
  const ranges: MatchRange[] = []
  let count = 0
  let offset = 0
  while (offset <= folded.haystack.length - needle.length) {
    const match = folded.haystack.indexOf(needle, offset)
    if (match < 0) break
    const end = match + needle.length
    const startCharacter = folded.foldedStartToSource[match]
    const endCharacter = folded.foldedEndToSource[end - 1]
    if (startCharacter === undefined || endCharacter === undefined) break
    count += 1
    if (ranges.length < rangeLimit) ranges.push({ startCharacter, endCharacter })
    // Advance by one UTF-16 unit so overlapping occurrences are deterministic
    // and no query term can hide a second match.
    offset = match + 1
  }
  return { count, ranges }
}

function uniqueRanges(ranges: MatchRange[]) {
  const seen = new Set<string>()
  return ranges
    .filter((range) => {
      const key = `${range.startCharacter}:${range.endCharacter}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .sort((left, right) => left.startCharacter - right.startCharacter || left.endCharacter - right.endCharacter)
}

function sourceMatchesFilters(
  document: SearchIndexDocument,
  query: SearchQuery,
  metadata: SearchSourceMetadata | undefined,
) {
  const scopeKinds = query.scope === 'all'
    ? undefined
    : query.scope === 'nodes'
      ? new Set(['node'])
      : query.scope === 'annotations'
        ? new Set(['annotation'])
        : new Set(['artifact'])
  if (scopeKinds && !scopeKinds.has(document.sourceKind)) return false
  if (query.sourceKinds && !query.sourceKinds.includes(document.sourceKind)) return false
  if (query.trust && !query.trust.includes(document.trust.label)) return false
  if (query.nodeIds && !query.nodeIds.includes(metadata?.nodeId ?? '')) return false
  if (query.projectIds && !query.projectIds.includes(metadata?.projectId ?? '')) return false
  if (query.artifactIds && (document.sourceKind !== 'artifact' || !query.artifactIds.includes(document.sourceId))) return false
  return true
}

function makeSnippet(text: string, ranges: MatchRange[]) {
  const characters = Array.from(text)
  const firstMatch = ranges[0]?.startCharacter ?? 0
  const windowSize = 1_500
  let start = Math.max(0, firstMatch - 375)
  let end = Math.min(characters.length, start + windowSize)
  if (end - start < windowSize) start = Math.max(0, end - windowSize)

  const bounded = boundedSearchText(characters.slice(start, end).join(''), 2_000, 8_000)
  const snippetEnd = start + bounded.characterCount
  const snippetRanges = ranges
    .filter((range) => range.endCharacter > start && range.startCharacter < snippetEnd)
    .slice(0, 32)
    .map((range) => ({
      startCharacter: Math.max(range.startCharacter, start) - start,
      endCharacter: Math.min(range.endCharacter, snippetEnd) - start,
    }))

  return {
    snippet: bounded.text,
    snippetCharacterCount: bounded.characterCount,
    snippetByteCount: bounded.byteCount,
    truncated: start > 0 || snippetEnd < characters.length,
    matchRanges: snippetRanges,
  }
}

function resultForChunk(
  document: SearchIndexDocument,
  chunk: SearchIndexChunk,
  query: SearchQuery,
  terms: string[],
): SearchResult | null {
  const folded = foldSearchText(chunk.text)
  const termRanges: MatchRange[] = []
  let totalTermOccurrences = 0
  for (const term of terms) {
    const scanned = scanLiteral(folded, term, SEARCH_MAX_MATCH_RANGES - termRanges.length)
    if (scanned.count === 0) return null
    totalTermOccurrences += scanned.count
    termRanges.push(...scanned.ranges)
  }
  if (!termRanges.length) return null

  const phraseMatches = scanLiteral(folded, query.query, 0).count
  const titleMatches = scanLiteral(foldSearchText(document.title), query.query, 0).count
  const score = phraseMatches * 100 + totalTermOccurrences + titleMatches * 10
  const snippet = makeSnippet(chunk.text, uniqueRanges(termRanges))
  return {
    resultId: chunk.id,
    rank: 1,
    score,
    title: document.title,
    ...snippet,
    provenance: chunk.provenance,
    trust: chunk.trust,
  }
}

/** Execute plain-text search over one already validated, revision-bound
 * projection. This function has no I/O and never interprets source text as
 * SQL, FTS syntax, or instructions. */
export function executeSearchQuery(
  input: SearchQueryExecutionInput,
  query: SearchQuery,
): SearchResultPage {
  const documents = new Map(input.index.documents.map((document) => [document.id, document]))
  const matches: Array<{ result: SearchResult; sourceKind: string; sourceId: string; sequence: number }> = []
  const terms = [...new Set(query.query.split(' ').filter(Boolean))]
  let scannedCharacters = 0

  for (const chunk of input.index.chunks) {
    const document = documents.get(chunk.documentId)
    if (!document) continue
    if (!sourceMatchesFilters(document, query, input.sourceMetadata.get(sourceKey(document)))) continue
    scannedCharacters += chunk.characterCount * terms.length
    if (scannedCharacters > SEARCH_QUERY_SCAN_MAX_CHARACTERS) {
      throw new SearchContractError(
        'SEARCH_QUERY_BUDGET_EXCEEDED',
        `Search exceeded the deterministic ${SEARCH_QUERY_SCAN_MAX_CHARACTERS}-character scan budget; narrow the filters or query.`,
      )
    }
    const result = resultForChunk(document, chunk, query, terms)
    if (!result) continue
    matches.push({ result, sourceKind: document.sourceKind, sourceId: document.sourceId, sequence: chunk.sequence })
    if (matches.length > SEARCH_QUERY_MAX_CANDIDATES) {
      throw new SearchContractError(
        'SEARCH_QUERY_BUDGET_EXCEEDED',
        `Search exceeded the ${SEARCH_QUERY_MAX_CANDIDATES}-candidate ranking budget; narrow the filters or query.`,
      )
    }
  }

  matches.sort((left, right) => right.result.score - left.result.score
    || (SOURCE_KIND_ORDER.get(left.sourceKind) ?? 99) - (SOURCE_KIND_ORDER.get(right.sourceKind) ?? 99)
    || left.sourceId.localeCompare(right.sourceId)
    || left.sequence - right.sequence)

  const offset = query.cursor ? Number(query.cursor) : 0
  const totalCount = matches.length
  let pageResults = matches.slice(offset, offset + query.limit).map((match) => match.result)
  let responseBudgetTruncated = false

  while (true) {
    const nextCursor = offset + pageResults.length < totalCount ? String(offset + pageResults.length) : null
    try {
      return parseSearchResultPage({
        contractVersion: 1,
        workspaceId: input.workspaceId,
        workspaceRevision: input.workspaceRevision,
        query: query.query,
        results: pageResults.map((result, index) => ({ ...result, rank: index + 1 })),
        totalCount,
        nextCursor,
        truncated: responseBudgetTruncated || nextCursor !== null,
        warnings: [],
      })
    } catch (error) {
      if (!(error instanceof Error) || !('code' in error) || error.code !== 'SEARCH_RESPONSE_TOO_LARGE' || pageResults.length <= 1) throw error
      pageResults = pageResults.slice(0, -1)
      responseBudgetTruncated = true
    }
  }
}

export function parseSearchSourceMetadata(entries: Array<[string, SearchSourceMetadata]>) {
  return new Map(entries)
}

export const SEARCH_EXECUTION_PAGE_MAX = SEARCH_RESULT_PAGE_MAX
