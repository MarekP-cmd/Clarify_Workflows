import { readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))

export function isConnectionId(value) {
  return typeof value === 'string' && /^plugin_asdk_app_[A-Za-z0-9_-]+$/.test(value)
}

export function extractConnectionId(value) {
  if (typeof value !== 'string') return null
  const matches = value.trim().match(/plugin_asdk_app_[A-Za-z0-9_-]+/g) ?? []
  const uniqueMatches = [...new Set(matches)]
  return uniqueMatches.length === 1 && isConnectionId(uniqueMatches[0]) ? uniqueMatches[0] : null
}

export async function configureApp(packageRoot, connectionId) {
  if (!isConnectionId(connectionId)) throw new Error('Invalid ChatGPT MCP connection ID.')

  const appMapping = {
    apps: {
      'clarity-workflows': {
        id: connectionId,
        required: true,
      },
    },
  }

  const manifestPath = path.join(packageRoot, '.codex-plugin', 'plugin.json')
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  manifest.apps = './.app.json'

  await writeFile(path.join(packageRoot, '.app.json'), `${JSON.stringify(appMapping, null, 2)}\n`, { mode: 0o600 })
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')

  return { appMapping, manifest }
}

const invokedPath = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : ''
if (invokedPath === import.meta.url) {
  const connectionId = extractConnectionId(process.argv[2])
  if (!isConnectionId(connectionId)) {
    console.error('Usage: npm run plugin:configure -- <plugin_asdk_app_ID or ChatGPT connection URL>')
    process.exitCode = 1
  } else {
    await configureApp(path.resolve(scriptDirectory, '../..'), connectionId)
    console.log('Clarity plugin package now references the registered ChatGPT MCP connection.')
  }
}
