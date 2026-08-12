import { createHash } from 'node:crypto'
import {
  boundedSearchText,
  SEARCH_CONTENT_POLICY,
  SEARCH_INSTRUCTION_POLICY,
  searchPassageSchema,
  type SearchFetchRequest,
  type SearchPassage,
} from './searchContract.js'
import type { SearchIndexChunk } from './searchIndex.js'

/** A stable citation identity for a retrieved projection chunk. It identifies
 * the exact workspace revision and indexed content hash, not a mutable title. */
export function createSearchCitationId(
  workspaceId: string,
  workspaceRevision: number,
  resultId: string,
  contentHash: string,
) {
  return `search-citation-${createHash('sha256')
    .update(`${workspaceId}\u0000${workspaceRevision}\u0000${resultId}\u0000${contentHash}`)
    .digest('hex')
    .slice(0, 32)}`
}

/** Build a bounded passage from one validated index chunk. The returned
 * provenance deliberately retains the full indexed content hash and source
 * offsets; `truncated` tells a caller that only a prefix was returned. */
export function buildSearchPassage(input: {
  workspaceId: string
  workspaceRevision: number
  request: SearchFetchRequest
  chunk: SearchIndexChunk
  trust: SearchPassage['trust']
}) {
  const bounded = boundedSearchText(input.chunk.text, input.request.maxCharacters ?? 100_000, 400_000)
  return searchPassageSchema.parse({
    contractVersion: 1,
    citationId: createSearchCitationId(
      input.workspaceId,
      input.workspaceRevision,
      input.request.resultId,
      input.request.expectedContentHash,
    ),
    workspaceId: input.workspaceId,
    workspaceRevision: input.workspaceRevision,
    content: bounded.text,
    contentCharacterCount: bounded.characterCount,
    contentByteCount: bounded.byteCount,
    truncated: bounded.truncated,
    provenance: input.chunk.provenance,
    trust: input.trust,
    contentPolicy: SEARCH_CONTENT_POLICY,
    instructionPolicy: SEARCH_INSTRUCTION_POLICY,
  })
}

export type SearchPassageResult = SearchPassage
