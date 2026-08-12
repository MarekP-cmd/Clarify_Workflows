import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ClarityActivity, DeleteWorkspaceResult, HumanWorkspaceSaveInput, WorkspaceState } from '../plugin/src/types'
import App, { boundedNodePosition, MAX_GRAPH_NODES, MAX_IMPORT_BYTES } from './App'
import { MemoryClarityClient } from './coreClient'

type DelayedSave = {
  workspaceId: string
  input: HumanWorkspaceSaveInput
  release: () => void
}

class DelayedSaveClient extends MemoryClarityClient {
  readonly delayedSaves: DelayedSave[] = []

  override async saveHumanWorkspace(workspaceId: string, input: HumanWorkspaceSaveInput): Promise<WorkspaceState> {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => { release = resolve })
    this.delayedSaves.push({ workspaceId, input: structuredClone(input), release })
    await gate
    return super.saveHumanWorkspace(workspaceId, input)
  }
}

class DelayedFailureClient extends MemoryClarityClient {
  readonly saveInputs: HumanWorkspaceSaveInput[] = []
  releaseFailure: () => void = () => {}
  private failNextSave = true

  override async saveHumanWorkspace(workspaceId: string, input: HumanWorkspaceSaveInput): Promise<WorkspaceState> {
    this.saveInputs.push(structuredClone(input))
    if (!this.failNextSave) return super.saveHumanWorkspace(workspaceId, input)
    this.failNextSave = false
    await new Promise<void>((resolve) => { this.releaseFailure = resolve })
    throw Object.assign(new Error('Injected non-conflict save failure.'), { code: 'INJECTED_SAVE_FAILURE' })
  }
}

class CleanupPendingDeleteClient extends MemoryClarityClient {
  override async deleteWorkspace(workspaceId: string, expectedRevision: number): Promise<DeleteWorkspaceResult> {
    await super.deleteWorkspace(workspaceId, expectedRevision)
    throw Object.assign(new Error('Workspace metadata was deleted but one artifact still needs cleanup.'), { code: 'WORKSPACE_DELETED_ARTIFACT_CLEANUP_PENDING' })
  }
}

