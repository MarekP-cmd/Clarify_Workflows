import { describe, expect, it } from 'vitest'
import { testEdges, testNodes } from './test/graphFixtures'
import { createClarityJsonLd } from './schemaExport'

describe('Schema.org JSON-LD export', () => {
  it('combines Schema.org types with Clarity workflow semantics', () => {
    const graph = createClarityJsonLd(testNodes, testEdges, '2026-08-10T00:00:00.000Z')
    expect(graph['@context']).toEqual({ schema: 'https://schema.org/', cw: 'urn:clarity-workflows:' })
    expect(graph['@graph']).toHaveLength(testNodes.length + testEdges.length)

    const serialized = JSON.stringify(graph)
    expect(serialized).toContain('https://schema.org/Dataset')
    expect(serialized).toContain('urn:clarity-workflows:Dataset')
    expect(serialized).toContain('cw:Relationship')
    expect(serialized).toContain('2026-08-10T00:00:00.000Z')
  })
})
