import { memo, useCallback, useEffect, useMemo, useRef } from 'react'
import { Background, Controls, MiniMap, ReactFlow, ReactFlowProvider, useNodesInitialized, useReactFlow, type Connection, type EdgeChange, type Node, type NodeChange, type OnSelectionChangeFunc, type OnNodeDrag } from '@xyflow/react'
import type { WorkEdge, WorkNode } from '../domain'
import { RelationEdge } from './RelationEdge'
import { WorkNodeCard } from './WorkNodeCard'
import { GraphNodeActionContext } from './GraphNodeActions'

const nodeTypes = { workNode: WorkNodeCard }
const edgeTypes = { relation: RelationEdge }
const fitViewOptions = { padding: 0.22 }
const defaultEdgeOptions = { type: 'relation' as const }

const miniMapNodeColor = (node: Node) => {
  const kind = (node.data as { kind?: string } | undefined)?.kind
  return kind === 'gate' ? '#e9bd65' : kind === 'hypothesis' ? '#ff9b7f' : '#49698d'
}

type Props = {
  nodes: WorkNode[]
  edges: WorkEdge[]
  onNodesChange: (changes: NodeChange<WorkNode>[]) => void
  onEdgesChange: (changes: EdgeChange<WorkEdge>[]) => void
  onConnect: (connection: Connection) => void
  onSelectionChange?: (selection: { nodeIds: string[]; edgeIds: string[] }) => void
  onTogglePin?: (nodeId: string) => void
  isNodeReadOnly?: (nodeId: string) => boolean
  onNodeDragStart?: OnNodeDrag<WorkNode>
  onNodeDragStop?: OnNodeDrag<WorkNode>
  onDropFiles?: (files: File[]) => void | Promise<void>
  readOnly?: boolean
  className?: string
}

function GraphCanvasInner({ nodes, edges, onNodesChange, onEdgesChange, onConnect, onSelectionChange, onNodeDragStart, onNodeDragStop, onDropFiles, readOnly = false, className }: Props) {
  const nodesInitialized = useNodesInitialized()
  const { fitView } = useReactFlow<WorkNode, WorkEdge>()
  const fittedInitialGraphRef = useRef(false)

  useEffect(() => {
    if (!nodesInitialized || fittedInitialGraphRef.current) return
    fittedInitialGraphRef.current = true
    const frame = window.requestAnimationFrame(() => { void fitView(fitViewOptions) })
    return () => window.cancelAnimationFrame(frame)
  }, [fitView, nodesInitialized])

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(({ nodes: selectedNodes, edges: selectedEdges }) => {
    onSelectionChange?.({ nodeIds: selectedNodes.map((node) => node.id), edgeIds: selectedEdges.map((edge) => edge.id) })
  }, [onSelectionChange])

  return (
    <div className={`graph-canvas ${className ?? ''}`} onDragOver={(event) => { if (!readOnly && event.dataTransfer.types.includes('Files')) event.preventDefault() }} onDrop={(event) => { if (readOnly || !event.dataTransfer.files.length) return; event.preventDefault(); void onDropFiles?.([...event.dataTransfer.files]) }}>
      <ReactFlow
        aria-label="Human work graph"
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        onConnect={onConnect}
        onSelectionChange={handleSelectionChange}
        onNodeDragStart={onNodeDragStart}
        onNodeDragStop={onNodeDragStop}
        fitView
        fitViewOptions={fitViewOptions}
        defaultEdgeOptions={defaultEdgeOptions}
        onlyRenderVisibleElements
        selectionOnDrag
        panOnScroll
        zoomOnScroll={false}
        minZoom={0.25}
        maxZoom={1.65}
        deleteKeyCode={null}
        nodesDraggable={!readOnly}
        nodesConnectable={!readOnly}
      >
        <Background color="#263142" gap={32} size={1} />
        <Controls showInteractive={false} />
        <MiniMap nodeColor={miniMapNodeColor} maskColor="rgba(7, 12, 20, .78)" />
      </ReactFlow>
    </div>
  )
}

export const GraphCanvas = memo(function GraphCanvas(props: Props) {
  const actions = useMemo(() => ({ onTogglePin: props.onTogglePin, isNodeReadOnly: props.isNodeReadOnly }), [props.isNodeReadOnly, props.onTogglePin])
  return <ReactFlowProvider><GraphNodeActionContext.Provider value={actions}><GraphCanvasInner {...props} /></GraphNodeActionContext.Provider></ReactFlowProvider>
})
