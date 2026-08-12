import { useEffect, useMemo, useState, type FormEvent } from 'react'
import type { ClarityActivity, ClarityAnnotation, ClarityArtifact, ClarityProject } from '../../plugin/src/types'
import type { WorkEdge, WorkNode } from '../domain'
import { clarityType, kindMeta } from '../domain'
import { AlertTriangle, Check, ExternalLink, FileText, History, Info, Link2, LockKeyhole, MessageSquare, Paperclip, Pin, ShieldCheck, Sparkles, UserRoundCheck, X } from './Icons'

export type ConnectedRelation = {
  edge: WorkEdge
  node: WorkNode
  direction: 'incoming' | 'outgoing'
}

type Props = {
  node?: WorkNode
  edge?: WorkEdge
  selectedCount?: number
  selectedNodeIds?: string[]
  selectedEdgeIds?: string[]
  nodes: WorkNode[]
  annotations: ClarityAnnotation[]
  activities: ClarityActivity[]
  artifacts: ClarityArtifact[]
  projects: ClarityProject[]
  connectedRelations?: ConnectedRelation[]
  readOnly?: boolean
  nodeMetadataReadOnlyReason?: string | null
  nodeDuplicationBlockedReason?: string | null
  nodeDeletionBlockedReason?: string | null
  edgeMutationBlockedReason?: string | null
  selectionMutationBlockedReason?: string | null
  onClose: () => void
  onEditNode: (node: WorkNode) => void
  onDuplicateNode: (node: WorkNode) => void
  onDeleteNodes: (ids: string[]) => void
  onDeleteSelection: (nodeIds: string[], edgeIds: string[]) => void
  onTogglePin: (nodeId: string) => void
  onEditEdge: (edge: WorkEdge) => void
  onReverseEdge: (edge: WorkEdge) => void
  onDeleteEdge: (edgeId: string) => void
  onSelectNode: (nodeId: string) => void
  onSelectEdge: (edgeId: string) => void
  onAddAnnotation: (nodeId: string, body: string) => void
  onEditAnnotation: (annotationId: string, body: string) => void
  onDeleteAnnotation: (annotationId: string) => void
  onRetryArtifactExtraction: (artifact: ClarityArtifact) => void
}

type Tab = 'overview' | 'notes' | 'activity'

function formatTimestamp(value?: string) {
  if (!value) return 'Not recorded'
  const parsed = Date.parse(value)
  if (!Number.isFinite(parsed)) return 'Invalid timestamp'
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(parsed))
}

function AnnotationList({ annotations, readOnly, onEdit, onDelete }: {
  annotations: ClarityAnnotation[]
  readOnly: boolean
  onEdit: (id: string, body: string) => void
  onDelete: (id: string) => void
}) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [body, setBody] = useState('')
  if (!annotations.length) return <p className="empty-connected">No additive annotations yet.</p>
  return <div className="annotation-list">{annotations.map((annotation) => {
    const humanEditable = !readOnly && annotation.author === 'human'
    const imported = annotation.origin === 'imported-unverified'
    const declaredAuthor = annotation.declaredAuthor ?? annotation.author
    const declaredAuthorLabel = declaredAuthor === 'ai' ? 'AI' : declaredAuthor[0].toUpperCase() + declaredAuthor.slice(1)
    return <article key={annotation.id} className={`annotation-card ${annotation.author === 'human' ? 'human' : 'ai'}`}>
      <div className="annotation-heading">{imported ? <AlertTriangle size={15} /> : annotation.author === 'human' ? <MessageSquare size={15} /> : <Sparkles size={15} />} {imported ? `Imported • declared ${declaredAuthorLabel} • unverified` : `${annotation.author} annotation`} <span>•</span> {formatTimestamp(annotation.updatedAt)}</div>
      {editingId === annotation.id ? <form onSubmit={(event) => { event.preventDefault(); const clean = body.trim(); if (clean) onEdit(annotation.id, clean); setEditingId(null) }}>
        <textarea aria-label="Edit annotation" value={body} maxLength={50_000} onChange={(event) => setBody(event.target.value)} />
        <div className="inline-actions"><button type="button" className="text-button" onClick={() => setEditingId(null)}>Cancel</button><button className="primary-small">Save note</button></div>
      </form> : <p>{annotation.body}</p>}
      {humanEditable && editingId !== annotation.id && <div className="inline-actions"><button className="text-button" onClick={() => { setEditingId(annotation.id); setBody(annotation.body) }}>Edit</button><button className="text-button danger-text" onClick={() => onDelete(annotation.id)}>Delete</button></div>}
    </article>
  })}</div>
}

