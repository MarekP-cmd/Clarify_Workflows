import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

describe('desktop security boundary', () => {
  it('keeps the renderer isolated and denies navigation, windows, and permissions', () => {
    const main = readFileSync(resolve(process.cwd(), 'electron/main.cjs'), 'utf8')
    expect(main).toContain('contextIsolation: true')
    expect(main).toContain('nodeIntegration: false')
    expect(main).toContain('sandbox: true')
    expect(main).toContain("setWindowOpenHandler(() => ({ action: 'deny' }))")
    expect(main).toContain('setPermissionRequestHandler')
    expect(main).toContain('if (targetUrl !== rendererUrl) event.preventDefault()')
  })

  it('ships a restrictive content security policy', () => {
    const html = readFileSync(resolve(process.cwd(), 'index.html'), 'utf8')
    expect(html).toContain("default-src 'self'")
    expect(html).toContain("script-src 'self'")
    expect(html).toContain("object-src 'none'")
    expect(html).not.toContain("'unsafe-eval'")
    expect(html).not.toContain("frame-ancestors 'none'")

    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(config).toContain("'Content-Security-Policy': \"frame-ancestors 'none'\"")
  })

  it('uses relative build assets so the file-based Electron renderer can load', () => {
    const config = readFileSync(resolve(process.cwd(), 'vite.config.ts'), 'utf8')
    expect(config).toContain("base: './'")
  })

  it('exposes only the allowlisted Clarity Core operations through preload IPC', () => {
    const preload = readFileSync(resolve(process.cwd(), 'electron/preload.cjs'), 'utf8')
    const expectedChannels = [
      'clarity:list-workspaces',
      'clarity:choose-ingestion-files',
      'clarity:create-workspace',
      'clarity:get-workspace',
      'clarity:save-human-workspace',
      'clarity:delete-workspace',
      'clarity:import-workspace-document',
      'clarity:replace-graph',
      'clarity:import-legacy-workspace',
      'clarity:ingest-file-as-node',
      'clarity:core-status',
      'clarity:retry-artifact-extraction',
    ]

    for (const channel of expectedChannels) expect(preload).toContain(channel)
    expect(preload).not.toContain('ipcRenderer.send')
    expect(preload.match(/ipcRenderer\.on\(/g)).toHaveLength(1)
    expect(preload).toContain("ipcRenderer.on('clarity:prepare-close'")
    expect(preload).toContain("ipcRenderer.removeListener('clarity:prepare-close'")
    expect(preload).toContain("invoke('clarity:close-ready')")
    expect(preload).not.toContain('require("fs")')
  })

  it('keeps the window open until the renderer acknowledges its final save', () => {
    const main = readFileSync(resolve(process.cwd(), 'electron/main.cjs'), 'utf8')
    expect(main).toContain("window.webContents.send('clarity:prepare-close')")
    expect(main).toContain("ipcMain.handle('clarity:close-ready'")
    expect(main).toContain('CLOSE_SAVE_TIMEOUT_MS = 10_000')
    expect(main).toContain('The window stayed open to protect unsaved workspace changes.')
  })

  it('does not use browser storage as a production persistence path', () => {
    const coreClient = readFileSync(resolve(process.cwd(), 'src/coreClient.ts'), 'utf8')
    expect(coreClient).not.toMatch(/(?:window\.)?localStorage\s*[.[]/)
    expect(coreClient).not.toMatch(/(?:window\.)?sessionStorage\s*[.[]/)
    expect(coreClient).toContain('if (window.clarityCore) return window.clarityCore')
  })
})
