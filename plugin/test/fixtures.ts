import type { CandidateResult, ClarityEdge, ClarityNode, WorkspaceState } from '../src/types.js'
import { WorkspaceStore } from '../src/store.js'

export const SOURCE_IDS = {
  paper: 'paper-grid-reliability',
  dataset: 'dataset-outage-history',
  hypothesis: 'hypothesis-storage-buffer',
  unselected: 'paper-unselected-control',
} as const

export const fixtureNodes: ClarityNode[] = [
  {
    id: SOURCE_IDS.paper,
    kind: 'paper',
    title: 'Grid Reliability Review',
    description: 'Synthetic test paper describing grid congestion and reliability mechanisms.',
    schemaType: 'ScholarlyArticle',
    status: 'verified',
    tags: ['Test fixture'],
    provenance: 'Generated solely for automated test execution',
    position: { x: 80, y: 100 },
    evidenceCount: 4,
  },
  {
    id: SOURCE_IDS.dataset,
    kind: 'dataset',
    title: 'Outage History Fixture',
    description: 'Synthetic rows for deterministic workflow tests.',
    schemaType: 'Dataset',
    status: 'verified',
    tags: ['Test fixture'],
    provenance: 'Generated solely for automated test execution',
    position: { x: 400, y: 310 },
    evidenceCount: 6,
  },
  {
    id: SOURCE_IDS.hypothesis,
    kind: 'hypothesis',
    title: 'Storage may reduce peak congestion',
    description: 'A synthetic hypothesis used to test graph relationships.',
    schemaType: 'Thing',
    status: 'needs-evidence',
    tags: ['Test fixture'],
    provenance: 'Generated solely for automated test execution',
    position: { x: 390, y: 130 },
  },
  {
    id: SOURCE_IDS.unselected,
    kind: 'paper',
    title: 'Unselected Control Source',
    description: 'A source that must be rejected when it was not admitted by the pre-gate.',
    schemaType: 'ScholarlyArticle',
    status: 'verified',
    tags: ['Test fixture'],
    provenance: 'Generated solely for automated test execution',
    position: { x: 700, y: 100 },
  },
]

export const fixtureEdges: ClarityEdge[] = [
  {
    id: 'edge-hypothesis-dataset',
    source: SOURCE_IDS.hypothesis,
    target: SOURCE_IDS.dataset,
    relation: 'tested by',
  },
  {
    id: 'edge-paper-hypothesis',
    source: SOURCE_IDS.paper,
    target: SOURCE_IDS.hypothesis,
    relation: 'informs',
  },
]

export const fixtureCandidate: CandidateResult = {
  title: 'Storage congestion candidate',
  synthesis: 'The admitted synthetic paper and dataset support a bounded association between storage availability and peak congestion.',
  hypothesis: 'Targeted storage dispatch reduces peak congestion under the specified fixture conditions.',
  counterargument: 'Weather and demand composition may explain the association without a storage-driven effect.',
  pressureTest: 'Stratify the fixture by demand regime and compare held-out congestion outcomes against a no-storage baseline.',
  decision: 'mixed',
  confidence: 0.68,
  evidenceNodeIds: [SOURCE_IDS.paper, SOURCE_IDS.dataset],
  codeOutput: 'Fit a deterministic interaction model against the admitted fixture rows.',
}

export async function populateFixtureWorkspace(store: WorkspaceStore, name = 'Automated Test Workspace'): Promise<WorkspaceState> {
  const workspace = await store.create(name)
  return store.replaceGraph(workspace.id, fixtureNodes, fixtureEdges)
}
