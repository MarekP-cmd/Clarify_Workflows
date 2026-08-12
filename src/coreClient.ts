import { clarityWorkspaceDocumentV1Schema, humanWorkspaceSaveSchema } from '../plugin/src/schema'
import type {
  ClarityActivity,
  ClarityArtifact,
  ClarityEdge,
  ClarityNode,
  DeleteWorkspaceResult,
  HumanWorkspaceSaveInput,
  IngestionNodeInput,
  IngestedFileDescriptor,
  WorkspaceState,
  WorkspaceSummary,
} from '../plugin/src/types'
import type { WorkEdge, WorkNode } from './domain'

export type CoreStatus = {
  ready: boolean
  workspaceCount: number
  schemaVersion: number
  storageMode: 'sqlite' | 'memory'
}

export type ClarityCoreBridge = {
  listWorkspaces: () => Promise<WorkspaceSummary[]>
  createWorkspace: (name: string) => Promise<WorkspaceState>
  getWorkspace: (workspaceId?: string) => Promise<WorkspaceState>
  saveHumanWorkspace: (workspaceId: string, input: HumanWorkspaceSaveInput) => Promise<WorkspaceState>
  deleteWorkspace: (workspaceId: string, expectedRevision: number) => Promise<DeleteWorkspaceResult>
  importWorkspaceDocument: (document: unknown) => Promise<WorkspaceState>
  replaceGraph: (workspaceId: string, nodes: ClarityNode[], edges: ClarityEdge[]) => Promise<WorkspaceState>
  importLegacyWorkspace: (workspace: unknown) => Promise<WorkspaceState>
  status: () => Promise<CoreStatus>
}

export type ClarityLifecycleBridge = {
  onPrepareClose: (callback: () => void | Promise<void>) => () => void
  confirmCloseReady: () => Promise<boolean>
}

export type ClarityIngestionBridge = {
  chooseFiles: () => Promise<IngestedFileDescriptor[]>
  getPathForFile: (file: File) => string
  ingestFileAsNode: (workspaceId: string, sourcePath: string, node: IngestionNodeInput, options?: { originalName?: string; mimeType?: string }) => Promise<WorkspaceState>
  retryArtifactExtraction: (workspaceId: string, artifactId: string) => Promise<ClarityArtifact>
}

export type ClarityWorkspaceClient = ClarityCoreBridge

export type WorkgraphView = {
  nodes: WorkNode[]
  edges: WorkEdge[]
}

export function workspaceToWorkgraph(workspace: WorkspaceState): WorkgraphView {
  return {
    nodes: workspace.nodes.map((node): WorkNode => ({
      id: node.id,
      type: 'workNode',
      position: node.position,
      data: {
        projectId: node.projectId,
        origin: node.origin,
        title: node.title,
        kind: node.kind,
        description: node.description,
        schemaType: node.schemaType,
        status: node.status,
        tags: node.tags,
        provenance: node.provenance,
        humanAnnotation: node.humanAnnotation,
        aiAnnotation: node.aiAnnotation,
        priority: node.priority,
        evidenceCount: node.evidenceCount,
        pinned: node.pinned,
        sourceUri: node.sourceUri,
        instruction: node.instruction,
        agentMode: node.agentMode,
        createdAt: node.createdAt,
        updatedAt: node.updatedAt,
      },
    })),
    edges: workspace.edges.map((edge): WorkEdge => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
      type: 'relation',
      data: {
        projectId: edge.projectId,
        relation: edge.relation,
        color: edge.color,
        dashed: edge.dashed,
        createdAt: edge.createdAt,
        updatedAt: edge.updatedAt,
      },
    })),
  }
}

