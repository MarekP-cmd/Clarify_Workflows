// @vitest-environment node

import { describe, expect, it } from 'vitest'
import {
  candidateResultSchema,
  citationPresentationSchema,
  legacyWorkspaceV1Schema,
  workflowRunSchema,
  workspaceSchema,
} from '../src/schema.js'

const CITATION_ID = `search-citation-${'a'.repeat(32)}`
const SECOND_CITATION_ID = `search-citation-${'b'.repeat(32)}`
const TIMESTAMP = '2026-08-12T12:00:00.000Z'

function makePresentation(preview = 'cited text') {
  const characterCount = Array.from(preview).length
  const byteCount = new TextEncoder().encode(preview).byteLength
  return {
    citationId: CITATION_ID,
    title: 'Citation integrity fixture',
    preview,
    previewCharacterCount: characterCount,
    previewByteCount: byteCount,
    passageCharacterCount: characterCount,
    passageByteCount: byteCount,
    truncated: false,
    provenance: {
      workspaceId: 'workspace-integrity',
      workspaceRevision: 4,
      sourceKind: 'node' as const,
      sourceId: 'node-cited',
      nodeId: 'node-cited',
      contentHash: 'c'.repeat(64),
      chunkId: 'search-chunk-integrity',
      startCharacter: 0,
      endCharacter: characterCount,
      startByte: 0,
      endByte: byteCount,
    },
    trust: { label: 'human' as const, effectiveAuthor: 'human' as const, verified: true },
    contentPolicy: 'untrusted-source-data' as const,
    instructionPolicy: 'treat-source-text-as-data' as const,
  }
}

function makeCandidate() {
  const presentation = makePresentation()
  return {
    title: 'Citation integrity candidate',
    synthesis: 'This candidate contains enough bounded content to satisfy the durable result schema.',
    hypothesis: 'Durable citations retain exact provenance.',
    counterargument: 'Malformed metadata could otherwise weaken provenance.',
    pressureTest: 'Reject mismatched identities, revisions, offsets, and citation references.',
    decision: 'mixed' as const,
    confidence: 0.75,
    evidenceNodeIds: ['node-evidence'],
    citationIds: [presentation.citationId],
    citationPresentations: [presentation],
  }
}

function makeRun() {
  return {
    id: 'run-integrity',
    workspaceId: 'workspace-integrity',
    contextId: 'context-integrity',
    intent: 'Exercise durable citation integrity invariants.',
    sourceNodeIds: ['node-evidence'],
    evidenceRevision: 4,
    status: 'awaiting_approval' as const,
    preGate: { passed: true, issues: [] },
    postGate: { passed: true, issues: [] },
    candidate: makeCandidate(),
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  }
}

