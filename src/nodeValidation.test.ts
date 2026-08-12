import { describe, expect, it } from 'vitest'
import { isValidNodeData } from './nodeValidation'
import { testNodes } from './test/graphFixtures'

describe('renderer node-contract validation', () => {
  const valid = testNodes[0].data

  it('accepts canonical node data and optional authoritative metadata', () => {
    expect(isValidNodeData(valid)).toBe(true)
    expect(isValidNodeData({
      ...valid,
      projectId: 'project-a',
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T01:00:00.000Z',
    })).toBe(true)
  })

  it.each([
    ['empty title', { title: '' }],
    ['unknown kind', { kind: 'executable' }],
    ['unknown status', { status: 'trusted-by-default' }],
    ['negative evidence count', { evidenceCount: -1 }],
    ['invalid timestamp', { createdAt: 'yesterday' }],
    ['extra capability', { execute: 'arbitrary-command' }],
  ])('rejects the %s mutation', (_label, mutation) => {
    expect(isValidNodeData({ ...valid, ...mutation })).toBe(false)
  })

  it('enforces the shared field limits', () => {
    expect(isValidNodeData({ ...valid, title: 'x' })).toBe(true)
    expect(isValidNodeData({ ...valid, title: ' '.repeat(4) })).toBe(false)
    expect(isValidNodeData({ ...valid, title: 'x'.repeat(500) })).toBe(true)
    expect(isValidNodeData({ ...valid, title: 'x'.repeat(501) })).toBe(false)
    expect(isValidNodeData({ ...valid, description: '' })).toBe(true)
    expect(isValidNodeData({ ...valid, description: 'x'.repeat(10_000) })).toBe(true)
    expect(isValidNodeData({ ...valid, description: 'x'.repeat(10_001) })).toBe(false)
    expect(isValidNodeData({ ...valid, schemaType: ' '.repeat(4) })).toBe(false)
    expect(isValidNodeData({ ...valid, schemaType: 'x'.repeat(200) })).toBe(true)
    expect(isValidNodeData({ ...valid, schemaType: 'x'.repeat(201) })).toBe(false)
    expect(isValidNodeData({ ...valid, tags: [] })).toBe(true)
    expect(isValidNodeData({ ...valid, tags: Array.from({ length: 100 }, () => 'tag') })).toBe(true)
    expect(isValidNodeData({ ...valid, tags: Array.from({ length: 101 }, () => 'tag') })).toBe(false)
    expect(isValidNodeData({ ...valid, tags: [''] })).toBe(true)
    expect(isValidNodeData({ ...valid, tags: ['x'.repeat(200)] })).toBe(true)
    expect(isValidNodeData({ ...valid, tags: ['valid', 'x'.repeat(201)] })).toBe(false)
    expect(isValidNodeData({ ...valid, tags: 'tag' })).toBe(false)
    expect(isValidNodeData({ ...valid, provenance: ' '.repeat(4) })).toBe(false)
    expect(isValidNodeData({ ...valid, provenance: 'x'.repeat(2_000) })).toBe(true)
    expect(isValidNodeData({ ...valid, provenance: 'x'.repeat(2_001) })).toBe(false)
    expect(isValidNodeData({ ...valid, evidenceCount: 0 })).toBe(true)
    expect(isValidNodeData({ ...valid, evidenceCount: 10_000_000 })).toBe(true)
    expect(isValidNodeData({ ...valid, evidenceCount: 10_000_001 })).toBe(false)
    expect(isValidNodeData({ ...valid, evidenceCount: 1.5 })).toBe(false)
    expect(isValidNodeData({ ...valid, evidenceCount: Number.NaN })).toBe(false)
    expect(isValidNodeData({ ...valid, evidenceCount: Number.POSITIVE_INFINITY })).toBe(false)
    expect(isValidNodeData({ ...valid, evidenceCount: '1' })).toBe(false)
    expect(isValidNodeData({ ...valid, projectId: ' '.repeat(4) })).toBe(false)
    expect(isValidNodeData({ ...valid, projectId: 'x'.repeat(160) })).toBe(true)
    expect(isValidNodeData({ ...valid, projectId: 'x'.repeat(161) })).toBe(false)
  })

  it('validates every optional field when present instead of trusting its shape', () => {
    const exactTimestamp = `2026-08-11${' '.repeat(90)}`
    const oversizedTimestamp = `2026-08-11${' '.repeat(91)}`
    expect(exactTimestamp).toHaveLength(100)
    expect(oversizedTimestamp).toHaveLength(101)

    expect(isValidNodeData({
      ...valid,
      humanAnnotation: '',
      aiAnnotation: 'AI note',
      priority: 'high',
      pinned: false,
      sourceUri: '',
      instruction: '',
      agentMode: 'execute',
      createdAt: exactTimestamp,
      updatedAt: exactTimestamp,
    })).toBe(true)

    const invalidOptionals = [
      { humanAnnotation: 'x'.repeat(50_001) },
      { aiAnnotation: 'x'.repeat(50_001) },
      { priority: 'urgent' },
      { pinned: 'false' },
      { sourceUri: 'x'.repeat(4_001) },
      { instruction: 'x'.repeat(50_001) },
      { agentMode: 'unbounded' },
      { createdAt: oversizedTimestamp },
      { updatedAt: '' },
      { updatedAt: 1 },
    ]
    for (const mutation of invalidOptionals) {
      expect(isValidNodeData({ ...valid, ...mutation }), JSON.stringify(Object.keys(mutation))).toBe(false)
    }
  })

  it.each([null, undefined, {}, [], { title: 'partial' }])('fails malformed input without throwing %#', (candidate) => {
    expect(() => isValidNodeData(candidate)).not.toThrow()
    expect(isValidNodeData(candidate)).toBe(false)
  })
})
