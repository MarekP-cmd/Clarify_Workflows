import { useCallback, useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react'
import { applyEdgeChanges, applyNodeChanges, type Connection, type EdgeChange, type NodeChange, type OnNodeDrag } from '@xyflow/react'
import type {
  ClarityActivity,
  ClarityAnnotation,
  ClarityArtifact,
  ClarityProject,
  DeleteWorkspaceResult,
  HumanWorkspaceSaveInput,
  NodeKind,
  NodeStatus,
  WorkspaceState,
  WorkspaceStatus,
  WorkspaceSummary,
  IngestedFileDescriptor,
} from '../plugin/src/types'
import type { WorkEdge, WorkNode, WorkNodeData } from './domain'
import { kindMeta } from './domain'
import {
  createDefaultClarityClient,
  workgraphToCore,
  workspaceToWorkgraph,
  type ClarityWorkspaceClient,
  type CoreStatus,
} from './coreClient'
import { createClarityWorkspaceDocument, createWorkspaceJsonLd, parseClarityWorkspaceDocument } from './workspaceDocument'
import { workNodeFromFile } from './nodePayload'
import { GraphCanvas } from './components/GraphCanvas'
import { Inspector, type ConnectedRelation } from './components/Inspector'
import { Modal } from './components/Modal'
import { isHumanNodeKind, NodeEditorDialog } from './components/NodeEditorDialog'
import { ProjectDialog } from './components/ProjectDialog'
import { RelationshipEditorDialog } from './components/RelationshipEditorDialog'
import {
  Archive,
  Download,
  FileCode2,
  FolderKanban,
  History,
  Layers3,
  Link2,
  Network,
  PanelRight,
  Paperclip,
  Plus,
  RotateCcw,
  Sparkles,
  Zap,
} from './components/Icons'

type HumanWorkspaceClient = ClarityWorkspaceClient & {
  saveHumanWorkspace: (workspaceId: string, input: HumanWorkspaceSaveInput) => Promise<WorkspaceState>
  deleteWorkspace: (workspaceId: string, expectedRevision: number) => Promise<DeleteWorkspaceResult>
  importWorkspaceDocument: (document: unknown) => Promise<WorkspaceState>
}

type AppProps = { client?: ClarityWorkspaceClient; nodeCapacity?: number }
type LoadState = 'loading' | 'ready' | 'error'
type SaveState = 'saved' | 'saving' | 'error' | 'conflict'

type HumanDraft = {
  name: string
  status: WorkspaceStatus
  projects: ClarityProject[]
  nodes: WorkNode[]
  edges: WorkEdge[]
  annotations: ClarityAnnotation[]
}

type PendingSave = {
  workspaceId: string
  signature: string
  input: HumanWorkspaceSaveInput
}

type NodeDialogState = { mode: 'create' | 'edit' | 'duplicate'; node?: WorkNode }
type RelationDialogState = { edge?: WorkEdge; suggested?: { source?: string | null; target?: string | null } }

const HISTORY_LIMIT = 100
export const MAX_GRAPH_NODES = 5_000
const AUTO_LAYOUT_COLUMNS = 50
export const MAX_IMPORT_BYTES = 25 * 1024 * 1024
const DEFAULT_EDGE_COLOR = '#7d91ae'
const CROSS_PROJECT_EDGE_COLOR = '#b79afa'

function uniqueId(prefix: string) {
  return `${prefix}-${globalThis.crypto.randomUUID()}`
}

export function boundedNodePosition(index: number) {
  const boundedIndex = Math.max(0, Math.trunc(Number.isFinite(index) ? index : 0)) % MAX_GRAPH_NODES
  return {
    x: 140 + (boundedIndex % AUTO_LAYOUT_COLUMNS) * 260,
    y: 120 + Math.floor(boundedIndex / AUTO_LAYOUT_COLUMNS) * 190,
  }
}

function cloneDraft(draft: HumanDraft): HumanDraft {
  return structuredClone(draft)
}

function draftFromWorkspace(workspace: WorkspaceState): HumanDraft {
  const graph = workspaceToWorkgraph(workspace)
  return {
    name: workspace.name,
    status: workspace.status,
    projects: structuredClone(workspace.projects),
    nodes: graph.nodes,
    edges: graph.edges,
    annotations: structuredClone(workspace.annotations),
  }
}

function humanSaveInput(draft: HumanDraft, expectedRevision: number): HumanWorkspaceSaveInput {
  const graph = workgraphToCore(draft.nodes, draft.edges)
  return {
    expectedRevision,
    name: draft.name,
    status: draft.status,
    projects: draft.projects.map(({ workspaceId: _workspaceId, ...project }) => project),
    nodes: graph.nodes,
    edges: graph.edges,
    annotations: draft.annotations
      .filter((annotation) => annotation.author === 'human')
      .map(({ workspaceId: _workspaceId, author: _author, ...annotation }) => ({ ...annotation, author: 'human' })),
  }
}

function draftSignature(draft: HumanDraft) {
  const graph = workgraphToCore(draft.nodes, draft.edges)
  return JSON.stringify({
    name: draft.name,
    status: draft.status,
    projects: draft.projects,
    nodes: graph.nodes,
    edges: graph.edges,
    annotations: draft.annotations,
  })
}

function relationStyle(nodes: WorkNode[], sourceId: string, targetId: string) {
  const sourceProject = nodes.find((node) => node.id === sourceId)?.data.projectId
  const targetProject = nodes.find((node) => node.id === targetId)?.data.projectId
  const crossProject = (sourceProject ?? 'workspace-root') !== (targetProject ?? 'workspace-root')
  return {
    projectId: crossProject ? undefined : sourceProject,
    dashed: crossProject,
    color: crossProject ? CROSS_PROJECT_EDGE_COLOR : DEFAULT_EDGE_COLOR,
  }
}

function nodeBelongsToArchivedProject(draft: HumanDraft, nodeId: string) {
  const node = draft.nodes.find((item) => item.id === nodeId)
  if (!node?.data.projectId) return false
  return draft.projects.some((project) => project.id === node.data.projectId && project.status === 'archived')
}

function relationshipTouchesArchivedProject(draft: HumanDraft, edge: Pick<WorkEdge, 'source' | 'target'>) {
  return nodeBelongsToArchivedProject(draft, edge.source) || nodeBelongsToArchivedProject(draft, edge.target)
}

function protectedNodeReason(workspace: WorkspaceState | null, draft: HumanDraft, nodeId: string) {
  const node = draft.nodes.find((item) => item.id === nodeId)
  if (workspace?.runs.some((run) => run.committedNodeId === nodeId)) return 'an approved result'
  if (workspace?.runs.some((run) => run.candidate.evidenceNodeIds.includes(nodeId))) return 'approved workflow evidence'
  if (workspace?.runs.some((run) => run.sourceNodeIds.includes(nodeId))) return 'workflow source history'
  if (draft.annotations.some((annotation) => annotation.nodeId === nodeId && annotation.author !== 'human')) return 'a read-only AI or system annotation'
  if (node?.data.aiAnnotation) return 'a read-only AI annotation'
  if (workspace?.artifacts.some((artifact) => artifact.nodeId === nodeId)) return 'linked evidence'
  return null
}

function protectedEdgeReason(workspace: WorkspaceState | null, edge: Pick<WorkEdge, 'source' | 'target'>) {
  return workspace?.runs.some((run) => run.committedNodeId === edge.target && run.candidate.evidenceNodeIds.includes(edge.source))
    ? 'an approved evidence relationship'
    : null
}

function protectedProjectReason(workspace: WorkspaceState | null, projectId: string) {
  if (workspace?.workflowDefinitions.some((definition) => definition.projectId === projectId)) return 'an authored workflow definition'
  if (workspace?.runs.some((run) => run.projectId === projectId)) return 'workflow history'
  return null
}

function metadataReadOnlyReason(node: WorkNode) {
  if (node.data.origin === 'approved-ai') return 'Approved AI result metadata is locked. You may still move or pin the item and add human notes.'
  if (!isHumanNodeKind(node.data.kind)) return 'This workflow-managed item type is not editable in the human graph workspace.'
  return null
}

function isEditableTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false
  return target.matches('input, textarea, select, [contenteditable="true"]') || Boolean(target.closest('input, textarea, select, [contenteditable="true"]'))
}

function errorCode(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : ''
}

function downloadJson(filename: string, value: unknown, mimeType = 'application/json') {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: mimeType })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

