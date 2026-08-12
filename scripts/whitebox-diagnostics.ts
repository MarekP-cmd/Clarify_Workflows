import { testEdges, testNodes } from '../src/test/graphFixtures.ts'
import { isWorkEdge, parseGraphSnapshot } from '../src/graphValidation.ts'
import { isValidNodeData } from '../src/nodeValidation.ts'

function capture(operation: () => unknown) {
  try {
    return { threw: false, value: operation() }
  } catch (error) {
    return { threw: true, error: error instanceof Error ? error.message : String(error) }
  }
}

const danglingEdge = {
  ...testEdges[0],
  source: 'node-that-does-not-exist',
}
const duplicateNodeSnapshot = {
  nodes: [testNodes[0], structuredClone(testNodes[0])],
  edges: [],
}

console.log(JSON.stringify({
  malformedNodeAccepted: capture(() => isValidNodeData(null)),
  danglingEdgeSnapshotAccepted: parseGraphSnapshot({ nodes: testNodes, edges: [danglingEdge] }) !== null,
  duplicateNodeSnapshotAccepted: parseGraphSnapshot(duplicateNodeSnapshot) !== null,
  emptyRelationAccepted: isWorkEdge({ ...testEdges[0], data: { relation: '' } }),
}, null, 2))
