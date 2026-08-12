import { Handle, Position, type NodeProps } from '@xyflow/react'
import { memo, useContext } from 'react'
import type { CSSProperties } from 'react'
import type { WorkNode } from '../domain'
import { kindMeta, statusLabel } from '../domain'
import { Check, LockKeyhole, Paperclip, Pin, ShieldCheck, Sparkles, AlertTriangle, iconMap } from './Icons'
import { GraphNodeActionContext } from './GraphNodeActions'

export const WorkNodeCard = memo(function WorkNodeCard({ id, data, selected }: NodeProps<WorkNode>) {
  const meta = kindMeta[data.kind]
  const Icon = iconMap[data.kind]
  const { onTogglePin, isNodeReadOnly } = useContext(GraphNodeActionContext)
  const readOnly = isNodeReadOnly?.(id) ?? false
  return (
    <div className={`work-node-card ${selected ? 'is-selected' : ''} kind-${data.kind} origin-${data.origin ?? 'legacy'}`} style={{ '--node-accent': meta.color } as CSSProperties}>
      <Handle className="node-handle node-handle-target" type="target" position={Position.Left} />
      <Handle className="node-handle node-handle-source" type="source" position={Position.Right} />
      <div className="node-card-topline">
        <div className="node-icon" style={{ color: meta.color, background: `${meta.color}18` }}><Icon size={17} strokeWidth={1.8} /></div>
        <span className="node-kind">{meta.label}</span>
        <div className="node-actions nodrag"><button aria-label={data.pinned ? 'Unpin node' : 'Pin node'} title={readOnly ? 'Restore the side project to change this item' : undefined} disabled={readOnly} className={data.pinned ? 'active' : ''} onClick={(event) => { event.stopPropagation(); onTogglePin?.(id) }}><Pin size={13} /></button></div>
      </div>
      <div className="node-title">{data.title}</div>
      {data.origin === 'imported-unverified' && <div className="node-origin-badge unverified"><AlertTriangle size={11} /> Imported — unverified</div>}
      {data.origin === 'approved-ai' && <div className="node-origin-badge approved"><ShieldCheck size={11} /> Approved AI result</div>}
      <div className="node-description">{data.description}</div>
      <div className="node-card-bottom">
        <div className="node-tags">{data.tags.slice(0, 2).map((tag) => <span key={tag} className="node-tag">{tag}</span>)}</div>
        <span className={`node-status status-${data.status}`}>
          {data.status === 'verified' || data.status === 'complete' ? <Check size={11} /> : data.status === 'needs-evidence' || data.status === 'blocked' ? <AlertTriangle size={11} /> : data.status === 'running' ? <Sparkles size={11} /> : <LockKeyhole size={10} />}
          {statusLabel(data.status)}
        </span>
      </div>
      {data.evidenceCount !== undefined && <div className="node-evidence"><Paperclip size={11} /> {data.evidenceCount} evidence pieces</div>}
    </div>
  )
})
