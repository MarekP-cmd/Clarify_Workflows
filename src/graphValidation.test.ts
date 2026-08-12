import { describe, expect, it } from 'vitest'
import { isWorkEdge, isWorkNode, parseGraphSnapshot } from './graphValidation'
import { testEdges, testNodes } from './test/graphFixtures'

describe('renderer graph boundary validation', () => {
  const makeNode = (index: number) => ({
    ...testNodes[0],
    id: `boundary-node-${index}`,
    position: { ...testNodes[0].position },
    data: { ...testNodes[0].data, tags: [...testNodes[0].data.tags] },
  })

  const makeEdge = (index: number) => ({
    ...testEdges[0],
    id: `boundary-edge-${index}`,
    source: testNodes[0].id,
    target: testNodes[1].id,
    data: { ...testEdges[0].data },
  })

  it('accepts the bounded synthetic test graph', () => {
    expect(parseGraphSnapshot({ nodes: testNodes, edges: testEdges })).toEqual({ nodes: testNodes, edges: testEdges })
  })

  it('rejects duplicate identities and dangling relationships', () => {
    expect(parseGraphSnapshot({ nodes: [testNodes[0], structuredClone(testNodes[0])], edges: [] })).toBeNull()
    expect(parseGraphSnapshot({ nodes: testNodes, edges: [testEdges[0], structuredClone(testEdges[0])] })).toBeNull()
    expect(parseGraphSnapshot({ nodes: testNodes, edges: [{ ...testEdges[0], target: 'missing' }] })).toBeNull()
  })

  it('rejects malformed positions, types, and injected capabilities', () => {
    expect(isWorkNode(null)).toBe(false)
    expect(isWorkNode('node')).toBe(false)
    expect(isWorkNode({ ...testNodes[0], id: ' '.repeat(4) })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], id: 'x'.repeat(160) })).toBe(true)
    expect(isWorkNode({ ...testNodes[0], id: 'x'.repeat(161) })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: null })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: '0', y: 0 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: Number.NaN, y: 0 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: Number.POSITIVE_INFINITY, y: 0 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: 100_000, y: -100_000 } })).toBe(true)
    expect(isWorkNode({ ...testNodes[0], position: { x: 100_001, y: 0 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: -100_001, y: 0 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: 0, y: '0' } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: 0, y: Number.NaN } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: 0, y: Number.NEGATIVE_INFINITY } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: 0, y: 100_001 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], position: { x: 0, y: -100_001 } })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], type: 'executable' })).toBe(false)
    expect(isWorkNode({ ...testNodes[0], data: { ...testNodes[0].data, execute: 'command' } })).toBe(false)
  })

  it('validates edge fields and preserves optional core metadata', () => {
    const timestamp = '2026-08-11T00:00:00.000Z'
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, projectId: 'project-a', createdAt: timestamp, updatedAt: timestamp } })).toBe(true)
    expect(isWorkEdge(null)).toBe(false)
    expect(isWorkEdge('edge')).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: null })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: [] })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: 'informs' })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], id: ' '.repeat(4) })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], id: 'x'.repeat(200) })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], id: 'x'.repeat(201) })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], source: 'x'.repeat(160) })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], source: 'x'.repeat(161) })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], target: ' '.repeat(4) })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], target: 'x'.repeat(160) })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], target: 'x'.repeat(161) })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], type: 'smoothstep' })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, projectId: ' '.repeat(4) } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, projectId: 'x'.repeat(160) } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, projectId: 'x'.repeat(161) } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { relation: '' } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { relation: ' '.repeat(4) } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { relation: 'x'.repeat(200) } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { relation: 'x'.repeat(201) } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { relation: 1 } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, color: '' } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, color: 'x'.repeat(100) } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, color: 'x'.repeat(101) } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, color: 1 } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, dashed: true } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, dashed: false } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, dashed: 'false' } })).toBe(false)
    const exactTimestamp = `2026-08-11${' '.repeat(90)}`
    const oversizedTimestamp = `2026-08-11${' '.repeat(91)}`
    expect(exactTimestamp).toHaveLength(100)
    expect(oversizedTimestamp).toHaveLength(101)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, createdAt: exactTimestamp, updatedAt: exactTimestamp } })).toBe(true)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, createdAt: oversizedTimestamp } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, updatedAt: 1 } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { ...testEdges[0].data, createdAt: 'not-a-date' } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], data: { relation: 'informs', execute: true } })).toBe(false)
    expect(isWorkEdge({ ...testEdges[0], source: '' })).toBe(false)
  })

  it('accepts the exact graph cardinality limits and rejects one valid item over each limit', () => {
    const maximumNodes = Array.from({ length: 5_000 }, (_, index) => makeNode(index))
    const tooManyNodes = [...maximumNodes, makeNode(5_000)]
    const maximumEdges = Array.from({ length: 15_000 }, (_, index) => makeEdge(index))
    const tooManyEdges = [...maximumEdges, makeEdge(15_000)]

    const acceptedNodes = parseGraphSnapshot({ nodes: maximumNodes, edges: [] })
    expect(acceptedNodes?.nodes).toBe(maximumNodes)
    expect(acceptedNodes?.edges).toEqual([])
    expect(parseGraphSnapshot({ nodes: tooManyNodes, edges: [] })).toBeNull()

    const acceptedEdges = parseGraphSnapshot({ nodes: testNodes, edges: maximumEdges })
    expect(acceptedEdges?.nodes).toBe(testNodes)
    expect(acceptedEdges?.edges).toBe(maximumEdges)
    expect(parseGraphSnapshot({ nodes: testNodes, edges: tooManyEdges })).toBeNull()
  })

  it('rejects invalid nodes and invalid edges independently inside an otherwise valid graph', () => {
    const malformedNode = { ...testNodes[0], position: { x: 0, y: Number.NaN } }
    const malformedEdge = { ...testEdges[0], data: { ...testEdges[0].data, relation: '' } }
    expect(parseGraphSnapshot({ nodes: [malformedNode], edges: [] })).toBeNull()
    expect(parseGraphSnapshot({ nodes: testNodes, edges: [malformedEdge] })).toBeNull()
    expect(parseGraphSnapshot({ nodes: testNodes, edges: [{ ...testEdges[0], source: 'missing' }] })).toBeNull()
  })

  it.each([null, undefined, false, 1, 'graph', [], {}, { nodes: [], edges: null }, { nodes: null, edges: [] }])(
    'fails malformed snapshots without throwing %#',
    (candidate) => {
      expect(() => parseGraphSnapshot(candidate)).not.toThrow()
      expect(parseGraphSnapshot(candidate)).toBeNull()
    },
  )
})
