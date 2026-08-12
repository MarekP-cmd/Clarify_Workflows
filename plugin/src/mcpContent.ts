import type { ClarityArtifact, ExtractedArtifactContent } from './types.js'

/** Maximum number of artifact summaries returned by one workspace projection. */
export const MAX_PUBLIC_ARTIFACTS = 200
/** Maximum number of summaries returned by one artifact page. */
export const MAX_MCP_ARTIFACT_PAGE_SIZE = 100
/** Maximum relationships and annotations returned by one node inspection. */
export const MAX_MCP_INSPECT_ITEMS = 100
/** Maximum extracted characters returned by one MCP content read. */
export const MAX_MCP_EXTRACTED_CONTENT_CHARACTERS = 100_000
/** Maximum UTF-8 bytes returned by one MCP content read. */
export const MAX_MCP_EXTRACTED_CONTENT_BYTES = 400_000

export type ArtifactPage = {
  workspaceId: string
  artifacts: ClarityArtifact[]
  totalCount: number
  nextCursor: string | null
}

/**
 * General graph/workflow views expose artifact metadata and extraction state,
 * never the extracted body itself. Content is available only through the
 * bounded, explicit artifact-content tool.
 */
export function publicArtifactSummary(artifact: ClarityArtifact): ClarityArtifact {
  const { extractedText: _extractedText, ...summary } = artifact
  return summary
}

function boundedUtf8Prefix(text: string, maxCharacters: number, maxBytes: number) {
  let result = ''
  let characters = 0
  let bytes = 0
  for (const character of text) {
    if (characters >= maxCharacters) break
    const characterBytes = Buffer.byteLength(character, 'utf8')
    if (bytes + characterBytes > maxBytes) break
    result += character
    characters += 1
    bytes += characterBytes
  }
  return { text: result, characters, bytes }
}

export function boundedExtractedArtifactContent(
  artifact: ClarityArtifact,
  maxCharacters = MAX_MCP_EXTRACTED_CONTENT_CHARACTERS,
): ExtractedArtifactContent | null {
  if (artifact.extractionStatus !== 'extracted' || artifact.extractedText === undefined || !artifact.extractionFormat) return null
  const totalText = artifact.extractedText
  const totalCharacterCount = Array.from(totalText).length
  const totalByteCount = Buffer.byteLength(totalText, 'utf8')
  const bounded = boundedUtf8Prefix(
    totalText,
    Math.min(maxCharacters, MAX_MCP_EXTRACTED_CONTENT_CHARACTERS),
    MAX_MCP_EXTRACTED_CONTENT_BYTES,
  )
  return {
    workspaceId: artifact.workspaceId,
    artifactId: artifact.id,
    nodeId: artifact.nodeId,
    originalName: artifact.originalName,
    mimeType: artifact.mimeType,
    extractionStatus: 'extracted',
    extractionFormat: artifact.extractionFormat,
    sourceSha256: artifact.sha256,
    totalByteCount,
    totalCharacterCount,
    returnedByteCount: bounded.bytes,
    returnedCharacterCount: bounded.characters,
    truncated: bounded.characters < totalCharacterCount,
    content: bounded.text,
  }
}
