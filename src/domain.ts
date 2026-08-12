import type { Edge, Node } from '@xyflow/react'

import type { NodeKind, NodeOrigin, NodeStatus } from '../plugin/src/types'

export type { NodeKind, NodeOrigin, NodeStatus }

export type WorkNodeData = {
  projectId?: string
  origin?: NodeOrigin
  title: string
  kind: NodeKind
  description: string
  schemaType: string
  status: NodeStatus
  tags: string[]
  provenance: string
  humanAnnotation?: string
  aiAnnotation?: string
  priority?: 'low' | 'medium' | 'high'
  evidenceCount?: number
  pinned?: boolean
  sourceUri?: string
  instruction?: string
  agentMode?: 'off' | 'suggest' | 'verify' | 'execute'
  createdAt?: string
  updatedAt?: string
}

export type WorkNode = Node<WorkNodeData, 'workNode'>

export type WorkEdgeData = {
  projectId?: string
  relation: string
  color?: string
  dashed?: boolean
  createdAt?: string
  updatedAt?: string
}

export type WorkEdge = Edge<WorkEdgeData, 'relation'>

export const SCHEMA_ORG = 'https://schema.org/'
export const CLARITY_ONTOLOGY = 'urn:clarity-workflows:'

export const kindMeta: Record<NodeKind, { label: string; icon: string; color: string; schemaType: string }> = {
  paper: { label: 'Research paper', icon: 'paper', color: '#8aaeff', schemaType: 'ScholarlyArticle' },
  book: { label: 'Book', icon: 'book', color: '#b69cff', schemaType: 'Book' },
  dataset: { label: 'Dataset', icon: 'dataset', color: '#67d6b2', schemaType: 'Dataset' },
  code: { label: 'Code artifact', icon: 'code', color: '#ff9a7b', schemaType: 'SoftwareSourceCode' },
  hypothesis: { label: 'Hypothesis', icon: 'hypothesis', color: '#ff9b7f', schemaType: 'Thing' },
  question: { label: 'Open question', icon: 'question', color: '#f4c66b', schemaType: 'Question' },
  dashboard: { label: 'Dashboard', icon: 'dashboard', color: '#7da9ff', schemaType: 'CreativeWork' },
  project: { label: 'Side project', icon: 'project', color: '#b48fe8', schemaType: 'Project' },
  result: { label: 'Candidate result', icon: 'result', color: '#72d8c1', schemaType: 'CreativeWork' },
  gate: { label: 'Validation gate', icon: 'gate', color: '#e9bd65', schemaType: 'Action' },
  agent: { label: 'Pure agent', icon: 'agent', color: '#7fa4ff', schemaType: 'Action' },
}

export function schemaIri(kind: NodeKind) {
  return `${SCHEMA_ORG}${kindMeta[kind].schemaType}`
}

export function clarityType(kind: NodeKind) {
  return `${CLARITY_ONTOLOGY}${kind[0].toUpperCase()}${kind.slice(1)}`
}

export function statusLabel(status: NodeStatus) {
  return status.replace('-', ' ')
}
