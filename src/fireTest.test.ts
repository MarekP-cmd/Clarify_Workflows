import { describe, expect, it } from 'vitest'
import type { WorkEdge, WorkNode } from './domain'
import { parseGraphSnapshot } from './graphValidation'
import { CLARITY_NODE_MIME, parseDroppedWorkNode, workNodeFromFile } from './nodePayload'
import { createClarityJsonLd } from './schemaExport'
import { isValidNodeData } from './nodeValidation'

function createLargeGraph(size: number) {
  const nodes: WorkNode[] = Array.from({ length: size }, (_, index) => ({
    id: `stress-node-${index}`,
    type: 'workNode',
    position: { x: (index % 50) * 240, y: Math.floor(index / 50) * 160 },
    data: {
      title: `Stress item ${index}`,
      kind: index === 0 ? 'dataset' : index % 7 === 0 ? 'hypothesis' : 'paper',
      description: 'Synthetic release-hardening fixture.',
      schemaType: index === 0 ? 'Dataset' : index % 7 === 0 ? 'Thing' : 'ScholarlyArticle',
      status: 'verified',
      tags: ['fire-test'],
      provenance: 'Automated fire test',
      evidenceCount: 1,
    },
  }))
  const edges: WorkEdge[] = Array.from({ length: size - 1 }, (_, index) => ({
    id: `stress-edge-${index}`,
    source: nodes[index].id,
    target: nodes[index + 1].id,
    type: 'relation',
    data: { relation: 'informs' },
  }))
  return { nodes, edges }
}

describe('release fire test', () => {
  it('validates and exports a 2,500-node graph within the renderer budget', () => {
    const startedAt = performance.now()
    const graph = createLargeGraph(2500)
    expect(parseGraphSnapshot(graph)).not.toBeNull()

    const jsonLd = createClarityJsonLd(graph.nodes, graph.edges, '2026-08-10T00:00:00.000Z')
    expect(jsonLd['@graph']).toHaveLength(4999)

    expect(performance.now() - startedAt).toBeLessThan(5000)
  })

  it('rejects malformed, oversized, and capability-injected drag payloads without throwing', () => {
    expect(CLARITY_NODE_MIME).toBe('application/x-clarity-workflows-node+json')
    for (let index = 0; index < 500; index += 1) {
      expect(() => parseDroppedWorkNode(index % 2 === 0 ? `{bad-json-${index}` : JSON.stringify({ id: `bad-${index}` }))).not.toThrow()
    }
    expect(parseDroppedWorkNode('x'.repeat(250_001))).toBeNull()
    expect(parseDroppedWorkNode(JSON.stringify({
      id: 'injected',
      type: 'workNode',
      position: { x: 0, y: 0 },
      data: { title: 'Injected', kind: 'agent', description: '', schemaType: 'Action', status: 'candidate', tags: [], provenance: 'Unknown', execute: 'rm -rf' },
    }))).toBeNull()
  })

  it('turns an operating-system file drop into a validated graph item', () => {
    const file = new File(['col_a,col_b\n1,2'], 'research-data.csv', { type: 'text/csv' })
    const node = workNodeFromFile(file, { x: 120, y: 240 })
    expect(node.data.kind).toBe('dataset')
    expect(node.data.schemaType).toBe('Dataset')
    expect(node.data.provenance).toContain('research-data.csv')
    expect(isValidNodeData(node.data)).toBe(true)
    expect(parseGraphSnapshot({ nodes: [node, { ...node, id: 'dataset-copy' }], edges: [] })).not.toBeNull()
  })
})
