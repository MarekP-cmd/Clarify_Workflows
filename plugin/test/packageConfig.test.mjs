// @vitest-environment node

import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { configureApp, extractConnectionId, isConnectionId } from '../scripts/configure-app.mjs'

const temporaryDirectories = []

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

describe('Clarity plugin package configuration', () => {
  it('validates and records a registered ChatGPT MCP connection id', async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-package-'))
    temporaryDirectories.push(directory)
    await mkdir(path.join(directory, '.codex-plugin'))
    await writeFile(
      path.join(directory, '.codex-plugin', 'plugin.json'),
      JSON.stringify({ name: 'clarity-workflows', version: '0.4.0', skills: './skills/' }),
    )

    const connectionId = 'plugin_asdk_app_0123456789abcdef'
    expect(isConnectionId(connectionId)).toBe(true)
    expect(isConnectionId('connector-not-allowed')).toBe(false)
    await configureApp(directory, connectionId)

    const mapping = JSON.parse(await readFile(path.join(directory, '.app.json'), 'utf8'))
    const manifest = JSON.parse(await readFile(path.join(directory, '.codex-plugin', 'plugin.json'), 'utf8'))
    expect(mapping.apps['clarity-workflows']).toEqual({ id: connectionId, required: true })
    expect(manifest.apps).toBe('./.app.json')
  })

  it('extracts one non-secret connection id from a ChatGPT plugin URL', () => {
    const connectionId = 'plugin_asdk_app_0123456789abcdef'
    expect(extractConnectionId(`https://chatgpt.com/plugins/${connectionId}`)).toBe(connectionId)
    expect(extractConnectionId(`connection=${connectionId}`)).toBe(connectionId)
    expect(extractConnectionId('https://chatgpt.com/plugins')).toBeNull()
    expect(extractConnectionId(`${connectionId} plugin_asdk_app_other`)).toBeNull()
  })
})