export function workgraphToCore(nodes: WorkNode[], edges: WorkEdge[]) {
  const coreNodes: ClarityNode[] = nodes.map((node) => ({
    id: node.id,
    projectId: node.data.projectId,
    origin: node.data.origin,
    kind: node.data.kind,
    title: node.data.title,
    description: node.data.description,
    schemaType: node.data.schemaType,
    status: node.data.status,
    tags: node.data.tags,
    provenance: node.data.provenance,
    position: node.position,
    humanAnnotation: node.data.humanAnnotation,
    aiAnnotation: node.data.aiAnnotation,
    priority: node.data.priority,
    evidenceCount: node.data.evidenceCount,
    pinned: node.data.pinned,
    sourceUri: node.data.sourceUri,
    instruction: node.data.instruction,
    agentMode: node.data.agentMode,
    createdAt: node.data.createdAt,
    updatedAt: node.data.updatedAt,
  }))
  const coreEdges: ClarityEdge[] = edges.map((edge) => ({
    id: edge.id,
    projectId: edge.data?.projectId,
    source: edge.source,
    target: edge.target,
    relation: edge.data?.relation ?? 'related to',
    color: edge.data?.color,
    dashed: edge.data?.dashed,
    createdAt: edge.data?.createdAt,
    updatedAt: edge.data?.updatedAt,
  }))
  return { nodes: coreNodes, edges: coreEdges }
}

export function createDefaultClarityClient(): ClarityWorkspaceClient {
  if (window.clarityCore) return window.clarityCore
  const loopbackBrowser = window.location.protocol.startsWith('http')
    && ['127.0.0.1', 'localhost'].includes(window.location.hostname)
  if (import.meta.env.DEV || loopbackBrowser) return new MemoryClarityClient()
  return new UnavailableClarityClient()
}

class UnavailableClarityClient implements ClarityWorkspaceClient {
  private unavailable(): never {
    throw Object.assign(new Error('Clarity Core is unavailable. Open this interface through the Clarity Workflows desktop application.'), { code: 'CORE_UNAVAILABLE' })
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> { return this.unavailable() }
  async createWorkspace(): Promise<WorkspaceState> { return this.unavailable() }
  async getWorkspace(): Promise<WorkspaceState> { return this.unavailable() }
  async saveHumanWorkspace(): Promise<WorkspaceState> { return this.unavailable() }
  async deleteWorkspace(): Promise<DeleteWorkspaceResult> { return this.unavailable() }
  async importWorkspaceDocument(): Promise<WorkspaceState> { return this.unavailable() }
  async replaceGraph(): Promise<WorkspaceState> { return this.unavailable() }
  async importLegacyWorkspace(): Promise<WorkspaceState> { return this.unavailable() }
  async status(): Promise<CoreStatus> { return this.unavailable() }
}

/** Browser-only development/test adapter. Production Electron always supplies
 * window.clarityCore through the isolated preload bridge. This adapter never
 * writes localStorage and never seeds product data. */
export class MemoryClarityClient implements ClarityWorkspaceClient {
  private readonly workspaces = new Map<string, WorkspaceState>()

  constructor(initial: WorkspaceState[] = []) {
    for (const workspace of initial) this.workspaces.set(workspace.id, structuredClone(workspace))
  }

  async listWorkspaces(): Promise<WorkspaceSummary[]> {
    return [...this.workspaces.values()]
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map((workspace) => ({
        id: workspace.id,
        name: workspace.name,
        status: workspace.status,
        revision: workspace.revision,
        nodeCount: workspace.nodes.length,
        edgeCount: workspace.edges.length,
        createdAt: workspace.createdAt,
        updatedAt: workspace.updatedAt,
      }))
  }

