import type { WorkNode } from './domain'
import { kindMeta, type NodeKind } from './domain'
import { isWorkNode } from './graphValidation'

export const CLARITY_NODE_MIME = 'application/x-clarity-workflows-node+json'
const MAX_DROP_PAYLOAD_BYTES = 250_000

export function parseDroppedWorkNode(raw: string): WorkNode | null {
  if (!raw || raw.length > MAX_DROP_PAYLOAD_BYTES) return null
  try {
    const candidate = JSON.parse(raw) as unknown
    return isWorkNode(candidate) ? candidate : null
  } catch {
    return null
  }
}

function kindFromFilename(filename: string): NodeKind {
  const extension = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['csv', 'json', 'jsonl', 'parquet', 'xlsx', 'xls', 'tsv'].includes(extension)) return 'dataset'
  if (['py', 'ts', 'tsx', 'js', 'jsx', 'rs', 'swift', 'go', 'java', 'ipynb', 'sql'].includes(extension)) return 'code'
  if (['epub', 'mobi'].includes(extension)) return 'book'
  return 'paper'
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function workNodeFromFile(file: Pick<File, 'name' | 'size' | 'type'>, position: { x: number; y: number }, ordinal = 0): WorkNode {
  const kind = kindFromFilename(file.name)
  const extension = file.name.includes('.') ? file.name.split('.').pop()?.toUpperCase() : 'FILE'
  return {
    id: `file-${globalThis.crypto.randomUUID()}-${ordinal}`,
    type: 'workNode',
    position,
    data: {
      title: file.name,
      kind,
      description: `${formatFileSize(file.size)} local file selected for managed ingestion.`,
      schemaType: kindMeta[kind].schemaType,
      status: 'candidate',
      tags: [extension || 'FILE', file.type || 'Local file'],
      provenance: `Operator-selected local file awaiting managed ingestion: ${file.name}`,
      humanAnnotation: 'Review and annotate how this file should participate in the workflow.',
      origin: 'human',
    },
  }
}
