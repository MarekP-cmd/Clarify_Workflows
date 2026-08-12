import { BaseEdge, EdgeLabelRenderer, getBezierPath, type EdgeProps } from '@xyflow/react'
import { memo } from 'react'
import type { WorkEdge } from '../domain'

export const RelationEdge = memo(function RelationEdge({ id, sourceX, sourceY, targetX, targetY, sourcePosition, targetPosition, data, selected, markerEnd }: EdgeProps<WorkEdge>) {
  const [path, labelX, labelY] = getBezierPath({ sourceX, sourceY, sourcePosition, targetX, targetY, targetPosition, curvature: 0.22 })
  const color = data?.color ?? '#61718b'
  return (
    <>
      <defs><marker id={`clarity-arrow-${id}`} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill={color} /></marker></defs>
      <BaseEdge id={id} path={path} markerEnd={markerEnd ?? `url(#clarity-arrow-${id})`} style={{ stroke: color, strokeWidth: selected ? 2.7 : 1.5, strokeDasharray: data?.dashed ? '6 5' : undefined, opacity: selected ? 1 : 0.78 }} />
      {data?.relation && (
        <EdgeLabelRenderer>
          <div className="edge-label" style={{ left: labelX, top: labelY, color }}>
            {data.relation}
          </div>
        </EdgeLabelRenderer>
      )}
    </>
  )
})
