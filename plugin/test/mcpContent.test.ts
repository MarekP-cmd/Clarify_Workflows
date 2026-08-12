// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  MAX_MCP_EXTRACTED_CONTENT_BYTES,
  MAX_MCP_EXTRACTED_CONTENT_CHARACTERS,
  boundedExtractedArtifactContent,
  publicArtifactSummary,
} from '../src/mcpContent.js'
import type { ClarityArtifact } from '../src/types.js'

function artifact(overrides: Partial<ClarityArtifact> = {}): ClarityArtifact {
  return {
    id: 'artifact-content-test',
    workspaceId: 'workspace-content-test',
    nodeId: 'node-content-test',
    originalName: 'notes.md',
    storageKey: '0123456789abcdef01234567',
    mimeType: 'text/markdown',
    sizeBytes: 20,
    sha256: 'a'.repeat(64),
    status: 'stored',
    extractionStatus: 'extracted',
    extractionFormat: 'text/markdown',
    extractedText: 'hello',
    extractedByteCount: 5,
    extractedCharacterCount: 5,
    extractedLineCount: 1,
    extractedAt: '2026-08-11T00:00:00.000Z',
    createdAt: '2026-08-11T00:00:00.000Z',
    updatedAt: '2026-08-11T00:00:00.000Z',
    ...overrides,
  }
}

describe('bounded MCP artifact content projections', () => {
  it('removes extracted bodies from general artifact summaries', () => {
    const summary = publicArtifactSummary(artifact()) as Record<string, unknown>
    expect(summary).not.toHaveProperty('extractedText')
    expect(summary).toMatchObject({ id: 'artifact-content-test', extractionStatus: 'extracted' })
  })

  it('preserves Unicode characters without splitting a UTF-8 sequence', () => {
    const content = boundedExtractedArtifactContent(artifact({ extractedText: 'A🙂BéC' }), 3)
    expect(content).toMatchObject({ content: 'A🙂B', returnedCharacterCount: 3, returnedByteCount: Buffer.byteLength('A🙂B'), truncated: true })
    expect(content?.content).not.toContain('\uFFFD')
  })

  it('enforces both the character and byte ceilings and reports totals', () => {
    const text = '🙂'.repeat(MAX_MCP_EXTRACTED_CONTENT_CHARACTERS + 2)
    const content = boundedExtractedArtifactContent(artifact({ extractedText: text }))
    expect(content).not.toBeNull()
    expect(content?.returnedCharacterCount).toBeLessThanOrEqual(MAX_MCP_EXTRACTED_CONTENT_CHARACTERS)
    expect(content?.returnedByteCount).toBeLessThanOrEqual(MAX_MCP_EXTRACTED_CONTENT_BYTES)
    expect(content?.totalCharacterCount).toBe(MAX_MCP_EXTRACTED_CONTENT_CHARACTERS + 2)
    expect(content?.totalByteCount).toBe(Buffer.byteLength(text, 'utf8'))
    expect(content?.truncated).toBe(true)
  })

  it('does not manufacture readable content for unsupported or failed extraction states', () => {
    expect(boundedExtractedArtifactContent(artifact({ extractionStatus: 'unsupported', extractedText: undefined, extractionFormat: undefined }))).toBeNull()
    expect(boundedExtractedArtifactContent(artifact({ extractionStatus: 'failed', extractedText: 'should not be readable', extractionFormat: 'text/markdown' }))).toBeNull()
    expect(boundedExtractedArtifactContent(artifact({ extractionStatus: 'pending', extractedText: 'should not be readable', extractionFormat: undefined }))).toBeNull()
  })
})
