import type { WorkEdge, WorkNode } from '../domain'

/** Synthetic data used only by automated renderer tests. Product startup never imports it. */
export const testNodes: WorkNode[] = [
  {
    id: 'test-paper',
    type: 'workNode',
    position: { x: 80, y: 100 },
    data: {
      title: 'Reliability review fixture',
      kind: 'paper',
      description: 'Synthetic paper metadata for deterministic renderer tests.',
      schemaType: 'ScholarlyArticle',
      status: 'verified',
      tags: ['Test fixture'],
      provenance: 'Generated only for automated tests',
      evidenceCount: 4,
    },
  },
  {
    id: 'test-book',
    type: 'workNode',
    position: { x: 80, y: 300 },
    data: {
      title: 'Systems reference fixture',
      kind: 'book',
      description: 'Synthetic book metadata for deterministic renderer tests.',
      schemaType: 'Book',
      status: 'verified',
      tags: ['Test fixture'],
      provenance: 'Generated only for automated tests',
      evidenceCount: 3,
    },
  },
  {
    id: 'test-dataset',
    type: 'workNode',
    position: { x: 420, y: 260 },
    data: {
      title: 'Outage history fixture',
      kind: 'dataset',
      description: 'Synthetic dataset metadata for deterministic renderer tests.',
      schemaType: 'Dataset',
      status: 'verified',
      tags: ['Test fixture'],
      provenance: 'Generated only for automated tests',
      evidenceCount: 6,
    },
  },
  {
    id: 'test-hypothesis',
    type: 'workNode',
    position: { x: 720, y: 180 },
    data: {
      title: 'Storage may reduce congestion',
      kind: 'hypothesis',
      description: 'Synthetic hypothesis metadata for relationship tests.',
      schemaType: 'Thing',
      status: 'needs-evidence',
      tags: ['Test fixture'],
      provenance: 'Generated only for automated tests',
    },
  },
]

export const testEdges: WorkEdge[] = [
  { id: 'test-edge-paper', source: 'test-paper', target: 'test-hypothesis', type: 'relation', data: { relation: 'informs' } },
  { id: 'test-edge-data', source: 'test-hypothesis', target: 'test-dataset', type: 'relation', data: { relation: 'tested by' } },
]
