import path from 'node:path'
import { WorkspaceStore } from '../dist/store.js'

export const TEST_SOURCE_IDS = {
  paper: 'paper-grid-reliability',
  dataset: 'dataset-outage-history',
}

export async function createTemporaryTestWorkspace(directory) {
  const databasePath = path.join(directory, 'clarity.sqlite3')
  const store = new WorkspaceStore({
    databasePath,
    artifactDirectory: path.join(directory, 'artifacts'),
    legacyJsonPaths: [],
  })
  await store.initialize()
  const workspace = await store.create('Release Test Workspace')
  await store.replaceGraph(workspace.id, [
    {
      id: TEST_SOURCE_IDS.paper,
      kind: 'paper',
      title: 'Grid Reliability Review Fixture',
      description: 'Synthetic paper metadata created only inside the release test directory.',
      schemaType: 'ScholarlyArticle',
      status: 'verified',
      tags: ['Automated test'],
      provenance: 'Ephemeral release test fixture',
      position: { x: 80, y: 100 },
      evidenceCount: 4,
    },
    {
      id: TEST_SOURCE_IDS.dataset,
      kind: 'dataset',
      title: 'Outage History Fixture',
      description: 'Synthetic dataset metadata created only inside the release test directory.',
      schemaType: 'Dataset',
      status: 'verified',
      tags: ['Automated test'],
      provenance: 'Ephemeral release test fixture',
      position: { x: 420, y: 260 },
      evidenceCount: 6,
    },
  ], [{
    id: 'edge-paper-dataset',
    source: TEST_SOURCE_IDS.paper,
    target: TEST_SOURCE_IDS.dataset,
    relation: 'tested against',
  }])
  await store.close()
  return databasePath
}
