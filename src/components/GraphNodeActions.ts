import { createContext } from 'react'

export const GraphNodeActionContext = createContext<{
  onTogglePin?: (nodeId: string) => void
  isNodeReadOnly?: (nodeId: string) => boolean
}>({})