export function Inspector({ node, edge, selectedCount = 0, selectedNodeIds = [], selectedEdgeIds = [], nodes, annotations, activities, artifacts, projects, connectedRelations = [], readOnly = false, nodeMetadataReadOnlyReason, nodeDuplicationBlockedReason, nodeDeletionBlockedReason, edgeMutationBlockedReason, selectionMutationBlockedReason, onClose, onEditNode, onDuplicateNode, onDeleteNodes, onDeleteSelection, onTogglePin, onEditEdge, onReverseEdge, onDeleteEdge, onSelectNode, onSelectEdge, onAddAnnotation, onEditAnnotation, onDeleteAnnotation, onRetryArtifactExtraction }: Props) {
  const [tab, setTab] = useState<Tab>('overview')
  const [annotation, setAnnotation] = useState('')
  useEffect(() => { setAnnotation(''); setTab('overview') }, [node?.id, edge?.id])

  const nodeAnnotations = useMemo(() => node ? annotations.filter((item) => item.nodeId === node.id) : [], [annotations, node])
  const nodeArtifacts = useMemo(() => node ? artifacts.filter((item) => item.nodeId === node.id) : [], [artifacts, node])
  const relevantActivities = useMemo(() => {
    const entityIds = new Set([node?.id, edge?.id].filter((value): value is string => Boolean(value)))
    return activities
      .filter((item) => !entityIds.size || (item.entityId && entityIds.has(item.entityId)))
      .sort((left, right) => {
        const timestampOrder = Date.parse(right.createdAt) - Date.parse(left.createdAt)
        return timestampOrder || right.id.localeCompare(left.id)
      })
      .slice(0, 100)
  }, [activities, edge?.id, node?.id])
  const nodeById = useMemo(() => new Map(nodes.map((item) => [item.id, item])), [nodes])

  if (selectedCount > 1) {
    return <aside className="inspector" aria-label="Selection inspector"><div className="inspector-header"><div><div className="eyebrow">Selection</div><h2>{selectedCount} items selected</h2></div><button aria-label="Close inspector" onClick={onClose}><X size={17} /></button></div><div className="inspector-scroll"><p className="inspector-summary">Bulk deletion is reversible with Undo.</p>{readOnly || selectionMutationBlockedReason ? <p className="protection-note"><LockKeyhole size={14} /> {selectionMutationBlockedReason ?? 'This selection is read-only until its workspace or archived side project is restored or reconciled.'}</p> : <button className="danger-button" onClick={() => onDeleteSelection(selectedNodeIds, selectedEdgeIds)}>Delete selected items</button>}</div></aside>
  }

  if (edge) {
    const source = nodeById.get(edge.source)
    const target = nodeById.get(edge.target)
    return <aside className="inspector" aria-label="Relationship inspector">
      <div className="inspector-header"><div className="inspector-heading"><div className="node-icon large"><Link2 size={18} /></div><div><div className="eyebrow">Directed relationship</div><h2>{edge.data?.relation}</h2></div></div><button aria-label="Close inspector" onClick={onClose}><X size={17} /></button></div>
      <div className="inspector-scroll">
        <section className="inspector-section relationship-summary"><button onClick={() => source && onSelectNode(source.id)}>{source?.data.title ?? edge.source}</button><span>→</span><button onClick={() => target && onSelectNode(target.id)}>{target?.data.title ?? edge.target}</button></section>
        <section className="inspector-section metadata-grid"><div><span className="meta-label">Created</span><strong>{formatTimestamp(edge.data?.createdAt)}</strong></div><div><span className="meta-label">Updated</span><strong>{formatTimestamp(edge.data?.updatedAt)}</strong></div></section>
        {edge.data?.dashed && <p className="cross-project-note">Dashed styling marks a relationship crossing side-project boundaries.</p>}
        {!readOnly && (edgeMutationBlockedReason ? <p className="protection-note"><LockKeyhole size={14} /> This relationship is protected as {edgeMutationBlockedReason}. Its meaning, direction, and existence are read-only.</p> : <div className="stacked-actions"><button className="primary-small" onClick={() => onEditEdge(edge)}>Edit relationship</button><button className="ghost-light" onClick={() => onReverseEdge(edge)}>Reverse direction</button><button className="danger-button" onClick={() => onDeleteEdge(edge.id)}>Delete relationship</button></div>)}
      </div>
    </aside>
  }

  if (!node) {
    return <aside className="inspector empty-inspector" aria-label="Workspace activity"><div className="empty-inspector-icon"><History size={23} /></div><div className="empty-title">Workspace activity</div>{relevantActivities.length ? <div className="activity-list">{relevantActivities.map((item) => <div className="activity-row" key={item.id}><strong>{item.summary}</strong><span>{item.actor} · {formatTimestamp(item.createdAt)}</span></div>)}</div> : <p>No recorded activity yet. Create a real work item to begin.</p>}</aside>
  }

  const meta = kindMeta[node.data.kind]
  const project = projects.find((item) => item.id === node.data.projectId)
  const submitAnnotation = (event: FormEvent) => {
    event.preventDefault()
    const clean = annotation.trim()
    if (!clean) return
    onAddAnnotation(node.id, clean)
    setAnnotation('')
  }

  return (
    <aside className="inspector" aria-label="Work item inspector">
      <div className="inspector-header">
        <div className="inspector-heading"><div className="node-icon large" style={{ color: meta.color, background: `${meta.color}18` }}><FileText size={18} /></div><div><div className="eyebrow">{meta.label}</div><h2>{node.data.title}</h2></div></div>
        <div className="inspector-actions"><button aria-label={node.data.pinned ? 'Unpin item' : 'Pin item'} className={node.data.pinned ? 'active' : ''} disabled={readOnly} onClick={() => onTogglePin(node.id)}><Pin size={15} /></button><button aria-label="Close inspector" onClick={onClose}><X size={17} /></button></div>
      </div>
      <div className="inspector-tabs" role="tablist" aria-label="Inspector views">
        {(['overview', 'notes', 'activity'] as Tab[]).map((value) => <button key={value} role="tab" aria-selected={tab === value} className={tab === value ? 'active' : ''} onClick={() => setTab(value)}>{value[0].toUpperCase() + value.slice(1)}</button>)}
      </div>
      <div className="inspector-scroll">
        {tab === 'overview' && <>
          <section className="inspector-section"><div className="section-label">Summary</div><p className="inspector-summary">{node.data.description || 'No description.'}</p></section>
          <OriginNotice origin={node.data.origin} />
          <section className="inspector-section metadata-grid"><div><span className="meta-label">Status</span><strong className={`status-text status-${node.data.status}`}><Check size={12} /> {node.data.status.replace('-', ' ')}</strong></div><div><span className="meta-label">Priority</span><strong>{node.data.priority ?? 'Normal'}</strong></div><div><span className="meta-label">Side project</span><strong>{project?.name ?? 'Workspace root'}</strong></div><div><span className="meta-label">Schema.org</span><strong>{node.data.schemaType}</strong></div></section>
          {node.data.tags.length > 0 && <section className="inspector-section"><div className="section-label">Tags</div><div className="tag-list">{node.data.tags.map((tag) => <span key={tag}>{tag}</span>)}</div></section>}
          <section className="inspector-section"><div className="section-label">Ontology</div><div className="ontology-row"><span>Schema.org</span><code>https://schema.org/{node.data.schemaType}</code></div><div className="ontology-row"><span>Clarity</span><code>{clarityType(node.data.kind)}</code></div></section>
          <section className="inspector-section"><div className="section-label">Provenance</div><div className="provenance-row"><Info size={14} /><span>{node.data.provenance}</span></div>{node.data.sourceUri && <div className="provenance-row"><ExternalLink size={14} /><code className="truncate">{node.data.sourceUri}</code></div>}</section>
          <section className="inspector-section"><div className="section-label">Source files <span className="count-pill">{nodeArtifacts.length}</span></div>{nodeArtifacts.length ? <div className="artifact-list">{nodeArtifacts.map((artifact) => <article className="artifact-card" key={artifact.id}><div className="artifact-heading"><Paperclip size={14} /><strong title={artifact.originalName}>{artifact.originalName}</strong></div><div className="artifact-meta">{formatBytes(artifact.sizeBytes)} · {artifact.extractionStatus === 'extracted' ? `${artifact.extractedCharacterCount ?? 0} extracted characters` : artifact.extractionStatus === 'unsupported' ? 'Bytes stored · extraction unsupported' : artifact.extractionStatus === 'failed' ? 'Bytes stored · extraction failed' : 'Extraction pending'}</div>{artifact.extractionError && <p className="artifact-error">{artifact.extractionError}</p>}{artifact.extractionStatus === 'extracted' && artifact.extractedText && <pre className="artifact-preview">{artifact.extractedText.slice(0, 800)}{artifact.extractedText.length > 800 ? '\n… preview truncated' : ''}</pre>}{!readOnly && artifact.extractionStatus !== 'extracted' && <button className="text-button" onClick={() => onRetryArtifactExtraction(artifact)}>Retry extraction</button>}</article>)}</div> : <p className="empty-connected">Drop or choose a file to attach source bytes to this item.</p>}</section>
          {node.data.aiAnnotation && <section className="annotation-card ai"><div className="annotation-heading"><Sparkles size={15} /> AI annotation <span>•</span> read-only</div><p>{node.data.aiAnnotation}</p></section>}
          {node.data.humanAnnotation && <section className="annotation-card human"><div className="annotation-heading"><MessageSquare size={15} /> Legacy human annotation</div><p>{node.data.humanAnnotation}</p></section>}
          <section className="inspector-section"><div className="section-label">Relationships <span className="count-pill">{connectedRelations.length}</span></div>{connectedRelations.map(({ edge: relationEdge, node: other, direction }) => <div className="connected-relation" key={relationEdge.id}><button className="connected-item" onClick={() => onSelectNode(other.id)}><Link2 size={13} /><span>{direction === 'outgoing' ? '→' : '←'} {other.data.title}</span></button><button className="relation-chip" onClick={() => onSelectEdge(relationEdge.id)}>{relationEdge.data?.relation}</button></div>)}{connectedRelations.length === 0 && <p className="empty-connected">No relationships yet.</p>}</section>
          {!readOnly && <div className="stacked-actions">{nodeMetadataReadOnlyReason ? <p className="protection-note"><LockKeyhole size={14} /> {nodeMetadataReadOnlyReason}</p> : <><button className="primary-small" onClick={() => onEditNode(node)}>Edit item</button>{nodeDuplicationBlockedReason ? <p className="protection-note"><LockKeyhole size={14} /> {nodeDuplicationBlockedReason}</p> : <button className="ghost-light" onClick={() => onDuplicateNode(node)}>Duplicate</button>}</>}{nodeDeletionBlockedReason ? <p className="protection-note"><LockKeyhole size={14} /> Deletion is locked because this item is protected by {nodeDeletionBlockedReason}.</p> : <button className="danger-button" onClick={() => onDeleteNodes([node.id])}>Delete item</button>}</div>}
        </>}
        {tab === 'notes' && <>
          <AnnotationList annotations={nodeAnnotations} readOnly={readOnly} onEdit={onEditAnnotation} onDelete={onDeleteAnnotation} />
          {!readOnly && <form className="inspector-section annotation-form" onSubmit={submitAnnotation}><label className="section-label" htmlFor={`annotation-${node.id}`}>Add human annotation</label><textarea id={`annotation-${node.id}`} value={annotation} maxLength={50_000} onChange={(event) => setAnnotation(event.target.value)} placeholder="Capture what you want the AI to remember…" /><button className="primary-small"><MessageSquare size={13} /> Add note</button></form>}
        </>}
        {tab === 'activity' && <div className="activity-list">{relevantActivities.length ? relevantActivities.map((item) => <div className="activity-row" key={item.id}><strong>{item.summary}</strong><span>{item.actor} · {formatTimestamp(item.createdAt)}</span>{item.changedFields.length > 0 && <small>{item.changedFields.join(', ')}</small>}</div>) : <p className="empty-connected">No recorded activity for this item.</p>}<div className="timestamp-card"><span>Created</span><strong>{formatTimestamp(node.data.createdAt)}</strong><span>Updated</span><strong>{formatTimestamp(node.data.updatedAt)}</strong></div></div>}
      </div>
    </aside>
  )
}

function formatBytes(value: number) {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / (1024 * 1024)).toFixed(1)} MB`
}

function OriginNotice({ origin }: { origin: WorkNode['data']['origin'] }) {
  if (origin === 'human') {
    return <section className="origin-card human"><UserRoundCheck size={16} /><div><strong>Human-created</strong><span>This item was created in the human workspace.</span></div></section>
  }
  if (origin === 'approved-ai') {
    return <section className="origin-card approved"><ShieldCheck size={16} /><div><strong>Approved AI result</strong><span>Clarity Core records this item as committed through human approval.</span></div></section>
  }
  if (origin === 'imported-unverified') {
    return <section className="origin-card unverified" role="note"><AlertTriangle size={16} /><div><strong>Imported — unverified</strong><span>Origin and authorship claims in the imported document have not been verified.</span></div></section>
  }
  return <section className="origin-card legacy"><Info size={16} /><div><strong>Origin not recorded</strong><span>This legacy item predates origin tracking; Clarity makes no trust claim.</span></div></section>
}
