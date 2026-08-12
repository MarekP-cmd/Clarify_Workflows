import { INGESTION_FORMATS, type IngestionFormat } from './types.js'

export const MAX_EXTRACTABLE_SOURCE_BYTES = 16 * 1024 * 1024
export const MAX_EXTRACTED_CONTENT_CHARS = 2_000_000

export const SUPPORTED_INGESTION_FORMATS: ReadonlyArray<{
  format: IngestionFormat
  label: string
  extensions: readonly string[]
}> = [
  { format: 'text/plain', label: 'Plain text', extensions: ['.txt'] },
  { format: 'text/markdown', label: 'Markdown', extensions: ['.md', '.markdown'] },
  { format: 'text/csv', label: 'CSV / TSV data', extensions: ['.csv', '.tsv'] },
  { format: 'application/json', label: 'JSON data', extensions: ['.json'] },
  { format: 'application/x-ndjson', label: 'JSON Lines data', extensions: ['.jsonl', '.ndjson'] },
  { format: 'text/source-code', label: 'Source code', extensions: ['.c', '.cpp', '.css', '.go', '.h', '.java', '.js', '.jsx', '.jsonc', '.py', '.rs', '.sql', '.swift', '.ts', '.tsx', '.vue', '.xml'] },
]

const extensionToFormat = new Map<string, IngestionFormat>(
  SUPPORTED_INGESTION_FORMATS.flatMap(({ format, extensions }) => extensions.map((extension) => [extension, format] as const)),
)

const mimeToFormat = new Map<string, IngestionFormat>([
  ['text/plain', 'text/plain'],
  ['text/markdown', 'text/markdown'],
  ['text/csv', 'text/csv'],
  ['text/tab-separated-values', 'text/csv'],
  ['application/json', 'application/json'],
  ['application/x-ndjson', 'application/x-ndjson'],
  ['text/javascript', 'text/source-code'],
  ['application/javascript', 'text/source-code'],
  ['text/css', 'text/source-code'],
  ['application/xml', 'text/source-code'],
])

export function detectIngestionFormat(originalName: string, mimeType = ''): IngestionFormat | undefined {
  const normalizedMime = mimeType.split(';', 1)[0].trim().toLowerCase()
  const byMime = mimeToFormat.get(normalizedMime)
  if (byMime) return byMime
  const extension = `.${originalName.split('.').pop()?.toLowerCase() ?? ''}`
  return extensionToFormat.get(extension)
}

export type ExtractionResult =
  | { status: 'extracted'; format: IngestionFormat; text: string; characterCount: number; lineCount: number }
  | { status: 'unsupported'; error: string; format?: undefined }
  | { status: 'failed'; error: string; format: IngestionFormat }

function textFromBytes(bytes: Uint8Array) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new Error('The file is not valid UTF-8 text.')
  }
}

function validateStructuredText(text: string, format: IngestionFormat) {
  if (format === 'application/json') {
    try { JSON.parse(text) } catch { throw new Error('The JSON document could not be parsed.') }
  } else if (format === 'application/x-ndjson') {
    const invalidLine = text.split(/\r?\n/).findIndex((line) => line.trim() && (() => { try { JSON.parse(line); return false } catch { return true } })())
    if (invalidLine >= 0) throw new Error(`The JSON Lines document has invalid JSON on line ${invalidLine + 1}.`)
  }
}

export function extractIngestionContent(originalName: string, mimeType: string, bytes: Uint8Array): ExtractionResult {
  const format = detectIngestionFormat(originalName, mimeType)
  if (!format) return { status: 'unsupported', error: 'This format is stored as bytes but is not supported for extraction in Chunk 3 Stage 1.' }
  if (bytes.byteLength > MAX_EXTRACTABLE_SOURCE_BYTES) {
    return { status: 'failed', format, error: `Extraction is limited to ${MAX_EXTRACTABLE_SOURCE_BYTES} bytes in Stage 1; the original bytes remain stored.` }
  }
  try {
    const text = textFromBytes(bytes)
    if (text.length > MAX_EXTRACTED_CONTENT_CHARS) {
      return { status: 'failed', format, error: `Extracted content exceeds the ${MAX_EXTRACTED_CONTENT_CHARS}-character Stage 1 limit; the original bytes remain stored.` }
    }
    validateStructuredText(text, format)
    return { status: 'extracted', format, text, characterCount: text.length, lineCount: text.length ? text.split(/\r?\n/).length : 0 }
  } catch (error) {
    return { status: 'failed', format, error: error instanceof Error ? error.message : 'The file could not be decoded.' }
  }
}

/**
 * Classify a managed artifact without reading bytes that exceed the bounded
 * Stage 1 extraction budget. Unsupported formats stay explicitly unsupported;
 * supported formats over the budget are failed rather than being mistaken for
 * an empty, successfully extracted document.
 */
export function extractManagedIngestionContent(originalName: string, mimeType: string, sizeBytes: number, bytes: Uint8Array): ExtractionResult {
  if (sizeBytes > MAX_EXTRACTABLE_SOURCE_BYTES) {
    const format = detectIngestionFormat(originalName, mimeType)
    if (!format) return extractIngestionContent(originalName, mimeType, bytes)
    return { status: 'failed', format, error: `Extraction is limited to ${MAX_EXTRACTABLE_SOURCE_BYTES} bytes in Stage 1; the original bytes remain stored.` }
  }
  return extractIngestionContent(originalName, mimeType, bytes)
}

export function isSupportedIngestionFormat(format: string | undefined): format is IngestionFormat {
  return Boolean(format && (INGESTION_FORMATS as readonly string[]).includes(format))
}