function safeFilename(name: string) {
  return name.replaceAll(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').toLowerCase() || 'clarity-workspace'
}

function App({ client: suppliedClient, nodeCapacity = MAX_GRAPH_NODES }: AppProps) {
  const client = useMemo(() => (suppliedClient ?? createDefaultClarityClient()) as HumanWorkspaceClient, [suppliedClient])
  const [loadState, setLoadState] = useState<LoadState>('loading')
  const [busyMessage, setBusyMessage] = useState('Opening Clarity Core')
  const [errorMessage, setErrorMessage] = useState('')
  const [workspaces, setWorkspaces] = useState<WorkspaceSummary[]>([])
  const [workspace, setWorkspace] = useState<WorkspaceState | null>(null)
  const [draft, setDraft] = useState<HumanDraft | null>(null)
  const [selectedNodeIds, setSelectedNodeIds] = useState<string[]>([])
  const [selectedEdgeIds, setSelectedEdgeIds] = useState<string[]>([])
  const [showInspector, setShowInspector] = useState(true)
  const [newWorkspaceName, setNewWorkspaceName] = useState('')
  const [creatingWorkspace, setCreatingWorkspace] = useState(false)
  const [coreStatus, setCoreStatus] = useState<CoreStatus | null>(null)
  const [saveState, setSaveState] = useState<SaveState>('saved')
  const [toast, setToast] = useState('')
  const [showArchivedWorkspaces, setShowArchivedWorkspaces] = useState(false)
  const [showArchivedProjects, setShowArchivedProjects] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<NodeKind | 'all'>('all')
  const [statusFilter, setStatusFilter] = useState<NodeStatus | 'all'>('all')
  const [priorityFilter, setPriorityFilter] = useState<WorkNodeData['priority'] | 'normal' | 'all'>('all')
  const [projectFilter, setProjectFilter] = useState<string>('all')
  const [nodeDialog, setNodeDialog] = useState<NodeDialogState | null>(null)
  const [relationDialog, setRelationDialog] = useState<RelationDialogState | null>(null)
  const [projectDialog, setProjectDialog] = useState<ClarityProject | 'create' | null>(null)
  const [renameWorkspaceOpen, setRenameWorkspaceOpen] = useState(false)
  const [renameWorkspaceValue, setRenameWorkspaceValue] = useState('')
  const [historyVersion, setHistoryVersion] = useState(0)
  const readOnly = !draft || draft.status === 'archived' || saveState === 'conflict' || (loadState === 'loading' && Boolean(workspace))
  const atNodeCapacity = (draft?.nodes.length ?? 0) >= nodeCapacity

  const workspaceRef = useRef<WorkspaceState | null>(null)
  const draftRef = useRef<HumanDraft | null>(null)
  const undoRef = useRef<HumanDraft[]>([])
  const redoRef = useRef<HumanDraft[]>([])
  const dragStartRef = useRef<HumanDraft | null>(null)
  const toastTimerRef = useRef<number | null>(null)
  const saveTimerRef = useRef<number | null>(null)
  const pendingSaveRef = useRef<PendingSave | null>(null)
  const savePromiseRef = useRef<Promise<boolean> | null>(null)
  const saveStateRef = useRef<SaveState>('saved')
  const lastPersistedSignatureRef = useRef('')
  const searchRef = useRef<HTMLInputElement>(null)
  const importInputRef = useRef<HTMLInputElement>(null)
  const ingestInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { workspaceRef.current = workspace }, [workspace])
  useEffect(() => { draftRef.current = draft }, [draft])
  useEffect(() => { saveStateRef.current = saveState }, [saveState])

  const showToast = useCallback((message: string, duration = 2600) => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    setToast(message)
    toastTimerRef.current = window.setTimeout(() => { setToast(''); toastTimerRef.current = null }, duration)
  }, [])

  const refreshWorkspaceList = useCallback(async () => {
    const summaries = await client.listWorkspaces()
    setWorkspaces(summaries)
    return summaries
  }, [client])

  const clearHistory = useCallback(() => {
    undoRef.current = []
    redoRef.current = []
    setHistoryVersion((value) => value + 1)
  }, [])

  const applyWorkspace = useCallback((next: WorkspaceState) => {
    const nextDraft = draftFromWorkspace(next)
    workspaceRef.current = next
    draftRef.current = nextDraft
    setWorkspace(next)
    setDraft(nextDraft)
    lastPersistedSignatureRef.current = draftSignature(nextDraft)
    pendingSaveRef.current = null
    setSelectedNodeIds([])
    setSelectedEdgeIds([])
    setShowInspector(true)
    saveStateRef.current = 'saved'
    setSaveState('saved')
    setErrorMessage('')
    clearHistory()
  }, [clearHistory])

  const loadInitial = useCallback(async () => {
    try {
      setBusyMessage('Opening Clarity Core')
      setLoadState('loading')
      setErrorMessage('')
      const [summaries, status] = await Promise.all([client.listWorkspaces(), client.status()])
      setWorkspaces(summaries)
      setCoreStatus(status)
      if (summaries.length) applyWorkspace(await client.getWorkspace(summaries[0].id))
      else {
        setWorkspace(null)
        setDraft(null)
      }
      setLoadState('ready')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Clarity Core could not be opened.')
      setLoadState('error')
    }
  }, [applyWorkspace, client])

  useEffect(() => { void loadInitial() }, [loadInitial])

  const applyDraft = useCallback((next: HumanDraft, recordHistory = true) => {
    const current = draftRef.current
    if (recordHistory && current) {
      undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), cloneDraft(current)]
      redoRef.current = []
      setHistoryVersion((value) => value + 1)
    }
    draftRef.current = next
    setDraft(next)
  }, [])

  const updateEphemeralDraft = useCallback((updater: (current: HumanDraft) => HumanDraft) => {
    const current = draftRef.current
    if (!current) return
    const next = updater(current)
    draftRef.current = next
    setDraft(next)
  }, [])

  const normalizeRevertedDraft = useCallback(() => {
    if (savePromiseRef.current || saveStateRef.current === 'conflict') return false
    const currentDraft = draftRef.current
    if (!currentDraft || draftSignature(currentDraft) !== lastPersistedSignatureRef.current) return false

    const hadUnsavedState = Boolean(pendingSaveRef.current)
      || saveTimerRef.current !== null
      || saveStateRef.current === 'saving'
      || saveStateRef.current === 'error'
    pendingSaveRef.current = null
    if (saveTimerRef.current !== null) {
      window.clearTimeout(saveTimerRef.current)
      saveTimerRef.current = null
    }
    saveStateRef.current = 'saved'
    setSaveState('saved')
    if (hadUnsavedState) setErrorMessage('')
    return true
  }, [])

  const flushPendingSave = useCallback(async (): Promise<boolean> => {
    if (savePromiseRef.current) return savePromiseRef.current
    if (normalizeRevertedDraft()) return true
    const operation = (async () => {
      if (saveTimerRef.current !== null) {
        window.clearTimeout(saveTimerRef.current)
        saveTimerRef.current = null
      }
      while (true) {
        if (saveStateRef.current === 'conflict') return false
        const currentWorkspace = workspaceRef.current
        const currentDraft = draftRef.current
        if (currentWorkspace && currentDraft) {
          const currentSignature = draftSignature(currentDraft)
          if (currentSignature !== lastPersistedSignatureRef.current && pendingSaveRef.current?.signature !== currentSignature) {
            pendingSaveRef.current = {
              workspaceId: currentWorkspace.id,
              signature: currentSignature,
              input: humanSaveInput(currentDraft, currentWorkspace.revision),
            }
          }
        }

        const pending = pendingSaveRef.current
        if (!pending) {
          saveStateRef.current = 'saved'
          setSaveState('saved')
          return true
        }
        saveStateRef.current = 'saving'
        setSaveState('saving')

        try {
          const saved = await client.saveHumanWorkspace(pending.workspaceId, pending.input)
          workspaceRef.current = saved
          setWorkspace(saved)
          lastPersistedSignatureRef.current = pending.signature
          if (pendingSaveRef.current?.signature === pending.signature) pendingSaveRef.current = null

          const latestDraft = draftRef.current
          if (latestDraft && draftSignature(latestDraft) === pending.signature) {
            const savedDraft = draftFromWorkspace(saved)
            draftRef.current = savedDraft
            setDraft(savedDraft)
            lastPersistedSignatureRef.current = draftSignature(savedDraft)
          } else if (pendingSaveRef.current) {
            pendingSaveRef.current.input.expectedRevision = saved.revision
          }
          await refreshWorkspaceList()
        } catch (error) {
          const message = error instanceof Error ? error.message : 'The human workspace could not be saved.'
          setErrorMessage(message)
          if (errorCode(error) === 'WORKSPACE_CONFLICT') {
            saveStateRef.current = 'conflict'
            setSaveState('conflict')
          } else {
            saveStateRef.current = 'error'
            setSaveState('error')
          }
          return false
        }
      }
    })()

    let trackedOperation: Promise<boolean>
    trackedOperation = (async () => {
      let result = false
      try {
        result = await operation
      } finally {
        savePromiseRef.current = null
      }
      return result || normalizeRevertedDraft()
    })()
    savePromiseRef.current = trackedOperation
    return trackedOperation
  }, [client, normalizeRevertedDraft, refreshWorkspaceList])

  useEffect(() => {
    if (!workspace || !draft) return
    const signature = draftSignature(draft)
    if (signature === lastPersistedSignatureRef.current) {
      normalizeRevertedDraft()
      return
    }
    pendingSaveRef.current = {
      workspaceId: workspace.id,
      signature,
      input: humanSaveInput(draft, workspaceRef.current?.revision ?? workspace.revision),
    }
    if (saveState === 'conflict' || saveState === 'error') return
    setSaveState('saving')
    if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
    saveTimerRef.current = window.setTimeout(() => { void flushPendingSave() }, 350)
  }, [draft, flushPendingSave, normalizeRevertedDraft, saveState, workspace])

  useEffect(() => {
    const flushWhenHidden = () => { if (document.visibilityState === 'hidden' && saveState !== 'conflict') void flushPendingSave() }
    const pageHide = () => { if (saveState !== 'conflict') void flushPendingSave() }
    const pointerUp = () => { if (saveState !== 'conflict') void flushPendingSave() }
    document.addEventListener('visibilitychange', flushWhenHidden)
    window.addEventListener('pagehide', pageHide)
    window.addEventListener('pointerup', pointerUp)
    return () => {
      document.removeEventListener('visibilitychange', flushWhenHidden)
      window.removeEventListener('pagehide', pageHide)
      window.removeEventListener('pointerup', pointerUp)
      if (saveTimerRef.current !== null) window.clearTimeout(saveTimerRef.current)
      if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current)
    }
  }, [flushPendingSave, saveState])

  useEffect(() => {
    if (!window.clarityLifecycle) return
    return window.clarityLifecycle.onPrepareClose(async () => {
      const saved = await flushPendingSave()
      if (!saved) {
        setErrorMessage((message) => message || 'Clarity kept the window open because the pending workspace could not be saved.')
        return
      }
      await window.clarityLifecycle?.confirmCloseReady()
    })
  }, [flushPendingSave])

  const ensureSaved = useCallback(async () => {
    if (saveState === 'conflict') return false
    return flushPendingSave()
  }, [flushPendingSave, saveState])

  const createWorkspace = async (event: FormEvent) => {
    event.preventDefault()
    const name = newWorkspaceName.trim()
    if (!name) return
    if (workspace && !(await ensureSaved())) return
    setCreatingWorkspace(true)
    setErrorMessage('')
    try {
      const created = await client.createWorkspace(name)
      applyWorkspace(created)
      await refreshWorkspaceList()
      setNewWorkspaceName('')
      setLoadState('ready')
      showToast('Workspace created in Clarity Core')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The workspace could not be created.')
      if (!workspace) setLoadState('error')
    } finally {
      setCreatingWorkspace(false)
    }
  }

  const switchWorkspace = useCallback(async (workspaceId: string) => {
    if (workspaceId === workspaceRef.current?.id) return
    if (!(await ensureSaved())) return
    try {
      setBusyMessage('Switching workspace')
      setLoadState('loading')
      applyWorkspace(await client.getWorkspace(workspaceId))
      setLoadState('ready')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Unable to open the selected workspace.')
      setLoadState('error')
    }
  }, [applyWorkspace, client, ensureSaved])

  const deleteCurrentWorkspace = useCallback(async () => {
    const current = workspaceRef.current
    if (!current || !draftRef.current) return
    if (!(await ensureSaved())) return
    if (!window.confirm(`Permanently delete “${current.name}”? This cannot be undone.`)) return
    try {
      await client.deleteWorkspace(current.id, workspaceRef.current?.revision ?? current.revision)
      const summaries = await refreshWorkspaceList()
      if (summaries.length) applyWorkspace(await client.getWorkspace(summaries[0].id))
      else {
        workspaceRef.current = null
        draftRef.current = null
        setWorkspace(null)
        setDraft(null)
        setLoadState('ready')
        clearHistory()
      }
      showToast('Workspace permanently deleted')
    } catch (error) {
      if (errorCode(error) === 'WORKSPACE_DELETED_ARTIFACT_CLEANUP_PENDING') {
        workspaceRef.current = null
        draftRef.current = null
        setWorkspace(null)
        setDraft(null)
        setSelectedNodeIds([])
        setSelectedEdgeIds([])
        clearHistory()
        try {
          const summaries = await refreshWorkspaceList()
          if (summaries.length) applyWorkspace(await client.getWorkspace(summaries[0].id))
          else setLoadState('ready')
        } catch {
          setWorkspaces([])
          setLoadState('ready')
        }
        setErrorMessage('The workspace metadata was deleted, but managed artifact cleanup is still pending. Restart Clarity to retry cleanup safely.')
        return
      }
      setErrorMessage(error instanceof Error ? error.message : 'The workspace could not be deleted.')
      if (errorCode(error) === 'WORKSPACE_CONFLICT') setSaveState('conflict')
    }
  }, [applyWorkspace, clearHistory, client, ensureSaved, refreshWorkspaceList, showToast])

  const commitDraft = useCallback((mutator: (current: HumanDraft) => HumanDraft) => {
    const current = draftRef.current
    if (!current || current.status === 'archived' || saveState === 'conflict') return
    applyDraft(mutator(cloneDraft(current)), true)
  }, [applyDraft, saveState])

  const undo = useCallback(() => {
    const current = draftRef.current
    const previous = undoRef.current.pop()
    if (!current || !previous || current.status === 'archived' || saveState === 'conflict') return
    redoRef.current.push(cloneDraft(current))
    draftRef.current = previous
    setDraft(previous)
    setHistoryVersion((value) => value + 1)
    showToast('Undid last graph change')
  }, [saveState, showToast])

  const redo = useCallback(() => {
    const current = draftRef.current
    const next = redoRef.current.pop()
    if (!current || !next || current.status === 'archived' || saveState === 'conflict') return
    undoRef.current.push(cloneDraft(current))
    draftRef.current = next
    setDraft(next)
    setHistoryVersion((value) => value + 1)
    showToast('Redid graph change')
  }, [saveState, showToast])

  const selectOnlyNode = useCallback((nodeId: string) => {
    updateEphemeralDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => ({ ...node, selected: node.id === nodeId })),
      edges: current.edges.map((edge) => ({ ...edge, selected: false })),
    }))
    setSelectedNodeIds([nodeId])
    setSelectedEdgeIds([])
    setShowInspector(true)
  }, [updateEphemeralDraft])

  const selectOnlyEdge = useCallback((edgeId: string) => {
    updateEphemeralDraft((current) => ({
      ...current,
      nodes: current.nodes.map((node) => ({ ...node, selected: false })),
      edges: current.edges.map((edge) => ({ ...edge, selected: edge.id === edgeId })),
    }))
    setSelectedNodeIds([])
    setSelectedEdgeIds([edgeId])
    setShowInspector(true)
  }, [updateEphemeralDraft])

  const handleGraphSelection = useCallback(({ nodeIds, edgeIds }: { nodeIds: string[]; edgeIds: string[] }) => {
    setSelectedNodeIds((current) => current.length === nodeIds.length && current.every((id, index) => id === nodeIds[index]) ? current : nodeIds)
    setSelectedEdgeIds((current) => current.length === edgeIds.length && current.every((id, index) => id === edgeIds[index]) ? current : edgeIds)
    if (nodeIds.length || edgeIds.length) setShowInspector(true)
  }, [])

  const deleteNodes = useCallback((ids: string[]) => {
    const current = draftRef.current
    if (!ids.length || !current) return
    if (readOnly) {
      setErrorMessage('Restore or reload this workspace before deleting work items.')
      return
    }
    if (ids.some((id) => nodeBelongsToArchivedProject(current, id))) {
      setErrorMessage('Restore the archived side project before deleting any of its work items.')
      return
    }
    const protectedId = ids.find((id) => protectedNodeReason(workspaceRef.current, current, id))
    if (protectedId) {
      setErrorMessage(`This work item is protected by ${protectedNodeReason(workspaceRef.current, current, protectedId)} and cannot be deleted from the human workspace.`)
      return
    }
    if (!window.confirm(`Delete ${ids.length === 1 ? 'this work item' : `${ids.length} work items`} and their relationships? You can Undo this change.`)) return
    const idSet = new Set(ids)
    commitDraft((current) => ({
      ...current,
      nodes: current.nodes.filter((node) => !idSet.has(node.id)),
      edges: current.edges.filter((edge) => !idSet.has(edge.source) && !idSet.has(edge.target)),
      annotations: current.annotations.filter((annotation) => !idSet.has(annotation.nodeId)),
    }))
    setSelectedNodeIds([])
    setSelectedEdgeIds([])
  }, [commitDraft, readOnly])

  const deleteEdge = useCallback((edgeId: string) => {
    const current = draftRef.current
    const edge = current?.edges.find((item) => item.id === edgeId)
    if (!current || !edge) return
    if (readOnly) {
      setErrorMessage('Restore or reload this workspace before deleting relationships.')
      return
    }
    if (relationshipTouchesArchivedProject(current, edge)) {
      setErrorMessage('Restore every archived side project touched by this relationship before deleting it.')
      return
    }
    const protection = protectedEdgeReason(workspaceRef.current, edge)
    if (protection) {
      setErrorMessage(`This relationship is protected as ${protection} and cannot be deleted.`)
      return
    }
    if (!window.confirm('Delete this relationship? You can Undo this change.')) return
    commitDraft((current) => ({ ...current, edges: current.edges.filter((edge) => edge.id !== edgeId) }))
    setSelectedEdgeIds([])
  }, [commitDraft, readOnly])

  const deleteSelection = useCallback((nodeIds: string[], edgeIds: string[]) => {
    const current = draftRef.current
    if (!current || (!nodeIds.length && !edgeIds.length)) return
    if (readOnly) {
      setErrorMessage('Restore or reload this workspace before deleting this selection.')
      return
    }
    if (nodeIds.some((id) => nodeBelongsToArchivedProject(current, id))) {
      setErrorMessage('Restore the archived side project before deleting this selection.')
      return
    }
    const selectedEdges = current.edges.filter((edge) => edgeIds.includes(edge.id))
    if (selectedEdges.some((edge) => relationshipTouchesArchivedProject(current, edge))) {
      setErrorMessage('Restore every archived side project touched by the selected relationships before deleting this selection.')
      return
    }
    const protectedEdge = selectedEdges.find((edge) => protectedEdgeReason(workspaceRef.current, edge))
    if (protectedEdge) {
      setErrorMessage(`This selection contains ${protectedEdgeReason(workspaceRef.current, protectedEdge)} and was not changed.`)
      return
    }
    const protectedId = nodeIds.find((id) => protectedNodeReason(workspaceRef.current, current, id))
    if (protectedId) {
      setErrorMessage(`This selection contains a work item protected by ${protectedNodeReason(workspaceRef.current, current, protectedId)} and was not changed.`)
      return
    }
    const count = nodeIds.length + edgeIds.length
    if (!window.confirm(`Delete ${count} selected ${count === 1 ? 'item' : 'items'}? Work-item relationships are included. You can Undo this change.`)) return
    const nodeIdSet = new Set(nodeIds)
    const edgeIdSet = new Set(edgeIds)
    commitDraft((draftValue) => ({
      ...draftValue,
      nodes: draftValue.nodes.filter((node) => !nodeIdSet.has(node.id)),
      edges: draftValue.edges.filter((edge) => !edgeIdSet.has(edge.id) && !nodeIdSet.has(edge.source) && !nodeIdSet.has(edge.target)),
      annotations: draftValue.annotations.filter((annotation) => !nodeIdSet.has(annotation.nodeId)),
    }))
    setSelectedNodeIds([])
    setSelectedEdgeIds([])
  }, [commitDraft, readOnly])

  const handleNodesChange = useCallback((changes: NodeChange<WorkNode>[]) => {
    const current = draftRef.current
    if (!current) return
    const permittedChanges = changes.filter((change) => {
      if (readOnly && change.type !== 'select' && change.type !== 'dimensions') return false
      if (change.type !== 'position' && change.type !== 'remove') return true
      if (change.type === 'remove' && protectedNodeReason(workspaceRef.current, current, change.id)) return false
      return !nodeBelongsToArchivedProject(current, change.id)
    })
    if (!permittedChanges.length) return
    const semantic = permittedChanges.some((change) => change.type === 'position')
    const next = { ...current, nodes: applyNodeChanges(permittedChanges, current.nodes) }
    if (semantic && !dragStartRef.current) applyDraft(next, true)
    else updateEphemeralDraft(() => next)
  }, [applyDraft, readOnly, updateEphemeralDraft])

  const handleEdgesChange = useCallback((changes: EdgeChange<WorkEdge>[]) => {
    updateEphemeralDraft((current) => ({
      ...current,
      edges: applyEdgeChanges(changes.filter((change) => {
        if (readOnly && change.type !== 'select') return false
        if (change.type !== 'remove') return true
        const edge = current.edges.find((item) => item.id === change.id)
        return !edge || (!relationshipTouchesArchivedProject(current, edge) && !protectedEdgeReason(workspaceRef.current, edge))
      }), current.edges),
    }))
  }, [readOnly, updateEphemeralDraft])

  const handleNodeDragStart: OnNodeDrag<WorkNode> = useCallback((_event, node) => {
    const current = draftRef.current
    if (readOnly || !current || nodeBelongsToArchivedProject(current, node.id)) {
      dragStartRef.current = null
      return
    }
    dragStartRef.current = cloneDraft(current)
  }, [readOnly])

  const handleNodeDragStop: OnNodeDrag<WorkNode> = useCallback(() => {
    const before = dragStartRef.current
    const current = draftRef.current
    dragStartRef.current = null
    if (readOnly || !before || !current || draftSignature(before) === draftSignature(current)) return
    undoRef.current = [...undoRef.current.slice(-(HISTORY_LIMIT - 1)), before]
    redoRef.current = []
    setHistoryVersion((value) => value + 1)
  }, [readOnly])

  const createOrUpdateNode = useCallback((data: WorkNodeData) => {
    const dialog = nodeDialog
    const currentDraft = draftRef.current
    if (!dialog || !currentDraft) return
    if (readOnly) {
      setNodeDialog(null)
      setErrorMessage('Restore or reload this workspace before saving work-item metadata.')
      return
    }
    if (dialog.mode !== 'edit' && currentDraft.nodes.length >= nodeCapacity) {
      setNodeDialog(null)
      setErrorMessage('This workspace has reached the 5,000 work-item limit. Delete an unprotected item before adding or duplicating another.')
      return
    }
    if (!isHumanNodeKind(data.kind)) {
      setNodeDialog(null)
      setErrorMessage('Create and edit only human workspace item types in this editor.')
      return
    }
    if (dialog.mode === 'edit' && dialog.node && nodeBelongsToArchivedProject(currentDraft, dialog.node.id)) {
      setNodeDialog(null)
      setErrorMessage('Restore this side project before editing its work items.')
      return
    }
    if (dialog.node && (dialog.node.data.origin === 'approved-ai' || !isHumanNodeKind(dialog.node.data.kind))) {
      setNodeDialog(null)
      setErrorMessage('This workflow-managed item has read-only metadata in the human workspace.')
      return
    }
    if (data.projectId && currentDraft.projects.some((project) => project.id === data.projectId && project.status === 'archived')) {
      setNodeDialog(null)
      setErrorMessage('Choose the workspace root or an active side project before saving this work item.')
      return
    }
    const now = new Date().toISOString()
    if (dialog.mode === 'edit' && dialog.node) {
      commitDraft((current) => {
        const nodes = current.nodes.map((node) => node.id === dialog.node?.id ? { ...node, data: { ...data, origin: node.data.origin ?? 'human', createdAt: node.data.createdAt, updatedAt: now } } : node)
        return { ...current, nodes, edges: current.edges.map((edge) => ({ ...edge, data: { ...edge.data!, ...relationStyle(nodes, edge.source, edge.target) } })) }
      })
      showToast('Work item updated')
    } else {
      const current = draftRef.current
      if (!current) return
      const index = current.nodes.length
      const id = uniqueId(data.kind)
      const node: WorkNode = {
        id,
        type: 'workNode',
        position: boundedNodePosition(index),
        selected: true,
        data: { ...data, origin: 'human', createdAt: now, updatedAt: now },
      }
      commitDraft((next) => ({ ...next, nodes: [...next.nodes.map((item) => ({ ...item, selected: false })), node], edges: next.edges.map((edge) => ({ ...edge, selected: false })) }))
      setSelectedNodeIds([id])
      setSelectedEdgeIds([])
      showToast(dialog.mode === 'duplicate' ? 'Duplicate added to graph' : 'Work item added')
    }
    setNodeDialog(null)
  }, [commitDraft, nodeCapacity, nodeDialog, readOnly, showToast])

  const saveRelationship = useCallback(({ source, target, relation }: { source: string; target: string; relation: string }) => {
    const dialog = relationDialog
    const currentDraft = draftRef.current
    if (!dialog || !currentDraft) return
    if (readOnly) {
      setRelationDialog(null)
      setErrorMessage('Restore or reload this workspace before saving relationships.')
      return
    }
    if (nodeBelongsToArchivedProject(currentDraft, source) || nodeBelongsToArchivedProject(currentDraft, target)) {
      setRelationDialog(null)
      setErrorMessage('Restore the archived side project before creating or editing a relationship to one of its work items.')
      return
    }
    if (dialog.edge && protectedEdgeReason(workspaceRef.current, dialog.edge)) {
      setRelationDialog(null)
      setErrorMessage('This approved evidence relationship is read-only and cannot be edited.')
      return
    }
    const now = new Date().toISOString()
    if (dialog.edge) {
      commitDraft((current) => ({
        ...current,
        edges: current.edges.map((edge) => edge.id === dialog.edge?.id ? {
          ...edge,
          source,
          target,
          data: { ...edge.data!, relation, ...relationStyle(current.nodes, source, target), createdAt: edge.data?.createdAt, updatedAt: now },
        } : edge),
      }))
      showToast('Relationship updated')
    } else {
      const id = uniqueId('edge')
      commitDraft((current) => ({
        ...current,
        edges: [...current.edges.map((edge) => ({ ...edge, selected: false })), {
          id,
          source,
          target,
          type: 'relation',
          selected: true,
          data: { relation, ...relationStyle(current.nodes, source, target), createdAt: now, updatedAt: now },
        }],
      }))
      setSelectedNodeIds([])
      setSelectedEdgeIds([id])
      showToast('Relationship added')
    }
    setRelationDialog(null)
  }, [commitDraft, readOnly, relationDialog, showToast])

  const reverseEdge = useCallback((edge: WorkEdge) => {
    const current = draftRef.current
    if (readOnly || !current) {
      setErrorMessage('Restore or reload this workspace before reversing relationships.')
      return
    }
    if (relationshipTouchesArchivedProject(current, edge)) {
      setErrorMessage('Restore every archived side project touched by this relationship before reversing it.')
      return
    }
    const protection = protectedEdgeReason(workspaceRef.current, edge)
    if (protection) {
      setErrorMessage(`This relationship is protected as ${protection} and cannot be reversed.`)
      return
    }
    const now = new Date().toISOString()
    commitDraft((current) => ({ ...current, edges: current.edges.map((item) => item.id === edge.id ? { ...item, source: item.target, target: item.source, data: { ...item.data!, ...relationStyle(current.nodes, item.target, item.source), updatedAt: now } } : item) }))
    showToast('Relationship direction reversed')
  }, [commitDraft, readOnly, showToast])

  const toggleNodePin = useCallback((nodeId: string) => {
    const current = draftRef.current
    if (readOnly || !current || nodeBelongsToArchivedProject(current, nodeId)) {
      setErrorMessage('Restore this side project before pinning or unpinning its work items.')
      return
    }
    const now = new Date().toISOString()
    commitDraft((current) => ({ ...current, nodes: current.nodes.map((node) => node.id === nodeId ? { ...node, data: { ...node.data, pinned: !node.data.pinned, updatedAt: now } } : node) }))
  }, [commitDraft, readOnly])

  const addAnnotation = useCallback((nodeId: string, body: string) => {
    const currentWorkspace = workspaceRef.current
    const currentDraft = draftRef.current
    if (!currentWorkspace || !currentDraft) return
    if (readOnly || nodeBelongsToArchivedProject(currentDraft, nodeId)) {
      setErrorMessage('Restore this workspace and side project before adding human annotations.')
      return
    }
    const now = new Date().toISOString()
    const value: ClarityAnnotation = { id: uniqueId('annotation'), workspaceId: currentWorkspace.id, nodeId, author: 'human', body, createdAt: now, updatedAt: now }
    commitDraft((current) => ({ ...current, annotations: [...current.annotations, value] }))
    showToast('Human annotation added')
  }, [commitDraft, readOnly, showToast])

  const editAnnotation = useCallback((annotationId: string, body: string) => {
    const current = draftRef.current
    const annotation = current?.annotations.find((item) => item.id === annotationId)
    if (!current || !annotation || annotation.author !== 'human') return
    if (readOnly || nodeBelongsToArchivedProject(current, annotation.nodeId)) {
      setErrorMessage('Restore this workspace and side project before editing human annotations.')
      return
    }
    const now = new Date().toISOString()
    commitDraft((current) => ({ ...current, annotations: current.annotations.map((annotation) => annotation.id === annotationId && annotation.author === 'human' ? { ...annotation, body, updatedAt: now } : annotation) }))
  }, [commitDraft, readOnly])

  const deleteAnnotation = useCallback((annotationId: string) => {
    const current = draftRef.current
    const annotation = current?.annotations.find((item) => item.id === annotationId)
    if (!current || !annotation || annotation.author !== 'human') return
    if (readOnly || nodeBelongsToArchivedProject(current, annotation.nodeId)) {
      setErrorMessage('Restore this workspace and side project before deleting human annotations.')
      return
    }
    if (!window.confirm('Delete this human annotation? You can Undo this change.')) return
    commitDraft((current) => ({ ...current, annotations: current.annotations.filter((annotation) => annotation.id !== annotationId || annotation.author !== 'human') }))
  }, [commitDraft, readOnly])

  const saveProject = useCallback(({ name, description }: { name: string; description: string }) => {
    const currentWorkspace = workspaceRef.current
    const currentDraft = draftRef.current
    if (!currentWorkspace || !currentDraft || !projectDialog) return
    if (readOnly) {
      setProjectDialog(null)
      setErrorMessage('Restore or reload this workspace before saving side projects.')
      return
    }
    if (projectDialog !== 'create' && currentDraft.projects.some((project) => project.id === projectDialog.id && project.status === 'archived')) {
      setProjectDialog(null)
      setErrorMessage('Restore this side project before renaming it.')
      return
    }
    const now = new Date().toISOString()
    if (projectDialog === 'create') {
      const project: ClarityProject = { id: uniqueId('project'), workspaceId: currentWorkspace.id, name, description, status: 'active', createdAt: now, updatedAt: now }
      commitDraft((current) => ({ ...current, projects: [...current.projects, project] }))
      setProjectFilter(project.id)
      showToast('Side project created')
    } else {
      commitDraft((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectDialog.id ? { ...project, name, description, updatedAt: now } : project) }))
      showToast('Side project updated')
    }
    setProjectDialog(null)
  }, [commitDraft, projectDialog, readOnly, showToast])

  const setProjectStatus = useCallback((projectId: string, status: ClarityProject['status']) => {
    const project = draftRef.current?.projects.find((item) => item.id === projectId)
    if (!project || project.status === status || readOnly) return
    const now = new Date().toISOString()
    commitDraft((current) => ({ ...current, projects: current.projects.map((project) => project.id === projectId ? { ...project, status, updatedAt: now } : project) }))
    if (status === 'archived') setProjectFilter('all')
    showToast(status === 'archived' ? 'Side project archived' : 'Side project restored')
  }, [commitDraft, readOnly, showToast])

  const deleteProject = useCallback((projectId: string) => {
    const project = draftRef.current?.projects.find((item) => item.id === projectId)
    if (!project) return
    if (readOnly) {
      setErrorMessage('Restore or reload this workspace before deleting side projects.')
      return
    }
    if (project.status === 'archived') {
      setErrorMessage('Restore this side project before deleting it.')
      return
    }
    const protection = protectedProjectReason(workspaceRef.current, projectId)
    if (protection) {
      setErrorMessage(`This side project is protected by ${protection} and cannot be deleted.`)
      return
    }
    if (!window.confirm(`Delete side project “${project.name}”? Its items will move to the workspace root.`)) return
    const now = new Date().toISOString()
    commitDraft((current) => {
      const nodes = current.nodes.map((node) => node.data.projectId === projectId ? { ...node, data: { ...node.data, projectId: undefined, updatedAt: now } } : node)
      return {
        ...current,
        projects: current.projects.filter((item) => item.id !== projectId),
        nodes,
        edges: current.edges.map((edge) => ({ ...edge, data: { ...edge.data!, ...relationStyle(nodes, edge.source, edge.target), updatedAt: now } })),
      }
    })
    setProjectFilter('all')
    showToast('Side project deleted; its items moved to the workspace root')
  }, [commitDraft, readOnly, showToast])

  const setWorkspaceStatus = useCallback((status: WorkspaceStatus) => {
    const current = draftRef.current
    if (!current || saveState === 'conflict') return
    applyDraft({ ...cloneDraft(current), status }, true)
    showToast(status === 'archived' ? 'Workspace archived and now read-only' : 'Workspace restored')
  }, [applyDraft, saveState, showToast])

  const saveWorkspaceName = useCallback(() => {
    const name = renameWorkspaceValue.trim()
    const current = draftRef.current
    if (!name || !current) return
    applyDraft({ ...cloneDraft(current), name }, true)
    setRenameWorkspaceOpen(false)
    showToast('Workspace renamed')
  }, [applyDraft, renameWorkspaceValue, showToast])

  const refreshAuthoritative = useCallback(async () => {
    const current = workspaceRef.current
    if (!current || !(await ensureSaved())) return
    try {
      setBusyMessage('Refreshing authoritative workspace')
      setLoadState('loading')
      const authoritative = await client.getWorkspace(current.id)
      const changed = authoritative.revision !== workspaceRef.current?.revision
      applyWorkspace(authoritative)
      await refreshWorkspaceList()
      setLoadState('ready')
      showToast(changed ? 'Loaded newer changes from Clarity Core' : 'Workspace is current')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The authoritative workspace could not be refreshed.')
      setLoadState('ready')
    }
  }, [applyWorkspace, client, ensureSaved, refreshWorkspaceList, showToast])

  const exportWorkspace = useCallback((format: 'document' | 'jsonld') => {
    const currentWorkspace = workspaceRef.current
    const currentDraft = draftRef.current
    if (!currentWorkspace || !currentDraft) return
    const exportState: WorkspaceState = { ...currentWorkspace, name: currentDraft.name, status: currentDraft.status, projects: currentDraft.projects, annotations: currentDraft.annotations }
    const stem = safeFilename(currentDraft.name)
    if (format === 'jsonld') downloadJson(`${stem}.jsonld`, createWorkspaceJsonLd(exportState, currentDraft.nodes, currentDraft.edges, currentDraft.annotations), 'application/ld+json')
    else downloadJson(`${stem}.clarity.json`, createClarityWorkspaceDocument(exportState, currentDraft.nodes, currentDraft.edges, currentDraft.annotations))
    showToast(format === 'jsonld' ? 'Lossless JSON-LD exported' : 'Portable workspace exported')
  }, [showToast])

  const importWorkspace = useCallback(async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    if (file.size > MAX_IMPORT_BYTES) {
      setErrorMessage('This workspace document is larger than the 25 MiB import limit. It was not read or imported.')
      setLoadState('ready')
      return
    }
    if (workspace && !(await ensureSaved())) return
    try {
      setBusyMessage('Importing workspace document')
      setLoadState('loading')
      const document = parseClarityWorkspaceDocument(JSON.parse(await file.text()))
      const imported = await client.importWorkspaceDocument(document)
      applyWorkspace(imported)
      await refreshWorkspaceList()
      setLoadState('ready')
      showToast('Workspace document imported')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The workspace document could not be imported.')
      setLoadState(workspaceRef.current ? 'ready' : 'error')
    }
  }, [applyWorkspace, client, ensureSaved, refreshWorkspaceList, showToast, workspace])

  const ingestFileDescriptors = useCallback(async (descriptors: IngestedFileDescriptor[]) => {
    const bridge = window.clarityFiles
    if (!bridge) {
      setErrorMessage('File ingestion requires the Clarity Workflows desktop bridge. Open the packaged desktop application to choose or drop files.')
      return
    }
    if (!descriptors.length) return
    if (readOnly) {
      setErrorMessage('Restore this workspace before ingesting files.')
      return
    }
    const currentNodeCount = workspaceRef.current?.nodes.length ?? 0
    const availableCapacity = MAX_GRAPH_NODES - currentNodeCount
    if (descriptors.length > availableCapacity) {
      setErrorMessage(`Only ${Math.max(0, availableCapacity)} more files can be added; Clarity Core limits a workspace to ${MAX_GRAPH_NODES.toLocaleString()} work items.`)
      return
    }
    if (!(await ensureSaved())) return
    setBusyMessage('Copying and extracting files into Clarity Core')
    setLoadState('loading')
    try {
      let ingestedCount = 0
      for (const descriptor of descriptors) {
        const current = workspaceRef.current
        if (!current) break
        const fileLike = { name: descriptor.originalName, size: descriptor.sizeBytes ?? 0, type: descriptor.mimeType ?? '' }
        const workNode = workNodeFromFile(fileLike, boundedNodePosition(current.nodes.length), current.nodes.length)
        const nodeInput = workgraphToCore([workNode], []).nodes[0]
        const next = await bridge.ingestFileAsNode(current.id, descriptor.sourcePath, { ...nodeInput, origin: 'human' }, {
          originalName: descriptor.originalName,
          mimeType: descriptor.mimeType,
        })
        applyWorkspace(next)
        ingestedCount += 1
        setSelectedNodeIds([workNode.id])
        setShowInspector(true)
      }
      await refreshWorkspaceList()
      setLoadState('ready')
      showToast(ingestedCount === 1 ? 'File copied and classified in Clarity Core' : `${ingestedCount} files copied into Clarity Core`)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The file could not be copied into Clarity Core.')
      setLoadState('ready')
    }
  }, [applyWorkspace, ensureSaved, readOnly, refreshWorkspaceList, showToast])

  const chooseIngestionFiles = useCallback(async () => {
    if (!window.clarityFiles) {
      setErrorMessage('File ingestion requires the Clarity Workflows desktop bridge. Open the packaged desktop application to choose files.')
      return
    }
    try {
      await ingestFileDescriptors(await window.clarityFiles.chooseFiles())
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The file chooser could not be opened.')
    }
  }, [ingestFileDescriptors])

  const handleGraphFileDrop = useCallback(async (files: File[]) => {
    if (!window.clarityFiles) {
      setErrorMessage('File drop is available in the Clarity Workflows desktop application.')
      return
    }
    const descriptors: IngestedFileDescriptor[] = []
    for (const file of files) {
      try {
        const sourcePath = window.clarityFiles.getPathForFile(file)
        if (!sourcePath) throw new Error(`Clarity could not resolve the dropped file “${file.name}”.`)
        descriptors.push({ sourcePath, originalName: file.name, mimeType: file.type || undefined, sizeBytes: file.size })
      } catch {
        setErrorMessage(`Clarity could not resolve the dropped file “${file.name}”. Use Add files to choose it explicitly.`)
        return
      }
    }
    await ingestFileDescriptors(descriptors)
  }, [ingestFileDescriptors])

  const retryArtifactExtraction = useCallback(async (artifact: ClarityArtifact) => {
    if (!window.clarityFiles) {
      setErrorMessage('Extraction retry requires the Clarity Workflows desktop bridge.')
      return
    }
    const current = workspaceRef.current
    if (!current || readOnly) return
    if (!(await ensureSaved())) return
    try {
      setBusyMessage('Retrying content extraction')
      setLoadState('loading')
      await window.clarityFiles.retryArtifactExtraction(current.id, artifact.id)
      const next = await client.getWorkspace(current.id)
      applyWorkspace(next)
      setSelectedNodeIds([artifact.nodeId ?? ''].filter(Boolean))
      setLoadState('ready')
      showToast('Content extraction state refreshed')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Content extraction could not be retried.')
      setLoadState('ready')
    }
  }, [applyWorkspace, client, ensureSaved, readOnly, showToast])

  const reloadAuthoritative = useCallback(async () => {
    const current = workspaceRef.current
    if (!current || !window.confirm('Reload the authoritative Core workspace and discard this unsaved local draft?')) return
    try {
      setBusyMessage('Reloading authoritative workspace')
      setLoadState('loading')
      applyWorkspace(await client.getWorkspace(current.id))
      setLoadState('ready')
      await refreshWorkspaceList()
      showToast('Reloaded the workspace changed in ChatGPT')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'The authoritative workspace could not be reloaded.')
      setLoadState('ready')
    }
  }, [applyWorkspace, client, refreshWorkspaceList, showToast])

  const dialogOpen = Boolean(nodeDialog || relationDialog || projectDialog || renameWorkspaceOpen)
  const isGraphNodeReadOnly = useCallback((nodeId: string) => {
    const current = draftRef.current
    return readOnly || !current || nodeBelongsToArchivedProject(current, nodeId)
  }, [readOnly])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (!draftRef.current || dialogOpen) return
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        if (event.shiftKey) redo(); else undo()
        return
      }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); redo(); return }
      if (modifier && event.key.toLowerCase() === 'k') { event.preventDefault(); searchRef.current?.focus(); return }
      if (modifier && event.key.toLowerCase() === 'n' && !readOnly) {
        event.preventDefault()
        if (event.shiftKey) setProjectDialog('create')
        else if (atNodeCapacity) setErrorMessage('This workspace has reached the 5,000 work-item limit. Delete an unprotected item before adding another.')
        else setNodeDialog({ mode: 'create' })
        return
      }
      if (isEditableTarget(event.target)) return
      if ((event.key === 'Delete' || event.key === 'Backspace') && !readOnly) {
        event.preventDefault()
        if (selectedNodeIds.length + selectedEdgeIds.length > 1) deleteSelection(selectedNodeIds, selectedEdgeIds)
        else if (selectedNodeIds.length) deleteNodes(selectedNodeIds)
        else if (selectedEdgeIds[0]) deleteEdge(selectedEdgeIds[0])
      } else if (event.key === 'Escape') {
        setSelectedNodeIds([])
        setSelectedEdgeIds([])
        setShowInspector(false)
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [atNodeCapacity, deleteEdge, deleteNodes, deleteSelection, dialogOpen, readOnly, redo, selectedEdgeIds, selectedNodeIds, undo])

  const selectedNode = useMemo(() => draft?.nodes.find((node) => node.id === selectedNodeIds[0]), [draft?.nodes, selectedNodeIds])
  const selectedEdge = useMemo(() => draft?.edges.find((edge) => edge.id === selectedEdgeIds[0]), [draft?.edges, selectedEdgeIds])
  const selectedProject = draft?.projects.find((project) => project.id === projectFilter)
  const selectedNodeDeletionReason = useMemo(() => selectedNode && draft ? protectedNodeReason(workspace, draft, selectedNode.id) : null, [draft, selectedNode, workspace])
  const selectedNodeMetadataReason = useMemo(() => selectedNode ? metadataReadOnlyReason(selectedNode) : null, [selectedNode])
  const selectedEdgeMutationReason = useMemo(() => selectedEdge ? protectedEdgeReason(workspace, selectedEdge) : null, [selectedEdge, workspace])
  const selectedProjectDeletionReason = useMemo(() => {
    return selectedProject ? protectedProjectReason(workspace, selectedProject.id) : null
  }, [selectedProject, workspace])
  const selectedMutationReason = useMemo(() => {
    if (!draft) return null
    const protectedNodeId = selectedNodeIds.find((id) => protectedNodeReason(workspace, draft, id))
    if (protectedNodeId) return `This selection contains a work item protected by ${protectedNodeReason(workspace, draft, protectedNodeId)}.`
    const protectedEdge = draft.edges.find((edge) => selectedEdgeIds.includes(edge.id) && protectedEdgeReason(workspace, edge))
    return protectedEdge ? `This selection contains ${protectedEdgeReason(workspace, protectedEdge)}.` : null
  }, [draft, selectedEdgeIds, selectedNodeIds, workspace])
  const selectionTouchesArchivedProject = useMemo(() => {
    if (!draft) return false
    return selectedNodeIds.some((id) => nodeBelongsToArchivedProject(draft, id))
      || selectedEdgeIds.some((id) => {
        const edge = draft.edges.find((item) => item.id === id)
        return Boolean(edge && relationshipTouchesArchivedProject(draft, edge))
      })
  }, [draft, selectedEdgeIds, selectedNodeIds])
  const hasEditableRelationshipEndpoint = useMemo(() => Boolean(draft?.nodes.some((node) => !nodeBelongsToArchivedProject(draft, node.id))), [draft])
  const connectedRelations = useMemo<ConnectedRelation[]>(() => {
    if (!draft || !selectedNode) return []
    return draft.edges.flatMap<ConnectedRelation>((edge) => {
      if (edge.source === selectedNode.id) {
        const node = draft.nodes.find((item) => item.id === edge.target)
        return node ? [{ edge, node, direction: 'outgoing' as const }] : []
      }
      if (edge.target === selectedNode.id) {
        const node = draft.nodes.find((item) => item.id === edge.source)
        return node ? [{ edge, node, direction: 'incoming' as const }] : []
      }
      return []
    })
  }, [draft, selectedNode])

  const filteredGraph = useMemo(() => {
    if (!draft) return { nodes: [] as WorkNode[], edges: [] as WorkEdge[], visibleCount: 0 }
    const query = search.trim().toLowerCase()
    const annotationByNode = new Map<string, string[]>()
    for (const annotation of draft.annotations) annotationByNode.set(annotation.nodeId, [...(annotationByNode.get(annotation.nodeId) ?? []), annotation.body])
    const visibleIds = new Set(draft.nodes.filter((node) => {
      const project = draft.projects.find((item) => item.id === node.data.projectId)
      if (project?.status === 'archived' && !showArchivedProjects && projectFilter !== project.id) return false
      if (kindFilter !== 'all' && node.data.kind !== kindFilter) return false
      if (statusFilter !== 'all' && node.data.status !== statusFilter) return false
      if (priorityFilter !== 'all' && (priorityFilter === 'normal' ? Boolean(node.data.priority) : node.data.priority !== priorityFilter)) return false
      if (projectFilter === 'root' && node.data.projectId) return false
      if (projectFilter !== 'all' && projectFilter !== 'root' && node.data.projectId !== projectFilter) return false
      if (!query) return true
      return [node.data.title, node.data.description, node.data.provenance, node.data.sourceUri ?? '', ...node.data.tags, ...(annotationByNode.get(node.id) ?? [])].join(' ').toLowerCase().includes(query)
    }).map((node) => node.id))
    const nodes = draft.nodes.map((node) => ({
      ...node,
      hidden: !visibleIds.has(node.id),
      draggable: !readOnly && draft.projects.find((project) => project.id === node.data.projectId)?.status !== 'archived',
      connectable: !readOnly && draft.projects.find((project) => project.id === node.data.projectId)?.status !== 'archived',
      ariaLabel: `${kindMeta[node.data.kind].label}: ${node.data.title}; status ${node.data.status}`,
    }))
    const nodeById = new Map(draft.nodes.map((node) => [node.id, node]))
    const edges = draft.edges.map((edge) => ({
      ...edge,
      hidden: !visibleIds.has(edge.source) || !visibleIds.has(edge.target),
      ariaLabel: `${nodeById.get(edge.source)?.data.title ?? edge.source} ${edge.data?.relation ?? 'related to'} ${nodeById.get(edge.target)?.data.title ?? edge.target}`,
    }))
    return { nodes, edges, visibleCount: visibleIds.size }
  }, [draft, kindFilter, priorityFilter, projectFilter, readOnly, search, showArchivedProjects, statusFilter])

  const libraryCounts = useMemo(() => {
    const counts = { code: 0, papers: 0, datasets: 0, dashboards: 0 }
    for (const node of draft?.nodes ?? []) {
      if (node.data.kind === 'code') counts.code += 1
      if (node.data.kind === 'paper' || node.data.kind === 'book') counts.papers += 1
      if (node.data.kind === 'dataset') counts.datasets += 1
      if (node.data.kind === 'dashboard') counts.dashboards += 1
    }
    return counts
  }, [draft?.nodes])

  const displayedWorkspaces = useMemo(() => workspaces.filter((summary) => showArchivedWorkspaces || summary.status === 'active'), [showArchivedWorkspaces, workspaces])
  const displayedProjects = useMemo(() => (draft?.projects ?? []).filter((project) => showArchivedProjects || project.status === 'active'), [draft?.projects, showArchivedProjects])
  const filtersActive = Boolean(search || kindFilter !== 'all' || statusFilter !== 'all' || priorityFilter !== 'all' || projectFilter !== 'all')
  const activities: ClarityActivity[] = workspace?.activities ?? []

  if (loadState === 'loading' && !workspace) return <CenteredState title={busyMessage} copy="Loading your authoritative local workspace…" busy />
  if (loadState === 'error' && !workspace) return <CenteredState title="Clarity Core could not open" copy={errorMessage} tone="error" action={<button className="primary-button" onClick={() => { void loadInitial() }}>Retry</button>} />

  if (!workspace || !draft) {
    return <div className="onboarding-shell"><div className="onboarding-mark"><Sparkles size={28} /></div><div className="eyebrow">Clarity Workflows</div><h1>Create your first workspace</h1><p>Start with an empty, human-owned graph. Clarity inserts no demonstration projects or fabricated sources.</p>{errorMessage && <div className="form-error" role="alert">{errorMessage}</div>}<form className="onboarding-form" onSubmit={createWorkspace}><label htmlFor="workspace-name">Workspace name</label><input id="workspace-name" autoFocus maxLength={500} value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder="For example: Energy market research" /><button className="primary-button" disabled={creatingWorkspace || !newWorkspaceName.trim()} type="submit"><Plus size={15} /> {creatingWorkspace ? 'Creating…' : 'Create empty workspace'}</button></form><button className="text-button onboarding-import" onClick={() => importInputRef.current?.click()}>Import a Clarity workspace document</button><input ref={importInputRef} className="visually-hidden" type="file" accept=".json,.jsonld,application/json,application/ld+json" onChange={(event) => { void importWorkspace(event) }} /></div>
  }

  return (
    <div className="app-frame">
      <aside className="left-sidebar">
        <div className="brand-row"><div className="brand-mark"><Network size={19} /></div><span>Clarity Workflows</span></div>
        <button className="new-button" disabled={readOnly || atNodeCapacity} title={atNodeCapacity ? '5,000 work-item limit reached' : undefined} onClick={() => setNodeDialog({ mode: 'create' })}><Plus size={15} /> Add work item <kbd>Ctrl N</kbd></button>
        {atNodeCapacity && <div className="sidebar-capacity" role="status">5,000 item limit reached. Delete an unprotected item before adding or duplicating another.</div>}
        <nav className="side-nav" aria-label="Workspaces"><div className="nav-section-label">Workspaces</div>{displayedWorkspaces.map((summary) => <button key={summary.id} className={`nav-item ${summary.id === workspace.id ? 'project-active' : ''}`} onClick={() => { void switchWorkspace(summary.id) }}><span className={`project-dot ${summary.status === 'archived' ? 'archived' : 'cyan'}`} /><span className="truncate">{summary.name}</span><span className="nav-count">{summary.nodeCount}</span></button>)}</nav>
        <button className="sidebar-toggle" onClick={() => setShowArchivedWorkspaces((value) => !value)}>{showArchivedWorkspaces ? 'Hide' : 'Show'} archived workspaces ({workspaces.filter((item) => item.status === 'archived').length})</button>
        <form className="sidebar-create" onSubmit={createWorkspace}><input aria-label="New workspace name" maxLength={500} value={newWorkspaceName} onChange={(event) => setNewWorkspaceName(event.target.value)} placeholder="New workspace…" /><button aria-label="Create workspace" disabled={!newWorkspaceName.trim() || creatingWorkspace}><Plus size={13} /></button></form>
        <div className="project-section"><div className="nav-section-label">Side projects <button aria-label="Create side project" disabled={readOnly} onClick={() => setProjectDialog('create')}><Plus size={12} /></button></div><button className={`nav-item ${projectFilter === 'all' ? 'project-active' : ''}`} onClick={() => setProjectFilter('all')}><span className="project-dot violet" /> All projects</button><button className={`nav-item ${projectFilter === 'root' ? 'project-active' : ''}`} onClick={() => setProjectFilter('root')}><span className="project-dot cyan" /> Workspace root</button>{displayedProjects.map((project) => <button key={project.id} className={`nav-item ${projectFilter === project.id ? 'project-active' : ''}`} onClick={() => setProjectFilter(project.id)}><span className={`project-dot ${project.status === 'archived' ? 'archived' : 'amber'}`} /><span className="truncate">{project.name}</span></button>)}<button className="sidebar-toggle" onClick={() => setShowArchivedProjects((value) => !value)}>{showArchivedProjects ? 'Hide' : 'Show'} archived projects</button>{selectedProject && !readOnly && <div className="project-actions">{selectedProject.status === 'archived' ? <button onClick={() => setProjectStatus(selectedProject.id, 'active')}>Restore</button> : <><button onClick={() => setProjectDialog(selectedProject)}>Rename</button><button onClick={() => setProjectStatus(selectedProject.id, 'archived')}>Archive</button>{selectedProjectDeletionReason ? <span className="project-protection">Deletion locked: {selectedProjectDeletionReason}.</span> : <button className="danger-text" onClick={() => deleteProject(selectedProject.id)}>Delete</button>}</>}</div>}</div>
        <div className="library-section"><div className="nav-section-label">Current graph</div><LibraryRow icon={<FileCode2 size={14} />} label="Code" count={libraryCounts.code} /><LibraryRow icon={<Paperclip size={14} />} label="Papers & books" count={libraryCounts.papers} /><LibraryRow icon={<Layers3 size={14} />} label="Datasets" count={libraryCounts.datasets} /><LibraryRow icon={<FolderKanban size={14} />} label="Dashboards" count={libraryCounts.dashboards} /></div>
        <div className="sidebar-bottom"><div className="core-status" role="status" aria-live="polite"><span className={`core-dot ${saveState}`} /><div><strong>{saveState === 'saved' ? 'Saved to Clarity Core' : saveState === 'saving' ? 'Saving changes…' : saveState === 'conflict' ? 'Core conflict detected' : 'Save needs attention'}</strong><span>{coreStatus?.storageMode === 'sqlite' ? `SQLite · revision ${workspace.revision}` : 'Browser preview · temporary memory'}</span></div></div><div className="operator-card"><div className="operator-avatar">Y</div><div><strong>You</strong><span>Human operator</span></div><Zap size={14} /></div></div>
      </aside>
      <main className="main-column">
        <header className="topbar"><div className="topbar-title"><div className="eyebrow">Authoritative workgraph</div><div className="title-line"><h1>{draft.name}</h1>{draft.status === 'archived' && <span className="archived-pill">Archived · read-only</span>}</div><div className="subline"><span>{draft.nodes.length} nodes</span><span>•</span><span>{draft.edges.length} relationships</span><span>•</span><span>{draft.projects.length} side projects</span><span>•</span><span>{workspace.artifacts.length} source files</span></div></div><div className="topbar-actions"><button className="ghost-button" disabled={loadState === 'loading' || saveState === 'conflict'} title={saveState === 'conflict' ? 'Use Reload authoritative to resolve the preserved local draft' : undefined} onClick={() => { void refreshAuthoritative() }}><RotateCcw size={15} /> Refresh</button><button className="ghost-button" disabled={readOnly || !window.clarityFiles} title={!window.clarityFiles ? 'Open the Clarity desktop application to ingest local files' : undefined} onClick={() => { void chooseIngestionFiles() }}><Paperclip size={15} /> Add files</button><button className="ghost-button" onClick={() => { setShowInspector(true); setSelectedNodeIds([]); setSelectedEdgeIds([]) }}><History size={15} /> Activity</button><button className="ghost-button" onClick={() => exportWorkspace('document')}><Download size={15} /> Export</button><button className="ghost-button" onClick={() => exportWorkspace('jsonld')}>JSON-LD</button><button className="ghost-button" onClick={() => importInputRef.current?.click()}>Import</button><input ref={importInputRef} className="visually-hidden" type="file" accept=".json,.jsonld,application/json,application/ld+json" onChange={(event) => { void importWorkspace(event) }} /><button className="icon-button" aria-label={showInspector ? 'Hide inspector' : 'Show inspector'} onClick={() => setShowInspector((value) => !value)}><PanelRight size={16} /></button></div></header>
        <div className="workspace-management"><button onClick={() => { setRenameWorkspaceValue(draft.name); setRenameWorkspaceOpen(true) }} disabled={readOnly}>Rename workspace</button>{draft.status === 'active' ? <button onClick={() => setWorkspaceStatus('archived')} disabled={saveState === 'conflict'}>Archive workspace</button> : <button onClick={() => setWorkspaceStatus('active')} disabled={saveState === 'conflict'}>Restore workspace</button>}<button className="danger-text" onClick={() => { void deleteCurrentWorkspace() }}>Delete workspace</button></div>
        {draft.status === 'archived' && <div className="archived-banner">This workspace is archived. Restore it to edit nodes, relationships, projects, or annotations.</div>}
        {saveState === 'error' && <div className="error-banner" role="alert"><span><strong>Changes remain unsaved.</strong> {errorMessage}</span><button onClick={() => { void flushPendingSave() }}>Retry save</button></div>}
        {saveState === 'conflict' && <div className="error-banner conflict" role="alert"><span><strong>Workspace changed in ChatGPT—reload to reconcile.</strong> Your local draft has not been overwritten.</span><button onClick={() => exportWorkspace('document')}>Export local draft</button><button onClick={() => { void reloadAuthoritative() }}>Reload authoritative</button></div>}
        {errorMessage && saveState !== 'error' && saveState !== 'conflict' && loadState !== 'error' && <div className="error-banner" role="alert"><span>{errorMessage}</span><button onClick={() => setErrorMessage('')}>Dismiss</button></div>}
        <div className="workbar"><div className="history-actions"><button aria-label="Undo" title="Undo (Ctrl+Z)" disabled={readOnly || undoRef.current.length === 0} onClick={undo}>↶ Undo</button><button aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={readOnly || redoRef.current.length === 0} onClick={redo}>↷ Redo</button><span className="history-sentinel" aria-hidden="true">{historyVersion}</span></div><div className="workbar-actions"><button className="tool-button" disabled={readOnly || !hasEditableRelationshipEndpoint} onClick={() => setRelationDialog({})}><Link2 size={14} /> Add relationship</button><button className="tool-button" disabled={readOnly} onClick={() => setProjectDialog('create')}><FolderKanban size={14} /> Add project</button><button className="tool-button primary-tool" title={atNodeCapacity ? '5,000 work-item limit reached' : undefined} disabled={readOnly || atNodeCapacity} onClick={() => setNodeDialog({ mode: 'create' })}><Plus size={14} /> Add item</button></div></div>
        <div className="filterbar"><label className="search-field"><span className="visually-hidden">Search graph</span><input ref={searchRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search titles, tags, provenance, and notes…" /><kbd>Ctrl K</kbd></label><label>Kind<select aria-label="Filter by kind" value={kindFilter} onChange={(event) => setKindFilter(event.target.value as NodeKind | 'all')}><option value="all">All</option>{Object.keys(kindMeta).map((kind) => <option key={kind} value={kind}>{kindMeta[kind as NodeKind].label}</option>)}</select></label><label>Status<select aria-label="Filter by status" value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as NodeStatus | 'all')}><option value="all">All</option>{['verified', 'needs-evidence', 'candidate', 'running', 'complete', 'blocked'].map((status) => <option key={status} value={status}>{status.replace('-', ' ')}</option>)}</select></label><label>Priority<select aria-label="Filter by priority" value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value as typeof priorityFilter)}><option value="all">All</option><option value="normal">Normal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><span className="filter-count">{filteredGraph.visibleCount} visible</span>{filteredGraph.visibleCount > 1 && <button className="text-button" onClick={() => {
          const visibleIds = filteredGraph.nodes.filter((node) => !node.hidden).map((node) => node.id)
          const visibleIdSet = new Set(visibleIds)
          updateEphemeralDraft((current) => ({ ...current, nodes: current.nodes.map((node) => ({ ...node, selected: visibleIdSet.has(node.id) })), edges: current.edges.map((edge) => ({ ...edge, selected: false })) }))
          setSelectedNodeIds(visibleIds)
          setSelectedEdgeIds([])
          setShowInspector(true)
        }}>Select visible items</button>}{filtersActive && <button className="text-button" onClick={() => { setSearch(''); setKindFilter('all'); setStatusFilter('all'); setPriorityFilter('all'); setProjectFilter('all') }}>Clear filters</button>}</div>
        <div className="workspace-content">
          <GraphCanvas nodes={filteredGraph.nodes} edges={filteredGraph.edges} onNodesChange={handleNodesChange} onEdgesChange={handleEdgesChange} onDropFiles={handleGraphFileDrop} onConnect={(connection: Connection) => {
            const current = draftRef.current
            if (readOnly || !current) {
              setErrorMessage('Restore or reconcile this workspace before creating relationships.')
              return
            }
            if ((connection.source && nodeBelongsToArchivedProject(current, connection.source)) || (connection.target && nodeBelongsToArchivedProject(current, connection.target))) {
              setErrorMessage('Restore the archived side project before connecting one of its work items.')
              return
            }
            setRelationDialog({ suggested: connection })
          }} onSelectionChange={handleGraphSelection} onTogglePin={toggleNodePin} isNodeReadOnly={isGraphNodeReadOnly} onNodeDragStart={handleNodeDragStart} onNodeDragStop={handleNodeDragStop} readOnly={readOnly} />
          {!draft.nodes.length && <div className="empty-graph"><div className="empty-graph-mark"><Network size={24} /></div><h2>Your graph is empty</h2><p>Add a real work item. Nothing is created until you enter its title and save the form.</p><button className="primary-button" disabled={readOnly} onClick={() => setNodeDialog({ mode: 'create' })}><Plus size={15} /> Add first work item</button></div>}
          {draft.nodes.length > 0 && filteredGraph.visibleCount === 0 && <div className="empty-graph"><h2>No items match</h2><p>Change or clear the current graph filters.</p><button className="primary-button" onClick={() => { setSearch(''); setKindFilter('all'); setStatusFilter('all'); setPriorityFilter('all'); setProjectFilter('all') }}>Clear filters</button></div>}
          <div className="canvas-legend"><span><i className="legend-dot source" /> Human workspace item</span><span><i className="legend-line" /> Directed relationship</span><span><i className="legend-line dashed" /> Cross-project</span></div>
          {loadState === 'loading' && <div className="workspace-loading" role="status" aria-live="polite">{busyMessage}…</div>}
        </div>
      </main>
      {showInspector && <Inspector node={selectedNode} edge={selectedEdge} selectedCount={selectedNodeIds.length + selectedEdgeIds.length} selectedNodeIds={selectedNodeIds} selectedEdgeIds={selectedEdgeIds} nodes={draft.nodes} annotations={draft.annotations} activities={activities} artifacts={workspace.artifacts} projects={draft.projects} connectedRelations={connectedRelations} readOnly={readOnly || selectionTouchesArchivedProject} nodeMetadataReadOnlyReason={selectedNodeMetadataReason} nodeDuplicationBlockedReason={atNodeCapacity ? 'The 5,000 work-item limit is reached. Delete an unprotected item before duplicating.' : null} nodeDeletionBlockedReason={selectedNodeDeletionReason} edgeMutationBlockedReason={selectedEdgeMutationReason} selectionMutationBlockedReason={selectedMutationReason} onClose={() => setShowInspector(false)} onEditNode={(node) => setNodeDialog({ mode: 'edit', node })} onDuplicateNode={(node) => setNodeDialog({ mode: 'duplicate', node })} onDeleteNodes={deleteNodes} onDeleteSelection={deleteSelection} onTogglePin={toggleNodePin} onEditEdge={(edge) => setRelationDialog({ edge })} onReverseEdge={reverseEdge} onDeleteEdge={deleteEdge} onSelectNode={selectOnlyNode} onSelectEdge={selectOnlyEdge} onAddAnnotation={addAnnotation} onEditAnnotation={editAnnotation} onDeleteAnnotation={deleteAnnotation} onRetryArtifactExtraction={(artifact) => { void retryArtifactExtraction(artifact) }} />}
      {!showInspector && (selectedNode || selectedEdge) && <button className="open-inspector" onClick={() => setShowInspector(true)}><PanelRight size={15} /> Inspector</button>}
      {toast && <div className="toast" role="status" aria-live="polite"><span className="toast-check">✓</span> {toast}</div>}
      {nodeDialog && <NodeEditorDialog mode={nodeDialog.mode} initial={nodeDialog.node?.data} projects={draft.projects} onCancel={() => setNodeDialog(null)} onSubmit={createOrUpdateNode} />}
      {relationDialog && <RelationshipEditorDialog nodes={draft.nodes} projects={draft.projects} initial={relationDialog.edge} suggested={relationDialog.suggested} onCancel={() => setRelationDialog(null)} onSubmit={saveRelationship} />}
      {projectDialog && <ProjectDialog project={projectDialog === 'create' ? undefined : projectDialog} onCancel={() => setProjectDialog(null)} onSubmit={saveProject} />}
      {renameWorkspaceOpen && <Modal title="Rename workspace" onClose={() => setRenameWorkspaceOpen(false)}><form className="editor-form" onSubmit={(event) => { event.preventDefault(); saveWorkspaceName() }}><label className="field">Workspace name<input data-autofocus value={renameWorkspaceValue} maxLength={500} onChange={(event) => setRenameWorkspaceValue(event.target.value)} /></label><div className="modal-actions"><button type="button" className="ghost-button" onClick={() => setRenameWorkspaceOpen(false)}>Cancel</button><button className="primary-button" disabled={!renameWorkspaceValue.trim()}>Save name</button></div></form></Modal>}
    </div>
  )
}

function CenteredState({ title, copy, tone = 'normal', action, busy = false }: { title: string; copy: string; tone?: 'normal' | 'error'; action?: ReactNode; busy?: boolean }) {
  return <div className={`centered-state ${tone}`} role={tone === 'error' ? 'alert' : 'status'} aria-busy={busy}><div className="onboarding-mark"><Sparkles size={25} /></div><h1>{title}</h1><p>{copy}</p>{action && <div className="centered-action">{action}</div>}</div>
}

function LibraryRow({ icon, label, count }: { icon: ReactNode; label: string; count: number }) {
  return <div className="library-row">{icon}<span>{label}</span><em>{count}</em></div>
}

export default App