  async createWorkspace(name: string): Promise<WorkspaceState> {
    const timestamp = new Date().toISOString()
    const workspace: WorkspaceState = {
      version: 2,
      id: `workspace-${globalThis.crypto.randomUUID()}`,
      name: name.trim(),
      status: 'active',
      revision: 0,
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      projects: [], nodes: [], edges: [], artifacts: [], annotations: [], workflowDefinitions: [], runs: [], gates: [], approvals: [],
      activities: [{
        id: `activity-${globalThis.crypto.randomUUID()}`,
        workspaceId: '',
        actor: 'human',
        action: 'created',
        entityType: 'workspace',
        summary: `Created workspace “${name.trim()}”.`,
        changedFields: [],
        createdAt: timestamp,
      }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    workspace.activities[0].workspaceId = workspace.id
    workspace.activities[0].entityId = workspace.id
    this.workspaces.set(workspace.id, structuredClone(workspace))
    return structuredClone(workspace)
  }

  async getWorkspace(workspaceId?: string): Promise<WorkspaceState> {
    const id = workspaceId ?? (await this.listWorkspaces())[0]?.id
    const workspace = id ? this.workspaces.get(id) : undefined
    if (!workspace) throw Object.assign(new Error('No Clarity workspace exists yet.'), { code: 'WORKSPACE_REQUIRED' })
    return structuredClone(workspace)
  }

  async saveHumanWorkspace(workspaceId: string, input: HumanWorkspaceSaveInput): Promise<WorkspaceState> {
    const parsed = humanWorkspaceSaveSchema.parse(input)
    const workspace = await this.getWorkspace(workspaceId)
    if (workspace.revision !== parsed.expectedRevision) {
      throw Object.assign(new Error(`Workspace ${workspaceId} changed from revision ${parsed.expectedRevision} to ${workspace.revision}. Reload it before saving or deleting anything.`), { code: 'WORKSPACE_CONFLICT' })
    }
    const timestamp = new Date(Math.max(Date.now(), Date.parse(workspace.updatedAt)) + 1).toISOString()
    const previousProjects = new Map(workspace.projects.map((project) => [project.id, project]))
    const previousNodes = new Map(workspace.nodes.map((node) => [node.id, node]))
    const previousEdges = new Map(workspace.edges.map((edge) => [edge.id, edge]))
    const previousHumanAnnotations = new Map(workspace.annotations.filter((annotation) => annotation.author === 'human').map((annotation) => [annotation.id, annotation]))
    const protectedAnnotations = workspace.annotations.filter((annotation) => annotation.author !== 'human')
    const desiredNodeIds = new Set(parsed.nodes.map((node) => node.id))
    for (const annotation of protectedAnnotations) {
      if (!desiredNodeIds.has(annotation.nodeId)) throw Object.assign(new Error(`Node ${annotation.nodeId} is referenced by an AI or system annotation and cannot be deleted.`), { code: 'PROTECTED_STATE_CONFLICT' })
    }
    for (const run of workspace.runs) {
      if (run.committedNodeId && !desiredNodeIds.has(run.committedNodeId)) throw Object.assign(new Error(`Approved result ${run.committedNodeId} cannot be deleted.`), { code: 'PROTECTED_STATE_CONFLICT' })
    }

    const projects = parsed.projects.map((project) => {
      const previous = previousProjects.get(project.id)
      const unchanged = previous && previous.name === project.name && previous.description === project.description && previous.status === project.status
      return {
        id: project.id,
        workspaceId,
        name: project.name,
        description: project.description,
        status: project.status,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: unchanged ? previous.updatedAt : timestamp,
      }
    })
    const nodes = parsed.nodes.map((node) => {
      const previous = previousNodes.get(node.id)
      const { createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = node
      return { ...fields, aiAnnotation: previous?.aiAnnotation, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp }
    })
    const edges = parsed.edges.map((edge) => {
      const previous = previousEdges.get(edge.id)
      const { createdAt: _createdAt, updatedAt: _updatedAt, ...fields } = edge
      return { ...fields, createdAt: previous?.createdAt ?? timestamp, updatedAt: timestamp }
    })
    const humanAnnotations = parsed.annotations.map((annotation) => {
      const previous = previousHumanAnnotations.get(annotation.id)
        return {
          id: annotation.id,
          workspaceId,
          nodeId: annotation.nodeId,
          author: 'human' as const,
          origin: previous?.origin ?? annotation.origin ?? 'local',
          declaredAuthor: previous?.declaredAuthor ?? annotation.declaredAuthor,
          body: annotation.body,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp,
      }
    })
    const item: ClarityActivity = {
      id: `activity-${globalThis.crypto.randomUUID()}`,
      workspaceId,
      actor: 'human',
      action: 'updated',
      entityType: 'workspace',
      entityId: workspaceId,
      summary: `Saved workspace “${parsed.name}”.`,
      changedFields: [],
      createdAt: timestamp,
    }
    const next: WorkspaceState = {
      ...workspace,
      name: parsed.name,
      status: parsed.status,
      revision: workspace.revision + 1,
      projects,
      nodes,
      edges,
      artifacts: workspace.artifacts.map((artifact) => artifact.nodeId && !desiredNodeIds.has(artifact.nodeId) ? { ...artifact, nodeId: undefined, updatedAt: timestamp } : artifact),
      annotations: [...protectedAnnotations, ...humanAnnotations],
      activities: [...workspace.activities, item],
      updatedAt: timestamp,
    }
    this.workspaces.set(workspaceId, structuredClone(next))
    return structuredClone(next)
  }

  async deleteWorkspace(workspaceId: string, expectedRevision: number): Promise<DeleteWorkspaceResult> {
    const workspace = await this.getWorkspace(workspaceId)
    if (workspace.revision !== expectedRevision) {
      throw Object.assign(new Error(`Workspace ${workspaceId} changed from revision ${expectedRevision} to ${workspace.revision}. Reload it before deleting.`), { code: 'WORKSPACE_CONFLICT' })
    }
    this.workspaces.delete(workspaceId)
    return { workspaceId, name: workspace.name, deleted: true, deletedAt: new Date().toISOString() }
  }

  async importWorkspaceDocument(input: unknown): Promise<WorkspaceState> {
    const document = clarityWorkspaceDocumentV1Schema.parse(input)
    const timestamp = new Date().toISOString()
    const id = `workspace-${globalThis.crypto.randomUUID()}`
    const workspace: WorkspaceState = {
      version: 2,
      id,
      name: document.name,
      status: document.status,
      revision: 0,
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      projects: document.projects.map((project) => ({ ...project, workspaceId: id, createdAt: timestamp, updatedAt: timestamp })),
      nodes: document.nodes.map((node) => ({ ...node, createdAt: timestamp, updatedAt: timestamp })),
      edges: document.edges.map((edge) => ({ ...edge, createdAt: timestamp, updatedAt: timestamp })),
      artifacts: [],
      annotations: document.annotations.map((annotation) => ({
        ...annotation,
        workspaceId: id,
        createdAt: annotation.createdAt ? new Date(annotation.createdAt).toISOString() : timestamp,
        updatedAt: annotation.updatedAt ? new Date(annotation.updatedAt).toISOString() : annotation.createdAt ? new Date(annotation.createdAt).toISOString() : timestamp,
      })),
      workflowDefinitions: [], runs: [], gates: [], approvals: [],
      activities: [{
        id: `activity-${globalThis.crypto.randomUUID()}`,
        workspaceId: id,
        actor: 'human',
        action: 'imported',
        entityType: 'workspace',
        entityId: id,
        summary: `Imported portable workspace “${document.name}”.`,
        changedFields: [],
        createdAt: timestamp,
      }],
      createdAt: timestamp,
      updatedAt: timestamp,
    }
    this.workspaces.set(id, structuredClone(workspace))
    return structuredClone(workspace)
  }

  async replaceGraph(workspaceId: string, nodes: ClarityNode[], edges: ClarityEdge[]): Promise<WorkspaceState> {
    const workspace = await this.getWorkspace(workspaceId)
    const nodeIds = new Set(nodes.map((node) => node.id))
    return this.saveHumanWorkspace(workspaceId, {
      expectedRevision: workspace.revision,
      name: workspace.name,
      status: workspace.status,
      projects: workspace.projects,
      nodes,
      edges,
      annotations: workspace.annotations.filter((annotation): annotation is typeof annotation & { author: 'human' } => annotation.author === 'human' && nodeIds.has(annotation.nodeId)),
    })
  }

  async importLegacyWorkspace(): Promise<WorkspaceState> {
    throw Object.assign(new Error('Legacy import is available only through the desktop Clarity Core.'), { code: 'CORE_REQUIRED' })
  }

  async status(): Promise<CoreStatus> {
    return { ready: true, workspaceCount: this.workspaces.size, schemaVersion: 6, storageMode: 'memory' }
  }
}