async function addWorkItem(title: string, options: { kind?: string; description?: string } = {}) {
  fireEvent.click(screen.getByRole('button', { name: /^Add work item/ }))
  const dialog = await screen.findByRole('dialog', { name: 'Add work item' })
  fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: title } })
  if (options.kind) fireEvent.change(within(dialog).getByLabelText('Item type'), { target: { value: options.kind } })
  if (options.description) fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: options.description } })
  fireEvent.click(within(dialog).getByRole('button', { name: 'Add to graph' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Add work item' })).not.toBeInTheDocument())
}

async function twoWorkspaceClient() {
  const seeder = new MemoryClarityClient()
  const second = await seeder.createWorkspace('Second workspace')
  const first = await seeder.createWorkspace('First workspace')
  first.updatedAt = '2026-08-11T12:00:02.000Z'
  second.updatedAt = '2026-08-11T12:00:01.000Z'
  return { client: new DelayedSaveClient([first, second]), first, second }
}

async function archivedProjectClient() {
  const client = new MemoryClarityClient()
  const empty = await client.createWorkspace('Archived project boundaries')
  const workspace = await client.saveHumanWorkspace(empty.id, {
    expectedRevision: empty.revision,
    name: empty.name,
    status: 'active',
    projects: [
      { id: 'active-project', name: 'Active project', description: '', status: 'active' },
      { id: 'archived-project', name: 'Archived project', description: '', status: 'archived' },
    ],
    nodes: [
      { id: 'active-node', projectId: 'active-project', kind: 'question', title: 'Active project item', description: '', schemaType: 'Question', status: 'candidate', tags: [], provenance: 'Entered by the test operator', position: { x: 100, y: 100 } },
      { id: 'archived-node', projectId: 'archived-project', kind: 'hypothesis', title: 'Archived project item', description: '', schemaType: 'Thing', status: 'candidate', tags: [], provenance: 'Entered by the test operator', position: { x: 420, y: 100 } },
    ],
    edges: [{ id: 'archived-edge', source: 'active-node', target: 'archived-node', relation: 'tests', dashed: true }],
    annotations: [],
  })
  return { client, workspace }
}

async function protectedWorkflowClient() {
  const seed = new MemoryClarityClient()
  const workspace = await seed.createWorkspace('Protected workflow history')
  const timestamp = '2026-08-11T12:30:00.000Z'
  workspace.revision = 8
  workspace.nodes = [
    { id: 'source-node', origin: 'human', kind: 'paper', title: 'Prepared source', description: '', schemaType: 'ScholarlyArticle', status: 'verified', tags: [], provenance: 'Entered by the test operator', position: { x: 100, y: 100 }, createdAt: timestamp, updatedAt: timestamp },
    { id: 'evidence-node', origin: 'human', kind: 'dataset', title: 'Approved evidence', description: '', schemaType: 'Dataset', status: 'verified', tags: [], provenance: 'Entered by the test operator', position: { x: 400, y: 100 }, createdAt: timestamp, updatedAt: timestamp },
    { id: 'approved-result', origin: 'approved-ai', kind: 'result', title: 'Committed result', description: 'Approved synthesis', schemaType: 'CreativeWork', status: 'complete', tags: [], provenance: 'Committed by Clarity Core after approval', position: { x: 700, y: 100 }, createdAt: timestamp, updatedAt: timestamp },
    { id: 'imported-node', origin: 'imported-unverified', kind: 'question', title: 'Imported claim', description: '', schemaType: 'Question', status: 'candidate', tags: [], provenance: 'Declared by an imported document', position: { x: 100, y: 350 }, createdAt: timestamp, updatedAt: timestamp },
  ]
  workspace.edges = [{ id: 'approved-evidence-edge', source: 'evidence-node', target: 'approved-result', relation: 'supports', createdAt: timestamp, updatedAt: timestamp }]
  workspace.annotations = [{ id: 'imported-annotation', workspaceId: workspace.id, nodeId: 'imported-node', author: 'human', origin: 'imported-unverified', declaredAuthor: 'ai', body: 'Imported note body', createdAt: timestamp, updatedAt: timestamp }]
  workspace.runs = [{
    id: 'run-protected', workspaceId: workspace.id, contextId: 'context-protected', intent: 'Synthesize the selected evidence', sourceNodeIds: ['source-node', 'evidence-node'], evidenceRevision: 7, status: 'committed', preGate: { passed: true, issues: [] }, postGate: { passed: true, issues: [] },
    candidate: { title: 'Committed result', synthesis: 'Approved synthesis', hypothesis: 'A bounded claim', counterargument: 'A bounded objection', pressureTest: 'A bounded test', decision: 'mixed', confidence: 0.8, evidenceNodeIds: ['evidence-node'] },
    committedNodeId: 'approved-result', createdAt: timestamp, updatedAt: timestamp,
  }]
  return { client: new MemoryClarityClient([workspace]), workspace }
}

afterEach(() => {
  delete window.clarityLifecycle
  vi.restoreAllMocks()
})

describe('Clarity Workflows human graph workspace', () => {
  it('starts empty and persists only the human-entered work item submitted through the form', async () => {
    const client = new MemoryClarityClient()
    render(<App client={client} />)

    expect(await screen.findByRole('heading', { name: 'Create your first workspace' })).toBeInTheDocument()
    expect(screen.queryByText('Neuroplasticity & Sleep')).not.toBeInTheDocument()
    expect(screen.queryByText('Why We Sleep')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Workspace name'), { target: { value: 'Real Operator Workspace' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create empty workspace' }))

    expect(await screen.findByRole('heading', { name: 'Real Operator Workspace' })).toBeInTheDocument()
    expect(screen.getByText('Your graph is empty')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Add first work item' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add work item' })
    expect((await client.getWorkspace()).nodes).toHaveLength(0)
    expect(Array.from((within(dialog).getByLabelText('Item type') as HTMLSelectElement).options).map((option) => option.value)).toEqual([
      'paper', 'book', 'dataset', 'code', 'question', 'hypothesis', 'dashboard', 'project',
    ])
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Which evidence should we collect?' } })
    fireEvent.change(within(dialog).getByLabelText('Description'), { target: { value: 'A question entered by the human operator.' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to graph' }))

    fireEvent.pointerUp(window)
    await waitFor(async () => {
      const saved = await client.getWorkspace()
      expect(saved.nodes).toHaveLength(1)
      expect(saved.nodes[0]).toMatchObject({
        title: 'Which evidence should we collect?',
        description: 'A question entered by the human operator.',
        kind: 'question',
        origin: 'human',
      })
    })
  })

  it('keeps a 201-character tag in the editor and accepts the 200-character boundary without mutating Core early', async () => {
    const client = new MemoryClarityClient()
    const workspace = await client.createWorkspace('Tag boundary workspace')
    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /^Add work item/ }))
    const dialog = await screen.findByRole('dialog', { name: 'Add work item' })
    const oversizedTag = 'x'.repeat(201)
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Tag boundary item' } })
    fireEvent.change(within(dialog).getByLabelText(/^Tags/), { target: { value: oversizedTag } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to graph' }))

    expect(within(dialog).getByRole('alert')).toHaveTextContent('Each tag must be 200 characters or fewer')
    expect(within(dialog).getByLabelText(/^Tags/)).toHaveValue(oversizedTag)
    expect((await client.getWorkspace(workspace.id))).toMatchObject({ revision: workspace.revision, nodes: [] })

    const boundaryTag = oversizedTag.slice(0, 200)
    fireEvent.change(within(dialog).getByLabelText(/^Tags/), { target: { value: boundaryTag } })
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add to graph' }))
    fireEvent.pointerUp(window)

    await waitFor(async () => expect((await client.getWorkspace(workspace.id)).nodes[0]?.tags).toEqual([boundaryTag]))
    expect((await client.getWorkspace(workspace.id)).revision).toBe(workspace.revision + 1)
  })

  it('opens an existing authoritative workspace without loading browser seed data', async () => {
    const client = new MemoryClarityClient()
    const workspace = await client.createWorkspace('Existing Workspace')
    await client.replaceGraph(workspace.id, [{
      id: 'real-question',
      kind: 'question',
      title: 'What evidence is missing?',
      description: 'A real operator-created work item.',
      schemaType: 'Question',
      status: 'candidate',
      tags: [],
      provenance: 'Created by the test operator',
      position: { x: 100, y: 100 },
    }], [])

    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: 'Existing Workspace' })).toBeInTheDocument()
    expect(await screen.findByText('What evidence is missing?')).toBeInTheDocument()
    expect(await screen.findByText('Saved to Clarity Core')).toBeInTheDocument()
  })

  it('refreshes an idle workspace from the authoritative Core revision', async () => {
    const client = new MemoryClarityClient()
    const empty = await client.createWorkspace('Idle refresh workspace')
    const opened = await client.saveHumanWorkspace(empty.id, {
      expectedRevision: empty.revision,
      name: empty.name,
      status: 'active',
      projects: [],
      nodes: [{ id: 'existing-idle-node', origin: 'human', kind: 'question', title: 'Existing idle item', description: '', schemaType: 'Question', status: 'candidate', tags: [], provenance: 'Entered by the test operator', position: { x: 100, y: 100 } }],
      edges: [],
      annotations: [],
    })
    render(<App client={client} />)
    expect(await screen.findByText('Existing idle item')).toBeInTheDocument()

    const externallyChanged = await client.saveHumanWorkspace(opened.id, {
      expectedRevision: opened.revision,
      name: opened.name,
      status: opened.status,
      projects: [],
      nodes: [...opened.nodes, { id: 'mcp-approved-result', origin: 'approved-ai', kind: 'result', title: 'Result approved through MCP', description: '', schemaType: 'CreativeWork', status: 'complete', tags: [], provenance: 'Committed by Clarity Core', position: { x: 430, y: 100 } }],
      edges: [],
      annotations: [],
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Result approved through MCP')).toBeInTheDocument()
    expect(await screen.findByText('Loaded newer changes from Clarity Core')).toBeInTheDocument()
    expect((await client.getWorkspace(opened.id)).revision).toBe(externallyChanged.revision)
  })

  it('waits for the newest queued edit before switching workspaces', async () => {
    const { client, first } = await twoWorkspaceClient()
    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: 'First workspace' })).toBeInTheDocument()

    await addWorkItem('First queued item')
    fireEvent.pointerUp(window)
    await waitFor(() => expect(client.delayedSaves).toHaveLength(1))

    await addWorkItem('Newest queued item')
    fireEvent.click(screen.getByRole('button', { name: /^Second workspace/ }))
    expect(screen.getByRole('heading', { name: 'First workspace' })).toBeInTheDocument()

    await act(async () => { client.delayedSaves[0].release() })
    await waitFor(() => expect(client.delayedSaves).toHaveLength(2))
    expect(client.delayedSaves[1].input.nodes.map((node) => node.title)).toEqual(['First queued item', 'Newest queued item'])
    expect(screen.getByRole('heading', { name: 'First workspace' })).toBeInTheDocument()

    await act(async () => { client.delayedSaves[1].release() })
    expect(await screen.findByRole('heading', { name: 'Second workspace' })).toBeInTheDocument()
    expect((await client.getWorkspace(first.id)).nodes.map((node) => node.title)).toEqual(['First queued item', 'Newest queued item'])
  })

  it('acknowledges desktop close only after the newest queued edit is durable', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('Close-safe workspace')
    const client = new DelayedSaveClient([workspace])
    let prepareClose: (() => void | Promise<void>) | undefined
    const confirmCloseReady = vi.fn(async () => true)
    window.clarityLifecycle = {
      onPrepareClose(callback) {
        prepareClose = callback
        return () => { prepareClose = undefined }
      },
      confirmCloseReady,
    }

    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: 'Close-safe workspace' })).toBeInTheDocument()
    await waitFor(() => expect(prepareClose).toBeTypeOf('function'))

    await addWorkItem('First close-bound item')
    fireEvent.pointerUp(window)
    await waitFor(() => expect(client.delayedSaves).toHaveLength(1))
    await addWorkItem('Newest close-bound item')

    let closePromise: Promise<void>
    act(() => { closePromise = Promise.resolve(prepareClose?.()) })
    expect(confirmCloseReady).not.toHaveBeenCalled()

    await act(async () => { client.delayedSaves[0].release() })
    await waitFor(() => expect(client.delayedSaves).toHaveLength(2))
    expect(client.delayedSaves[1].input.nodes.map((node) => node.title)).toEqual(['First close-bound item', 'Newest close-bound item'])
    expect(confirmCloseReady).not.toHaveBeenCalled()

    await act(async () => { client.delayedSaves[1].release(); await closePromise! })
    expect(confirmCloseReady).toHaveBeenCalledTimes(1)
    expect((await client.getWorkspace(workspace.id)).nodes.map((node) => node.title)).toEqual(['First close-bound item', 'Newest close-bound item'])
  })

  it('waits for an in-flight failed save, then clears its stale snapshot when Undo restores the durable draft', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('Reverted failure workspace')
    const client = new DelayedFailureClient([workspace])
    let prepareClose: (() => void | Promise<void>) | undefined
    const confirmCloseReady = vi.fn(async () => true)
    window.clarityLifecycle = {
      onPrepareClose(callback) {
        prepareClose = callback
        return () => { prepareClose = undefined }
      },
      confirmCloseReady,
    }

    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()
    await waitFor(() => expect(prepareClose).toBeTypeOf('function'))
    await addWorkItem('Snapshot that must never persist')
    fireEvent.pointerUp(window)
    await waitFor(() => expect(client.saveInputs).toHaveLength(1))
    expect(client.saveInputs[0].nodes.map((node) => node.title)).toEqual(['Snapshot that must never persist'])

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Your graph is empty')).toBeInTheDocument()
    expect(screen.getByText('Saving changes…')).toBeInTheDocument()

    let closePromise: Promise<void>
    act(() => { closePromise = Promise.resolve(prepareClose?.()) })
    expect(confirmCloseReady).not.toHaveBeenCalled()
    await act(async () => { client.releaseFailure(); await closePromise! })

    expect(await screen.findByText('Saved to Clarity Core')).toBeInTheDocument()
    expect(confirmCloseReady).toHaveBeenCalledTimes(1)
    expect(client.saveInputs).toHaveLength(1)
    expect(await client.getWorkspace(workspace.id)).toMatchObject({ revision: workspace.revision, nodes: [] })
    expect(screen.queryByText('Changes remain unsaved.')).not.toBeInTheDocument()
  })

  it('does not cancel a successful in-flight save and durably compensates after Undo', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('In-flight success compensation')
    const client = new DelayedSaveClient([workspace])
    let prepareClose: (() => void | Promise<void>) | undefined
    const confirmCloseReady = vi.fn(async () => true)
    window.clarityLifecycle = {
      onPrepareClose(callback) {
        prepareClose = callback
        return () => { prepareClose = undefined }
      },
      confirmCloseReady,
    }

    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()
    await waitFor(() => expect(prepareClose).toBeTypeOf('function'))
    await addWorkItem('In-flight item A')
    fireEvent.pointerUp(window)
    await waitFor(() => expect(client.delayedSaves).toHaveLength(1))

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Your graph is empty')).toBeInTheDocument()
    expect(screen.getByText('Saving changes…')).toBeInTheDocument()
    let closePromise: Promise<void>
    act(() => { closePromise = Promise.resolve(prepareClose?.()) })
    expect(confirmCloseReady).not.toHaveBeenCalled()

    await act(async () => { client.delayedSaves[0].release() })
    await waitFor(() => expect(client.delayedSaves).toHaveLength(2))
    expect(client.delayedSaves[1].input.nodes).toEqual([])
    expect(confirmCloseReady).not.toHaveBeenCalled()

    await act(async () => { client.delayedSaves[1].release(); await closePromise! })
    expect(confirmCloseReady).toHaveBeenCalledTimes(1)
    expect(await screen.findByText('Saved to Clarity Core')).toBeInTheDocument()
    expect(await client.getWorkspace(workspace.id)).toMatchObject({ revision: workspace.revision + 2, nodes: [] })
  })

  it('clears an already-failed pending snapshot when Undo returns to the persisted signature', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('Failed then reverted workspace')
    const client = new DelayedFailureClient([workspace])
    let prepareClose: (() => void | Promise<void>) | undefined
    const confirmCloseReady = vi.fn(async () => true)
    window.clarityLifecycle = {
      onPrepareClose(callback) {
        prepareClose = callback
        return () => { prepareClose = undefined }
      },
      confirmCloseReady,
    }

    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()
    await waitFor(() => expect(prepareClose).toBeTypeOf('function'))
    await addWorkItem('Already failed snapshot')
    fireEvent.pointerUp(window)
    await waitFor(() => expect(client.saveInputs).toHaveLength(1))
    await act(async () => { client.releaseFailure() })
    expect(await screen.findByText('Changes remain unsaved.')).toBeInTheDocument()
    expect(screen.getByText('Injected non-conflict save failure.')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Your graph is empty')).toBeInTheDocument()
    expect(await screen.findByText('Saved to Clarity Core')).toBeInTheDocument()
    expect(screen.queryByText('Changes remain unsaved.')).not.toBeInTheDocument()

    await act(async () => { await prepareClose?.() })
    expect(confirmCloseReady).toHaveBeenCalledTimes(1)
    expect(client.saveInputs).toHaveLength(1)
    expect(await client.getWorkspace(workspace.id)).toMatchObject({ revision: workspace.revision, nodes: [] })
  })

  it('keeps a conflicted draft visible while blocking graph position and deletion mutations', async () => {
    const client = new MemoryClarityClient()
    const empty = await client.createWorkspace('Conflict-safe workspace')
    const seeded = await client.saveHumanWorkspace(empty.id, {
      expectedRevision: empty.revision,
      name: empty.name,
      status: 'active',
      projects: [],
      nodes: [{ id: 'conflict-node', origin: 'human', kind: 'question', title: 'Original Core title', description: '', schemaType: 'Question', status: 'candidate', tags: [], provenance: 'Entered by the test operator', position: { x: 200, y: 180 } }],
      edges: [],
      annotations: [],
    })
    const { container } = render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: seeded.name })).toBeInTheDocument()

    const externallyChanged = await client.saveHumanWorkspace(seeded.id, {
      expectedRevision: seeded.revision,
      name: seeded.name,
      status: seeded.status,
      projects: [],
      nodes: seeded.nodes,
      edges: seeded.edges,
      annotations: [],
    })
    const saveSpy = vi.spyOn(client, 'saveHumanWorkspace')
    const graphNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="conflict-node"]')
      expect(element).not.toBeNull()
      return element!
    })
    fireEvent.click(graphNode)
    fireEvent.click(await screen.findByRole('button', { name: 'Edit item' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit work item' })
    fireEvent.change(within(dialog).getByLabelText(/^Title/), { target: { value: 'Unsaved local conflict title' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))

    expect(await screen.findByText('Workspace changed in ChatGPT—reload to reconcile.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Unsaved local conflict title' })).toBeInTheDocument()
    expect(graphNode.querySelector('button[aria-label="Pin node"]')).toBeDisabled()
    expect(container.querySelector('button[title="Toggle interactivity"]')).not.toBeInTheDocument()

    saveSpy.mockClear()
    const beforeTransform = graphNode.style.transform
    fireEvent.pointerDown(graphNode, { clientX: 210, clientY: 190, buttons: 1 })
    fireEvent.pointerMove(graphNode, { clientX: 510, clientY: 490, buttons: 1 })
    fireEvent.pointerUp(graphNode, { clientX: 510, clientY: 490 })
    fireEvent.keyDown(window, { key: 'Delete' })
    await act(async () => {})

    expect(graphNode.style.transform).toBe(beforeTransform)
    expect(saveSpy).not.toHaveBeenCalled()
    const authoritative = await client.getWorkspace(seeded.id)
    expect(authoritative.revision).toBe(externallyChanged.revision)
    expect(authoritative.nodes[0]).toMatchObject({ title: 'Original Core title', position: { x: 200, y: 180 } })
  })

  it('rejects pin, keyboard/bulk deletion, and relationship mutations that cross an archived side project', async () => {
    const { client, workspace } = await archivedProjectClient()
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { container } = render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show archived projects' }))

    const archivedNode = await waitFor(() => {
      const value = container.querySelector<HTMLElement>('.react-flow__node[data-id="archived-node"]')
      expect(value).not.toBeNull()
      return value!
    })
    const activeNode = container.querySelector<HTMLElement>('.react-flow__node[data-id="active-node"]')!
    const pin = archivedNode.querySelector<HTMLButtonElement>('button[aria-label="Pin node"]')!
    expect(pin).toBeDisabled()
    fireEvent.click(pin)

    fireEvent.click(archivedNode)
    expect(await screen.findByRole('heading', { name: 'Archived project item' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(await screen.findByText('Restore the archived side project before deleting any of its work items.')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    expect(activeNode).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Select visible items' }))
    expect(await screen.findByRole('heading', { name: '2 items selected' })).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(await screen.findByText('Restore the archived side project before deleting this selection.')).toBeInTheDocument()
    expect(confirm).not.toHaveBeenCalled()

    const persistedAfterDeletes = await client.getWorkspace(workspace.id)
    expect(persistedAfterDeletes.nodes.map((node) => node.id).sort()).toEqual(['active-node', 'archived-node'])
    expect(persistedAfterDeletes.nodes.find((node) => node.id === 'archived-node')?.pinned).toBeFalsy()
    expect(persistedAfterDeletes.edges).toHaveLength(1)

    fireEvent.click(screen.getByRole('button', { name: 'Add relationship' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add relationship' })
    const source = within(dialog).getByLabelText('Source item') as HTMLSelectElement
    expect(within(source).queryByRole('option', { name: 'Archived project item' })).not.toBeInTheDocument()

    const forgedOption = document.createElement('option')
    forgedOption.value = 'archived-node'
    forgedOption.textContent = 'Archived project item'
    source.append(forgedOption)
    fireEvent.change(source, { target: { value: 'archived-node' } })
    fireEvent.change(within(dialog).getByLabelText('Target item'), { target: { value: 'active-node' } })
    fireEvent.change(within(dialog).getByLabelText(/^Relationship meaning/), { target: { value: 'must remain blocked' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add relationship' }))
    expect(await screen.findByText('Restore the archived side project before creating or editing a relationship to one of its work items.')).toBeInTheDocument()
    expect((await client.getWorkspace(workspace.id)).edges).toHaveLength(1)
    expect((await client.getWorkspace(workspace.id)).revision).toBe(workspace.revision)
    expect(container.querySelector('button[title="Toggle interactivity"]')).not.toBeInTheDocument()
  })

  it('mirrors workflow protection and origin trust without stranding an impossible autosave', async () => {
    const { client, workspace } = await protectedWorkflowClient()
    const saveSpy = vi.spyOn(client, 'saveHumanWorkspace')
    const { container } = render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()

    const nodeElement = (id: string) => waitFor(() => {
      const element = container.querySelector<HTMLElement>(`.react-flow__node[data-id="${id}"]`)
      expect(element).not.toBeNull()
      return element!
    })

    fireEvent.click(await nodeElement('source-node'))
    expect(await screen.findByRole('heading', { name: 'Prepared source' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete item' })).not.toBeInTheDocument()
    expect(screen.getByText(/workflow source history/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(await screen.findByRole('alert')).toHaveTextContent('protected by workflow source history')
    expect(saveSpy).not.toHaveBeenCalled()
    expect((await client.getWorkspace(workspace.id)).revision).toBe(8)

    fireEvent.click(await nodeElement('evidence-node'))
    expect(await screen.findByRole('heading', { name: 'Approved evidence' })).toBeInTheDocument()
    expect(screen.getByText(/protected by approved workflow evidence/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'supports' }))
    expect(await screen.findByRole('heading', { name: 'supports' })).toBeInTheDocument()
    expect(screen.getByText(/approved evidence relationship/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit relationship' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reverse direction' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete relationship' })).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Delete' })
    expect(await screen.findByRole('alert')).toHaveTextContent('protected as an approved evidence relationship')
    expect(saveSpy).not.toHaveBeenCalled()

    fireEvent.click(await nodeElement('approved-result'))
    expect(await screen.findByRole('heading', { name: 'Committed result' })).toBeInTheDocument()
    expect(screen.getAllByText('Approved AI result').length).toBeGreaterThanOrEqual(2)
    expect(screen.queryByRole('button', { name: 'Edit item' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete item' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Pin item' })).toBeEnabled()

    fireEvent.click(await nodeElement('imported-node'))
    expect(await screen.findByRole('heading', { name: 'Imported claim' })).toBeInTheDocument()
    expect(screen.getAllByText('Imported — unverified').length).toBeGreaterThanOrEqual(2)
    expect(screen.getByText(/authorship claims.*have not been verified/i)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    const importedBody = screen.getByText('Imported note body')
    expect(importedBody.closest('article')?.querySelector('.annotation-heading')).toHaveTextContent('Imported • declared AI • unverified')
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }))
    fireEvent.change(screen.getByLabelText('Edit annotation'), { target: { value: 'Edited imported note body' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }))
    fireEvent.pointerUp(window)
    await waitFor(() => expect(saveSpy).toHaveBeenCalled())
    expect(saveSpy.mock.calls.at(-1)?.[1].annotations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'imported-annotation', origin: 'imported-unverified', declaredAuthor: 'ai', body: 'Edited imported note body' }),
    ]))
    await waitFor(async () => expect((await client.getWorkspace(workspace.id)).annotations).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'imported-annotation', origin: 'imported-unverified', declaredAuthor: 'ai', body: 'Edited imported note body' }),
    ])))
    fireEvent.click(await nodeElement('imported-node'))
    fireEvent.click(screen.getByRole('tab', { name: 'Notes' }))
    await waitFor(() => {
      const editedBody = screen.getByText('Edited imported note body')
      expect(editedBody.closest('article')?.querySelector('.annotation-heading')).toHaveTextContent('Imported • declared AI • unverified')
    })
  })

  it('rejects an oversized import before reading the file or changing Core state', async () => {
    const client = new MemoryClarityClient()
    const workspace = await client.createWorkspace('Import size boundary')
    const importSpy = vi.spyOn(client, 'importWorkspaceDocument')
    const text = vi.fn(async () => '{}')
    const { container } = render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!
    fireEvent.change(input, { target: { files: [{ name: 'too-large.clarity.json', size: MAX_IMPORT_BYTES + 1, text }] } })

    expect(await screen.findByRole('alert')).toHaveTextContent('larger than the 25 MiB import limit')
    expect(text).not.toHaveBeenCalled()
    expect(importSpy).not.toHaveBeenCalled()
    const persisted = await client.getWorkspace(workspace.id)
    expect(persisted.revision).toBe(workspace.revision)
    expect(await client.listWorkspaces()).toHaveLength(1)
  })

  it('leaves a cleanup-pending deleted workspace immediately and reports the durable cleanup state', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('Delete with managed artifact')
    const client = new CleanupPendingDeleteClient([workspace])
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    render(<App client={client} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Delete workspace' }))

    expect(await screen.findByRole('heading', { name: 'Create your first workspace' })).toBeInTheDocument()
    expect(screen.getByRole('alert')).toHaveTextContent('managed artifact cleanup is still pending')
    expect(screen.queryByRole('heading', { name: workspace.name })).not.toBeInTheDocument()
    await expect(client.getWorkspace(workspace.id)).rejects.toMatchObject({ code: 'WORKSPACE_REQUIRED' })
  })

  it('blocks Add and Duplicate at the 5,000-item Core capacity before creating a draft', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('Full capacity workspace')
    expect(MAX_GRAPH_NODES).toBe(5_000)
    workspace.nodes = [{
      id: 'full-node-0',
      origin: 'human' as const,
      kind: 'question' as const,
      title: 'Full capacity item 0',
      description: '',
      schemaType: 'Question',
      status: 'candidate' as const,
      tags: [],
      provenance: 'Entered by the capacity test operator',
      position: boundedNodePosition(0),
    }]
    const client = new MemoryClarityClient([workspace])
    const saveSpy = vi.spyOn(client, 'saveHumanWorkspace')
    const { container } = render(<App client={client} nodeCapacity={1} />)
    expect(await screen.findByRole('heading', { name: workspace.name })).toBeInTheDocument()

    expect(screen.getByRole('button', { name: /^Add work item/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Add item' })).toBeDisabled()
    expect(screen.getByText(/5,000 item limit reached\. Delete an unprotected item/)).toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'n', ctrlKey: true })
    expect(screen.queryByRole('dialog', { name: 'Add work item' })).not.toBeInTheDocument()

    const firstNode = await waitFor(() => {
      const element = container.querySelector<HTMLElement>('.react-flow__node[data-id="full-node-0"]')
      expect(element).not.toBeNull()
      return element!
    })
    fireEvent.click(firstNode)
    expect(await screen.findByRole('heading', { name: 'Full capacity item 0' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Duplicate' })).not.toBeInTheDocument()
    expect(screen.getByText(/5,000 work-item limit is reached/)).toBeInTheDocument()
    expect(saveSpy).not.toHaveBeenCalled()
    expect((await client.getWorkspace(workspace.id)).nodes).toHaveLength(1)
  })

  it('shows the latest 100 activity records newest-first', async () => {
    const seed = new MemoryClarityClient()
    const workspace = await seed.createWorkspace('Activity ordering workspace')
    workspace.activities = Array.from({ length: 105 }, (_, index): ClarityActivity => ({
      id: `activity-${index}`,
      workspaceId: workspace.id,
      actor: 'human',
      action: index === 104 ? 'deleted' : 'updated',
      entityType: 'workspace',
      entityId: workspace.id,
      summary: index === 104 ? 'Latest deletion was recorded.' : `Historical edit ${index}`,
      changedFields: [],
      createdAt: new Date(Date.UTC(2026, 7, 11, 0, 0, index)).toISOString(),
    }))
    const client = new MemoryClarityClient([workspace])

    const { container } = render(<App client={client} />)
    expect(await screen.findByText('Latest deletion was recorded.')).toBeInTheDocument()
    expect(screen.queryByText('Historical edit 0')).not.toBeInTheDocument()
    expect(container.querySelectorAll('.activity-row')).toHaveLength(100)
    expect(container.querySelector('.activity-row strong')).toHaveTextContent('Latest deletion was recorded.')
  })

  it.each([2_104, 4_999])('auto-places node index %i inside Core coordinate bounds', async (index) => {
    const client = new MemoryClarityClient()
    const workspace = await client.createWorkspace(`Capacity ${index}`)
    const position = boundedNodePosition(index)
    expect(Math.abs(position.x)).toBeLessThanOrEqual(100_000)
    expect(Math.abs(position.y)).toBeLessThanOrEqual(100_000)

    const saved = await client.saveHumanWorkspace(workspace.id, {
      expectedRevision: workspace.revision,
      name: workspace.name,
      status: 'active',
      projects: [],
      nodes: [{ id: `capacity-${index}`, kind: 'question', title: `Capacity node ${index}`, description: '', schemaType: 'Question', status: 'candidate', tags: [], provenance: 'Entered by the capacity test operator', position }],
      edges: [],
      annotations: [],
    })
    expect(saved.nodes[0].position).toEqual(position)
  })
})
