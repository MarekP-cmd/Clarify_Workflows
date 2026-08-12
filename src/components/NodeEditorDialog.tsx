import { useMemo, useState, type FormEvent } from 'react'
import { NODE_STATUSES, type ClarityProject, type NodeKind, type NodeStatus } from '../../plugin/src/types'
import { kindMeta, type WorkNodeData } from '../domain'
import { Modal } from './Modal'

type Props = {
  mode: 'create' | 'edit' | 'duplicate'
  initial?: WorkNodeData
  projects: ClarityProject[]
  onCancel: () => void
  onSubmit: (data: WorkNodeData) => void
}

const HUMAN_PROVENANCE = 'Created by the human operator in Clarity Workflows'

export const HUMAN_NODE_KINDS = [
  'paper',
  'book',
  'dataset',
  'code',
  'question',
  'hypothesis',
  'dashboard',
  'project',
] as const satisfies readonly NodeKind[]

export function isHumanNodeKind(kind: NodeKind) {
  return (HUMAN_NODE_KINDS as readonly NodeKind[]).includes(kind)
}

function splitTags(value: string) {
  return [...new Set(value.split(',').map((tag) => tag.trim()).filter(Boolean))]
}

export function NodeEditorDialog({ mode, initial, projects, onCancel, onSubmit }: Props) {
  const initialKind = initial && isHumanNodeKind(initial.kind) ? initial.kind : 'question'
  const [title, setTitle] = useState(mode === 'duplicate' && initial ? `${initial.title} copy` : initial?.title ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [kind, setKind] = useState<NodeKind>(initialKind)
  const [status, setStatus] = useState<NodeStatus>(initial?.status ?? 'candidate')
  const [priority, setPriority] = useState<WorkNodeData['priority'] | ''>(initial?.priority ?? '')
  const [tags, setTags] = useState(initial?.tags.join(', ') ?? '')
  const [provenance, setProvenance] = useState(initial?.provenance ?? HUMAN_PROVENANCE)
  const [sourceUri, setSourceUri] = useState(initial?.sourceUri ?? '')
  const initialProjectId = initial?.projectId && (mode === 'edit' || projects.some((project) => project.id === initial.projectId && project.status === 'active')) ? initial.projectId : ''
  const [projectId, setProjectId] = useState(initialProjectId)
  const [error, setError] = useState('')

  const activeProjects = useMemo(() => projects.filter((project) => project.status === 'active' || (mode === 'edit' && project.id === projectId)), [mode, projectId, projects])
  const dialogTitle = mode === 'create' ? 'Add work item' : mode === 'duplicate' ? 'Duplicate work item' : 'Edit work item'

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanTitle = title.trim()
    const cleanProvenance = provenance.trim()
    const parsedTags = splitTags(tags)
    if (!cleanTitle) {
      setError('Enter a title before saving.')
      return
    }
    if (!cleanProvenance) {
      setError('Provenance is required so Clarity never invents where an item came from.')
      return
    }
    const oversizedTag = parsedTags.find((tag) => tag.length > 200)
    if (oversizedTag) {
      setError(`Each tag must be 200 characters or fewer. One entered tag is ${oversizedTag.length} characters.`)
      return
    }
    onSubmit({
      ...(mode === 'edit' ? initial : undefined),
      title: cleanTitle,
      description: description.trim(),
      kind,
      origin: mode === 'edit' ? initial?.origin ?? 'human' : 'human',
      schemaType: kindMeta[kind].schemaType,
      status,
      tags: parsedTags.slice(0, 100),
      provenance: cleanProvenance,
      priority: priority || undefined,
      projectId: projectId || undefined,
      sourceUri: sourceUri.trim() || undefined,
      instruction: undefined,
      agentMode: undefined,
      humanAnnotation: initial?.humanAnnotation,
      aiAnnotation: mode === 'edit' ? initial?.aiAnnotation : undefined,
      evidenceCount: mode === 'edit' ? initial?.evidenceCount : undefined,
      pinned: initial?.pinned,
      createdAt: mode === 'edit' ? initial?.createdAt : undefined,
      updatedAt: mode === 'edit' ? initial?.updatedAt : undefined,
    })
  }

  return (
    <Modal title={dialogTitle} description="Only values you enter are added to the authoritative graph." onClose={onCancel} wide>
      <form className="editor-form" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <div className="form-grid two-columns">
          <label className="field span-two">Title <span aria-hidden="true">*</span>
            <input data-autofocus value={title} maxLength={500} onChange={(event) => { setTitle(event.target.value); setError('') }} />
          </label>
          <label className="field">Item type
            <select value={kind} onChange={(event) => setKind(event.target.value as NodeKind)}>
              {HUMAN_NODE_KINDS.map((value) => <option key={value} value={value}>{kindMeta[value].label}</option>)}
            </select>
          </label>
          <label className="field">Side project
            <select value={projectId} onChange={(event) => setProjectId(event.target.value)}>
              <option value="">Workspace root</option>
              {activeProjects.map((project) => <option key={project.id} value={project.id}>{project.name}{project.status === 'archived' ? ' (archived)' : ''}</option>)}
            </select>
          </label>
          <label className="field span-two">Description
            <textarea value={description} maxLength={10_000} rows={4} onChange={(event) => setDescription(event.target.value)} />
          </label>
          <label className="field">Status
            <select value={status} onChange={(event) => setStatus(event.target.value as NodeStatus)}>
              {NODE_STATUSES.map((value) => <option key={value} value={value}>{value.replace('-', ' ')}</option>)}
            </select>
          </label>
          <label className="field">Priority
            <select value={priority} onChange={(event) => setPriority(event.target.value as WorkNodeData['priority'] | '')}>
              <option value="">Normal</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option>
            </select>
          </label>
          <label className="field span-two">Tags <span className="field-hint">comma separated</span>
            <input value={tags} onChange={(event) => { setTags(event.target.value); setError('') }} placeholder="market, evidence, follow-up" />
          </label>
          <label className="field span-two">Provenance <span aria-hidden="true">*</span>
            <textarea value={provenance} maxLength={2_000} rows={2} onChange={(event) => { setProvenance(event.target.value); setError('') }} />
          </label>
          <label className="field span-two">Source URI
            <input value={sourceUri} maxLength={4_000} onChange={(event) => setSourceUri(event.target.value)} placeholder="Optional reference URL or stable identifier" />
          </label>
        </div>
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button type="submit" className="primary-button">{mode === 'edit' ? 'Save changes' : 'Add to graph'}</button></div>
      </form>
    </Modal>
  )
}