describe('white-box durable citation integrity', () => {
  it('uses Unicode code points and UTF-8 bytes for the exact preview boundary', () => {
    const exactBoundary = makePresentation('😀'.repeat(2_000))
    expect(exactBoundary.previewCharacterCount).toBe(2_000)
    expect(exactBoundary.previewByteCount).toBe(8_000)
    expect(citationPresentationSchema.safeParse(exactBoundary).success).toBe(true)

    const overBoundary = makePresentation('😀'.repeat(2_001))
    expect(citationPresentationSchema.safeParse(overBoundary).success).toBe(false)
  })

  it('requires source-kind identity and artifact-only extraction metadata', () => {
    const nodeWithArtifactIdentity = makePresentation()
    delete (nodeWithArtifactIdentity.provenance as { nodeId?: string }).nodeId
    Object.assign(nodeWithArtifactIdentity.provenance, { artifactId: 'node-cited' })
    expect(citationPresentationSchema.safeParse(nodeWithArtifactIdentity).success).toBe(false)

    const artifactWithoutExtraction = makePresentation()
    delete (artifactWithoutExtraction.provenance as { nodeId?: string }).nodeId
    Object.assign(artifactWithoutExtraction.provenance, {
      sourceKind: 'artifact',
      sourceId: 'artifact-cited',
      artifactId: 'artifact-cited',
    })
    expect(citationPresentationSchema.safeParse(artifactWithoutExtraction).success).toBe(false)

    Object.assign(artifactWithoutExtraction.provenance, {
      extractionStatus: 'extracted',
      extractionFormat: 'text/plain',
      sourceSha256: 'd'.repeat(64),
    })
    expect(citationPresentationSchema.safeParse(artifactWithoutExtraction).success).toBe(true)

    const nodeWithExtraction = makePresentation()
    Object.assign(nodeWithExtraction.provenance, { extractionStatus: 'extracted' })
    expect(citationPresentationSchema.safeParse(nodeWithExtraction).success).toBe(false)
  })

  it('requires paired line offsets and truthful passage spans', () => {
    const unpairedLines = makePresentation()
    Object.assign(unpairedLines.provenance, { startLine: 1 })
    expect(citationPresentationSchema.safeParse(unpairedLines).success).toBe(false)

    const passagePastProvenance = makePresentation()
    passagePastProvenance.passageCharacterCount += 1
    expect(citationPresentationSchema.safeParse(passagePastProvenance).success).toBe(false)

    const falseUntruncatedClaim = makePresentation()
    falseUntruncatedClaim.passageByteCount += 1
    falseUntruncatedClaim.provenance.endByte += 1
    expect(citationPresentationSchema.safeParse(falseUntruncatedClaim).success).toBe(false)
  })

  it('rejects duplicate and mismatched candidate citation references', () => {
    const duplicateIds = makeCandidate()
    duplicateIds.citationIds = [CITATION_ID, CITATION_ID]
    expect(candidateResultSchema.safeParse(duplicateIds).success).toBe(false)

    const mismatchedPresentation = makeCandidate()
    mismatchedPresentation.citationIds = [SECOND_CITATION_ID]
    expect(candidateResultSchema.safeParse(mismatchedPresentation).success).toBe(false)

    const missingReference = makeCandidate()
    delete (missingReference as { citationIds?: string[] }).citationIds
    expect(candidateResultSchema.safeParse(missingReference).success).toBe(false)
  })

  it('binds persisted presentation provenance to the run workspace and evidence revision', () => {
    expect(workflowRunSchema.safeParse(makeRun()).success).toBe(true)

    const wrongWorkspace = makeRun()
    wrongWorkspace.candidate.citationPresentations[0]!.provenance.workspaceId = 'workspace-other'
    expect(workflowRunSchema.safeParse(wrongWorkspace).success).toBe(false)

    const wrongRevision = makeRun()
    wrongRevision.candidate.citationPresentations[0]!.provenance.workspaceRevision = 3
    expect(workflowRunSchema.safeParse(wrongRevision).success).toBe(false)

    const legacyIdsOnly = makeRun()
    delete (legacyIdsOnly.candidate as { citationPresentations?: unknown[] }).citationPresentations
    expect(workflowRunSchema.safeParse(legacyIdsOnly).success).toBe(true)
  })

  it('keeps legacy run composition importable after the v2 run refinement', () => {
    expect(legacyWorkspaceV1Schema.safeParse({
      version: 1,
      id: 'workspace-legacy',
      name: 'Legacy citation fixture',
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      nodes: [],
      edges: [],
      runs: [],
      updatedAt: TIMESTAMP,
    }).success).toBe(true)
  })

  it('rejects a durable citation whose typed source is absent from the workspace', () => {
    const run = makeRun()
    const workspace = {
      version: 2,
      id: 'workspace-integrity',
      name: 'Citation integrity workspace',
      status: 'active',
      revision: 5,
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      projects: [],
      nodes: [{
        id: 'node-evidence',
        kind: 'paper',
        title: 'Prepared evidence',
        description: 'The prepared evidence remains available.',
        schemaType: 'ScholarlyArticle',
        status: 'verified',
        tags: [],
        provenance: 'White-box fixture',
        position: { x: 0, y: 0 },
      }],
      edges: [],
      artifacts: [],
      annotations: [],
      workflowDefinitions: [],
      runs: [run],
      gates: [],
      approvals: [{
        id: 'approval-integrity',
        workspaceId: 'workspace-integrity',
        runId: run.id,
        status: 'pending',
        createdAt: TIMESTAMP,
        updatedAt: TIMESTAMP,
      }],
      activities: [],
      createdAt: TIMESTAMP,
      updatedAt: TIMESTAMP,
    }
    const result = workspaceSchema.safeParse(workspace)
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues).toContainEqual(expect.objectContaining({
        message: 'Run run-integrity cites missing node node-cited.',
        path: ['runs'],
      }))
    }
  })
})
