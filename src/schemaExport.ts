import type { WorkEdge, WorkNode } from './domain'
import { createGraphOnlyJsonLd } from './workspaceDocument'

export function createClarityJsonLd(nodes: WorkNode[], edges: WorkEdge[], modifiedAt = new Date().toISOString()) {
  return createGraphOnlyJsonLd(nodes, edges, modifiedAt)
}
