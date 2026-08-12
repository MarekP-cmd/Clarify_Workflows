import { useMemo, useState, type FormEvent } from 'react'
import type { ClarityProject } from '../../plugin/src/types'
import type { WorkEdge, WorkNode } from '../domain'
import { Modal } from './Modal'

type Props = {
  nodes: WorkNode[]
  projects: ClarityProject[]
  initial?: WorkEdge
  suggested?: { source?: string | null; target?: string | null }
  onCancel: () => void
  onSubmit: (value: { source: string; target: string; relation: string }) => void
}

export function RelationshipEditorDialog({ nodes, projects, initial, suggested, onCancel, onSubmit }: Props) {
  const [source, setSource] = useState(initial?.source ?? suggested?.source ?? '')
  const [target, setTarget] = useState(initial?.target ?? suggested?.target ?? '')
  const [relation, setRelation] = useState(initial?.data?.relation ?? '')
  const [error, setError] = useState('')
  const sortedNodes = useMemo(() => {
    const archivedProjectIds = new Set(projects.filter((project) => project.status === 'archived').map((project) => project.id))
    const existingEndpointIds = new Set([initial?.source, initial?.target].filter((value): value is string => Boolean(value)))
    return nodes
      .filter((node) => !node.data.projectId || !archivedProjectIds.has(node.data.projectId) || existingEndpointIds.has(node.id))
      .sort((left, right) => left.data.title.localeCompare(right.data.title))
  }, [initial?.source, initial?.target, nodes, projects])

  const submit = (event: FormEvent) => {
    event.preventDefault()
    const cleanRelation = relation.trim()
    if (!source || !target) {
      setError('Choose both ends of the relationship.')
      return
    }
    if (!cleanRelation) {
      setError('Describe what the relationship means.')
      return
    }
    onSubmit({ source, target, relation: cleanRelation })
  }

  return (
    <Modal title={initial ? 'Edit relationship' : 'Add relationship'} description="Relationships are directed from the source item to the target item." onClose={onCancel}>
      <form className="editor-form" onSubmit={submit}>
        {error && <div className="form-error" role="alert">{error}</div>}
        <label className="field">Source item
          <select data-autofocus value={source} onChange={(event) => { setSource(event.target.value); setError('') }}>
            <option value="">Choose source…</option>
            {sortedNodes.map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}
          </select>
        </label>
        <div className="relationship-reverse-row"><span aria-hidden="true">↓</span><button type="button" className="text-button" onClick={() => { setSource(target); setTarget(source) }}>Reverse direction</button></div>
        <label className="field">Target item
          <select value={target} onChange={(event) => { setTarget(event.target.value); setError('') }}>
            <option value="">Choose target…</option>
            {sortedNodes.map((node) => <option key={node.id} value={node.id}>{node.data.title}</option>)}
          </select>
        </label>
        <label className="field">Relationship meaning <span aria-hidden="true">*</span>
          <input value={relation} maxLength={200} onChange={(event) => { setRelation(event.target.value); setError('') }} placeholder="supports, challenges, depends on…" />
        </label>
        {source && target && source === target && <p className="form-note">This will create a self-relationship. Clarity permits it when it is intentional.</p>}
        <div className="modal-actions"><button type="button" className="ghost-button" onClick={onCancel}>Cancel</button><button className="primary-button" type="submit">{initial ? 'Save relationship' : 'Add relationship'}</button></div>
      </form>
    </Modal>
  )
}
