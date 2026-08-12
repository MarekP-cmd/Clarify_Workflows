import { NODE_KINDS, NODE_ORIGINS, NODE_STATUSES } from '../plugin/src/types.ts'
import type { WorkNodeData } from './domain'

const PRIORITIES = ['low', 'medium', 'high'] as const
const AGENT_MODES = ['off', 'suggest', 'verify', 'execute'] as const
const NODE_DATA_KEYS = new Set([
  'projectId', 'origin', 'title', 'kind', 'description', 'schemaType', 'status', 'tags', 'provenance',
  'humanAnnotation', 'aiAnnotation', 'priority', 'evidenceCount', 'pinned', 'sourceUri',
  'instruction', 'agentMode', 'createdAt', 'updatedAt',
])

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function isString(value: unknown, minimum: number, maximum: number, nonWhitespace = false): value is string {
  return typeof value === 'string'
    && value.length >= minimum
    && value.length <= maximum
    && (!nonWhitespace || value.trim().length > 0)
}

function isOneOf(value: unknown, values: readonly string[]): value is string {
  return typeof value === 'string' && values.includes(value)
}

function isOptional<T>(value: unknown, predicate: (candidate: unknown) => candidate is T): value is T | undefined {
  return value === undefined || predicate(value)
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isEvidenceCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 10_000_000
}

function isTimestamp(value: unknown): value is string {
  return isString(value, 1, 100, true) && Number.isFinite(Date.parse(value))
}

/** CSP-safe, data-only validation for graph payloads entering the renderer. */
export function isValidNodeData(value: unknown): value is WorkNodeData {
  if (!isRecord(value) || !Object.keys(value).every((key) => NODE_DATA_KEYS.has(key))) return false

  return isOptional(value.projectId, (candidate): candidate is string => isString(candidate, 1, 160, true))
    && isOptional(value.origin, (candidate): candidate is WorkNodeData['origin'] => isOneOf(candidate, NODE_ORIGINS))
    && isString(value.title, 1, 500, true)
    && isOneOf(value.kind, NODE_KINDS)
    && isString(value.description, 0, 10_000)
    && isString(value.schemaType, 1, 200, true)
    && isOneOf(value.status, NODE_STATUSES)
    && Array.isArray(value.tags)
    && value.tags.length <= 100
    && value.tags.every((tag) => isString(tag, 0, 200))
    && isString(value.provenance, 1, 2_000, true)
    && isOptional(value.humanAnnotation, (candidate): candidate is string => isString(candidate, 0, 50_000))
    && isOptional(value.aiAnnotation, (candidate): candidate is string => isString(candidate, 0, 50_000))
    && isOptional(value.priority, (candidate): candidate is WorkNodeData['priority'] => isOneOf(candidate, PRIORITIES))
    && isOptional(value.evidenceCount, isEvidenceCount)
    && isOptional(value.pinned, isBoolean)
    && isOptional(value.sourceUri, (candidate): candidate is string => isString(candidate, 0, 4_000))
    && isOptional(value.instruction, (candidate): candidate is string => isString(candidate, 0, 50_000))
    && isOptional(value.agentMode, (candidate): candidate is WorkNodeData['agentMode'] => isOneOf(candidate, AGENT_MODES))
    && isOptional(value.createdAt, isTimestamp)
    && isOptional(value.updatedAt, isTimestamp)
}
