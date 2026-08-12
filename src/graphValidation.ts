import type { WorkEdge, WorkNode } from './domain'
import { isValidNodeData } from './nodeValidation.ts'

const MAX_GRAPH_NODES = 5_000
const MAX_GRAPH_EDGES = 15_000
const MAX_POSITION_MAGNITUDE = 100_000
const EDGE_DATA_KEYS = new Set(['projectId', 'relation', 'color', 'dashed', 'createdAt', 'updatedAt'])

export type GraphSnapshot = { nodes: WorkNode[]; edges: WorkEdge[] }

function identifier(value: unknown, maximum: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum
}

function optionalTimestamp(value: unknown) {
  return value === undefined || (typeof value === 'string' && value.length <= 100 && Number.isFinite(Date.parse(value)))
}

function isFinitePosition(value: unknown): value is { x: number; y: number } {
  if (!value || typeof value !== 'object') return false
  const position = value as { x?: unknown; y?: unknown }
  return typeof position.x === 'number'
    && Number.isFinite(position.x)
    && Math.abs(position.x) <= MAX_POSITION_MAGNITUDE
    && typeof position.y === 'number'
    && Number.isFinite(position.y)
    && Math.abs(position.y) <= MAX_POSITION_MAGNITUDE
}

export function isWorkNode(value: unknown): value is WorkNode {
  if (!value || typeof value !== 'object') return false
  const node = value as Partial<WorkNode>
  return identifier(node.id, 160)
    && node.type === 'workNode'
    && isFinitePosition(node.position)
    && isValidNodeData(node.data)
}

export function isWorkEdge(value: unknown): value is WorkEdge {
  if (!value || typeof value !== 'object') return false
  const edge = value as Partial<WorkEdge>
  const data = edge.data
  if (!data || typeof data !== 'object' || Array.isArray(data)) return false
  if (!Object.keys(data).every((key) => EDGE_DATA_KEYS.has(key))) return false

  return identifier(edge.id, 200)
    && identifier(edge.source, 160)
    && identifier(edge.target, 160)
    && edge.type === 'relation'
    && (data.projectId === undefined || identifier(data.projectId, 160))
    && typeof data.relation === 'string'
    && data.relation.trim().length > 0
    && data.relation.length <= 200
    && (data.color === undefined || (typeof data.color === 'string' && data.color.length <= 100))
    && (data.dashed === undefined || typeof data.dashed === 'boolean')
    && optionalTimestamp(data.createdAt)
    && optionalTimestamp(data.updatedAt)
}

export function parseGraphSnapshot(value: unknown): GraphSnapshot | null {
  if (!value || typeof value !== 'object') return null
  const snapshot = value as { nodes?: unknown; edges?: unknown }
  if (!Array.isArray(snapshot.nodes) || !Array.isArray(snapshot.edges)) return null
  if (snapshot.nodes.length > MAX_GRAPH_NODES || snapshot.edges.length > MAX_GRAPH_EDGES) return null
  if (!snapshot.nodes.every(isWorkNode) || !snapshot.edges.every(isWorkEdge)) return null

  const nodeIds = new Set<string>()
  for (const node of snapshot.nodes) {
    if (nodeIds.has(node.id)) return null
    nodeIds.add(node.id)
  }
  const edgeIds = new Set<string>()
  for (const edge of snapshot.edges) {
    if (edgeIds.has(edge.id) || !nodeIds.has(edge.source) || !nodeIds.has(edge.target)) return null
    edgeIds.add(edge.id)
  }
  return { nodes: snapshot.nodes, edges: snapshot.edges }
}
