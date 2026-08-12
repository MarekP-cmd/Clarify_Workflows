import type {
  AnnotationAuthor,
  ClarityAnnotation,
  ClarityWorkspaceDocumentV1,
  WorkspaceState,
} from '../plugin/src/types'
import type { WorkEdge, WorkNode } from './domain'
import { CLARITY_ONTOLOGY, SCHEMA_ORG, clarityType } from './domain'
import { workgraphToCore } from './coreClient'

type JsonRecord = Record<string, unknown>

const JSON_LD_FORMAT = 'clarity-workspace-jsonld'

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function requiredString(record: JsonRecord, key: string) {
  const value = record[key]
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Imported JSON-LD is missing ${key}.`)
  return value
}

function optionalString(record: JsonRecord, key: string) {
  const value = record[key]
  return typeof value === 'string' ? value : undefined
}

function optionalBoolean(record: JsonRecord, key: string) {
  const value = record[key]
  return typeof value === 'boolean' ? value : undefined
}

function optionalNumber(record: JsonRecord, key: string) {
  const value = record[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function requiredNumber(record: JsonRecord, key: string) {
  const value = optionalNumber(record, key)
  if (value === undefined) throw new Error(`Imported JSON-LD is missing numeric ${key}.`)
  return value
}

function stringArray(record: JsonRecord, key: string) {
  const value = record[key]
  if (value === undefined) return []
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) {
    throw new Error(`Imported JSON-LD field ${key} must be a string array.`)
  }
  return value
}

function portableNode(node: WorkNode) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...data } = node.data
  return { id: node.id, ...data, position: node.position }
}

function portableEdge(edge: WorkEdge) {
  const { createdAt: _createdAt, updatedAt: _updatedAt, ...data } = edge.data ?? { relation: 'related to' }
  return {
    id: edge.id,
    source: edge.source,
    target: edge.target,
    relation: data.relation,
    projectId: data.projectId,
    color: data.color,
    dashed: data.dashed,
  }
}

/** Portable, validated-at-Core human workspace exchange. This deliberately
 * excludes runs, gates, approvals and managed artifact bytes: importing a
 * graph document must never forge approval history or imply file access. */
export function createClarityWorkspaceDocument(
  workspace: WorkspaceState,
  nodes: WorkNode[],
  edges: WorkEdge[],
  annotations: ClarityAnnotation[] = workspace.annotations,
  exportedAt = new Date().toISOString(),
): ClarityWorkspaceDocumentV1 {
  return {
    format: 'clarity-workspace',
    version: 1,
    exportedAt,
    name: workspace.name,
    status: workspace.status,
    projects: workspace.projects.map(({ workspaceId: _workspaceId, createdAt: _createdAt, updatedAt: _updatedAt, ...project }) => project),
    nodes: nodes.map(portableNode),
    edges: edges.map(portableEdge),
    annotations: annotations.map(({ workspaceId: _workspaceId, ...annotation }) => annotation),
  }
}

export function createWorkspaceJsonLd(
  workspace: WorkspaceState,
  nodes: WorkNode[],
  edges: WorkEdge[],
  annotations: ClarityAnnotation[] = workspace.annotations,
  exportedAt = new Date().toISOString(),
) {
  const document = createClarityWorkspaceDocument(workspace, nodes, edges, annotations, exportedAt)
  return {
    '@context': { schema: SCHEMA_ORG, cw: CLARITY_ONTOLOGY },
    '@type': 'cw:Workspace',
    '@id': `cw:workspace/${workspace.id}`,
    'schema:identifier': workspace.id,
    'schema:name': document.name,
    'schema:dateModified': exportedAt,
    'cw:format': JSON_LD_FORMAT,
    'cw:version': 1,
    'cw:status': document.status,
    '@graph': [
      ...document.projects.map((project) => ({
        '@id': `cw:project/${project.id}`,
        '@type': 'cw:ProjectCluster',
        'schema:identifier': project.id,
        'schema:name': project.name,
        'schema:description': project.description,
        'cw:status': project.status,
      })),
      ...document.nodes.map((node) => ({
        '@id': `cw:node/${node.id}`,
        '@type': [`${SCHEMA_ORG}${node.schemaType}`, clarityType(node.kind)],
        'schema:identifier': node.id,
        'schema:name': node.title,
        'schema:description': node.description,
        'schema:keywords': node.tags,
        'cw:kind': node.kind,
        'cw:schemaType': node.schemaType,
        'cw:status': node.status,
        'cw:provenance': node.provenance,
        'cw:positionX': node.position.x,
        'cw:positionY': node.position.y,
        'cw:projectId': node.projectId,
        'cw:origin': node.origin,
        'cw:humanAnnotation': node.humanAnnotation,
        'cw:aiAnnotation': node.aiAnnotation,
        'cw:priority': node.priority,
        'cw:evidenceCount': node.evidenceCount,
        'cw:pinned': node.pinned,
        'cw:sourceUri': node.sourceUri,
        'cw:instruction': node.instruction,
        'cw:agentMode': node.agentMode,
      })),
      ...document.edges.map((edge) => ({
        '@id': `cw:edge/${edge.id}`,
        '@type': 'cw:Relationship',
        'schema:identifier': edge.id,
        'cw:source': edge.source,
        'cw:target': edge.target,
        'cw:relation': edge.relation,
        'cw:projectId': edge.projectId,
        'cw:color': edge.color,
        'cw:dashed': edge.dashed,
      })),
      ...document.annotations.map((annotation) => ({
        '@id': `cw:annotation/${annotation.id}`,
        '@type': 'cw:Annotation',
        'schema:identifier': annotation.id,
        'schema:text': annotation.body,
        'schema:dateCreated': annotation.createdAt,
        'schema:dateModified': annotation.updatedAt,
        'cw:nodeId': annotation.nodeId,
        'cw:author': annotation.author,
        'cw:annotationOrigin': annotation.origin,
        'cw:declaredAuthor': annotation.declaredAuthor,
      })),
    ],
  }
}

function parseWorkspaceJsonLd(value: JsonRecord): ClarityWorkspaceDocumentV1 {
  if (value['cw:format'] !== JSON_LD_FORMAT || value['cw:version'] !== 1) {
    throw new Error('This JSON-LD file is not a Clarity workspace export.')
  }
  const graph = value['@graph']
  if (!Array.isArray(graph) || !graph.every(isRecord)) throw new Error('Imported JSON-LD has no valid @graph array.')

  const projects: ClarityWorkspaceDocumentV1['projects'] = []
  const nodes: ClarityWorkspaceDocumentV1['nodes'] = []
  const edges: ClarityWorkspaceDocumentV1['edges'] = []
  const annotations: ClarityWorkspaceDocumentV1['annotations'] = []

  for (const item of graph) {
    const type = item['@type']
    if (type === 'cw:ProjectCluster') {
      projects.push({
        id: requiredString(item, 'schema:identifier'),
        name: requiredString(item, 'schema:name'),
        description: optionalString(item, 'schema:description') ?? '',
        status: requiredString(item, 'cw:status') as 'active' | 'archived',
      })
      continue
    }
    if (type === 'cw:Relationship') {
      edges.push({
        id: requiredString(item, 'schema:identifier'),
        source: requiredString(item, 'cw:source'),
        target: requiredString(item, 'cw:target'),
        relation: requiredString(item, 'cw:relation'),
        projectId: optionalString(item, 'cw:projectId'),
        color: optionalString(item, 'cw:color'),
        dashed: optionalBoolean(item, 'cw:dashed'),
      })
      continue
    }
    if (type === 'cw:Annotation') {
      const annotationOrigin = optionalString(item, 'cw:annotationOrigin')
      const declaredAuthor = optionalString(item, 'cw:declaredAuthor')
      annotations.push({
        id: requiredString(item, 'schema:identifier'),
        nodeId: requiredString(item, 'cw:nodeId'),
        author: requiredString(item, 'cw:author') as AnnotationAuthor,
        ...(annotationOrigin ? { origin: annotationOrigin as ClarityWorkspaceDocumentV1['annotations'][number]['origin'] } : {}),
        ...(declaredAuthor ? { declaredAuthor: declaredAuthor as AnnotationAuthor } : {}),
        body: requiredString(item, 'schema:text'),
        createdAt: optionalString(item, 'schema:dateCreated'),
        updatedAt: optionalString(item, 'schema:dateModified'),
      })
      continue
    }

    if (item['cw:kind'] !== undefined) {
      const evidenceCount = optionalNumber(item, 'cw:evidenceCount')
      const origin = optionalString(item, 'cw:origin')
      nodes.push({
        id: requiredString(item, 'schema:identifier'),
        projectId: optionalString(item, 'cw:projectId'),
        ...(origin ? { origin: origin as ClarityWorkspaceDocumentV1['nodes'][number]['origin'] } : {}),
        kind: requiredString(item, 'cw:kind') as ClarityWorkspaceDocumentV1['nodes'][number]['kind'],
        title: requiredString(item, 'schema:name'),
        description: optionalString(item, 'schema:description') ?? '',
        schemaType: requiredString(item, 'cw:schemaType'),
        status: requiredString(item, 'cw:status') as ClarityWorkspaceDocumentV1['nodes'][number]['status'],
        tags: stringArray(item, 'schema:keywords'),
        provenance: requiredString(item, 'cw:provenance'),
        position: {
          x: requiredNumber(item, 'cw:positionX'),
          y: requiredNumber(item, 'cw:positionY'),
        },
        humanAnnotation: optionalString(item, 'cw:humanAnnotation'),
        aiAnnotation: optionalString(item, 'cw:aiAnnotation'),
        priority: optionalString(item, 'cw:priority') as ClarityWorkspaceDocumentV1['nodes'][number]['priority'],
        evidenceCount,
        pinned: optionalBoolean(item, 'cw:pinned'),
        sourceUri: optionalString(item, 'cw:sourceUri'),
        instruction: optionalString(item, 'cw:instruction'),
        agentMode: optionalString(item, 'cw:agentMode') as ClarityWorkspaceDocumentV1['nodes'][number]['agentMode'],
      })
    }
  }

  return {
    format: 'clarity-workspace',
    version: 1,
    exportedAt: requiredString(value, 'schema:dateModified'),
    name: requiredString(value, 'schema:name'),
    status: requiredString(value, 'cw:status') as 'active' | 'archived',
    projects,
    nodes,
    edges,
    annotations,
  }
}

/** Parse either portable Clarity JSON or Clarity's lossless Schema.org JSON-LD
 * representation. The Core performs the authoritative strict validation and
 * atomic import after this format conversion. */
export function parseClarityWorkspaceDocument(value: unknown): ClarityWorkspaceDocumentV1 {
  if (!isRecord(value)) throw new Error('The selected file does not contain a JSON object.')
  if (value.format === 'clarity-workspace' && value.version === 1) return value as ClarityWorkspaceDocumentV1
  return parseWorkspaceJsonLd(value)
}

/** Keeps the old graph-only export API available to tests and callers while
 * the full workspace export is used by the Chunk 2 UI. */
export function createGraphOnlyJsonLd(nodes: WorkNode[], edges: WorkEdge[], modifiedAt = new Date().toISOString()) {
  const graph = workgraphToCore(nodes, edges)
  return {
    '@context': { schema: SCHEMA_ORG, cw: CLARITY_ONTOLOGY },
    '@graph': [
      ...graph.nodes.map((node) => ({
        '@id': `cw:node/${node.id}`,
        '@type': [`${SCHEMA_ORG}${node.schemaType}`, clarityType(node.kind)],
        'schema:name': node.title,
        'schema:description': node.description,
        'schema:identifier': node.id,
        'schema:keywords': node.tags,
        'schema:dateModified': modifiedAt,
        'cw:status': node.status,
        'cw:origin': node.origin,
        'cw:provenance': node.provenance,
        'cw:humanAnnotation': node.humanAnnotation,
        'cw:aiAnnotation': node.aiAnnotation,
      })),
      ...graph.edges.map((edge) => ({
        '@id': `cw:edge/${edge.id}`,
        '@type': 'cw:Relationship',
        'cw:source': `cw:node/${edge.source}`,
        'cw:target': `cw:node/${edge.target}`,
        'cw:relation': edge.relation,
      })),
    ],
  }
}
