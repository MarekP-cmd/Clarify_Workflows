// @vitest-environment node

import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveClarityDataPaths } from '../src/dataPaths.js'

describe('Clarity Core data-path resolution', () => {
  it('uses one stable Windows local-app-data location for desktop and MCP', () => {
    const localAppData = path.resolve('/tmp/clarity-local-app-data')
    const resolved = resolveClarityDataPaths({ LOCALAPPDATA: localAppData }, 'win32')
    expect(resolved.dataDirectory).toBe(path.join(localAppData, 'Clarity Workflows', 'data'))
    expect(resolved.databaseFile).toBe(path.join(resolved.dataDirectory, 'clarity.sqlite3'))
    expect(resolved.artifactDirectory).toBe(path.join(resolved.dataDirectory, 'artifacts'))
  })

  it('honors one explicit database path while keeping artifacts beside it', () => {
    const databaseFile = path.resolve('/tmp/operator-profile/clarity.sqlite3')
    const resolved = resolveClarityDataPaths({ CLARITY_DATABASE_FILE: databaseFile }, 'linux')
    expect(resolved.databaseFile).toBe(databaseFile)
    expect(resolved.dataDirectory).toBe(path.dirname(databaseFile))
    expect(resolved.artifactDirectory).toBe(path.join(path.dirname(databaseFile), 'artifacts'))
  })
})
