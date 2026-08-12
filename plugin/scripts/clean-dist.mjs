import { rm } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const distDirectory = path.resolve(pluginDirectory, 'dist')

if (path.dirname(distDirectory) !== pluginDirectory || path.basename(distDirectory) !== 'dist') {
  throw new Error(`Refusing to clean unexpected path: ${distDirectory}`)
}

await rm(distDirectory, { recursive: true, force: true })
