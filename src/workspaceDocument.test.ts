import { describe, expect, it } from 'vitest'
import type { WorkspaceState } from '../plugin/src/types'
import type { WorkEdge, WorkNode } from './domain'
import { testEdges, testNodes } from './test/graphFixtures'
import {
  createClarityWorkspaceDocument,
  createWorkspaceJsonLd,
  parseClarityWorkspaceDocument,
} from './workspaceDocument'

const timestamp = '2026-08-11T12:00:00.000Z'

function workspace(): WorkspaceState {
  return {
    version: 2,
    id: 'workspace-export-test',
    name: 'Export fidelity fixture',
    status: 'active',
    revision: 7,
    schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
    projects: [{ id: 'project-one', workspaceId: 'workspace-export-test', name: 'Project one', description: 'Project description.', status: 'active', createdAt: timestamp, updatedAt: timestamp }],
    nodes: [],
    edges: [],
    artifacts: [],
    annotations: [{ id: 'annotation-one', workspaceId: 'workspace-export-test', nodeId: testNodes[0].id, author: 'human', body: 'A durable note.', createdAt: timestamp, updatedAt: timestamp }],
    activities: [],
    workflowDefinitions: [],
    runs: [],
    gates: [],
    approvals: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  }
}

describe('portable Clarity workspace documents', () => {
  it('exports only the human workspace and never forges run, approval, or artifact contents', () => {
    const source = workspace()
    const document = createClarityWorkspaceDocument(source, testNodes, testEdges, source.annotations, timestamp)
    expect(document).toMatchObject({ format: 'clarity-workspace', version: 1, name: source.name, status: 'active' })
    expect(document.nodes).toHaveLength(testNodes.length)
    expect(document.edges).toHaveLength(testEdges.length)
    expect(JSON.stringify(document)).not.toContain('workflowDefinitions')
    expect(JSON.stringify(document)).not.toContain('approvals')
    expect(JSON.stringify(document)).not.toContain('storageKey')
  })

  it('round-trips every portable field through Clarity Schema.org JSON-LD', () => {
    const fullNodes: WorkNode[] = [
      {
        ...testNodes[0],
        id: 'full-portable-node',
        position: { x: -123.5, y: 987.25 },
        data: {
          ...testNodes[0].data,
          projectId: 'project-one',
          origin: 'imported-unverified',
          title: 'Every portable node field',
          status: 'candidate',
          tags: ['portable', 'all-fields'],
          humanAnnotation: 'Legacy inline human note.',
          aiAnnotation: 'Declared AI text that remains unverified after import.',
          priority: 'high',
          evidenceCount: 17,
          pinned: true,
          sourceUri: 'https://example.test/source',
          instruction: 'Preserve this portable instruction exactly.',
          agentMode: 'verify',
          createdAt: timestamp,
          updatedAt: timestamp,
        },
      },
      { ...testNodes[1], id: 'full-portable-target', data: { ...testNodes[1].data, projectId: 'project-one', origin: 'human' } },
    ]
    const fullEdges: WorkEdge[] = [{
      id: 'full-portable-edge',
      source: fullNodes[0].id,
      target: fullNodes[1].id,
      type: 'relation',
      data: { projectId: 'project-one', relation: 'pressure-tests', color: '#123456', dashed: true, createdAt: timestamp, updatedAt: timestamp },
    }]
    const source = {
      ...workspace(),
      annotations: [{
        id: 'full-portable-annotation',
        workspaceId: 'workspace-export-test',
        nodeId: fullNodes[0].id,
        author: 'human' as const,
        origin: 'imported-unverified' as const,
        declaredAuthor: 'ai' as const,
        body: 'Every portable annotation field.',
        createdAt: timestamp,
        updatedAt: timestamp,
      }],
    }
    const jsonLd = createWorkspaceJsonLd(source, fullNodes, fullEdges, source.annotations, timestamp)
    const parsed = parseClarityWorkspaceDocument(jsonLd)
    const portable = createClarityWorkspaceDocument(source, fullNodes, fullEdges, source.annotations, timestamp)
    expect(parsed).toEqual(portable)
  })

  it('rejects generic JSON-LD instead of pretending it is a Clarity workspace', () => {
    expect(() => parseClarityWorkspaceDocument({ '@context': 'https://schema.org/', '@type': 'Thing' }))
      .toThrow('not a Clarity workspace export')
  })
})
