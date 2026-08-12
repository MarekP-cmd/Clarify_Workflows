import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { chromium } from '@playwright/test'

const projectRoot = process.cwd()
const distRoot = path.join(projectRoot, 'dist')
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk3-stage1-browser-'))
const databasePath = path.join(temporaryDirectory, 'clarity.sqlite3')
const artifactDirectory = path.join(temporaryDirectory, 'artifacts')
const markdownPath = path.join(temporaryDirectory, 'operator-notes.md')
const pdfPath = path.join(temporaryDirectory, 'unreadable.pdf')
const markdownContents = '# Operator notes\n\nBytes selected by the operator.\n'
await writeFile(markdownPath, markdownContents, 'utf8')
await writeFile(pdfPath, Buffer.from('%PDF-operator-bytes%'))

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
])

function safeDistPath(urlPath) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '')
  const resolved = path.resolve(distRoot, relative)
  return resolved === distRoot || resolved.startsWith(`${distRoot}${path.sep}`) ? resolved : null
}

async function listen(server) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve) })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

async function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

async function launchBrowser() {
  let executablePath = process.env.CLARITY_CHROMIUM_EXECUTABLE
  let args = []
  if (!executablePath) {
    try {
      const module = await import('@sparticuz/chromium')
      executablePath = await module.default.executablePath()
      args = module.default.args
    } catch {
      executablePath = chromium.executablePath()
    }
  }
  return chromium.launch({ executablePath, args, headless: true })
}

const { CLARITY_DATABASE_SCHEMA_VERSION, WorkspaceStore } = await import('../plugin/dist/store.js')
let store
let browser
let context
let page
let server

try {
  await stat(path.join(distRoot, 'index.html'))
  store = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
  await store.initialize()
  assert.deepEqual(await store.list(), [])

  server = createServer(async (request, response) => {
    try {
      const filePath = safeDistPath(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
      if (!filePath || !(await stat(filePath)).isFile()) { response.writeHead(404).end('Not Found'); return }
      const headers = { 'content-type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream', 'cache-control': 'no-store' }
      if (path.extname(filePath) === '.html') headers['content-security-policy'] = "frame-ancestors 'none'"
      response.writeHead(200, headers)
      response.end(await readFile(filePath))
    } catch { response.writeHead(404).end('Not Found') }
  })
  const baseUrl = await listen(server)
  browser = await launchBrowser()
  context = await browser.newContext({ viewport: { width: 1680, height: 1020 } })
  let queuedChooserResults = [[{ sourcePath: markdownPath, originalName: 'operator-notes.md', mimeType: 'text/markdown', sizeBytes: Buffer.byteLength(markdownContents) }], [{ sourcePath: pdfPath, originalName: 'unreadable.pdf', mimeType: 'application/pdf', sizeBytes: 20 }]]

  await context.exposeBinding('__clarityInvoke', async (_source, channel, payload = {}) => {
    try {
      let value
      switch (channel) {
        case 'clarity:list-workspaces': value = await store.list(); break
        case 'clarity:create-workspace': value = await store.create(payload.name); break
        case 'clarity:get-workspace': value = await store.read(payload.workspaceId); break
        case 'clarity:save-human-workspace': value = await store.saveHumanWorkspace(payload.workspaceId, payload.input); break
        case 'clarity:choose-ingestion-files': value = queuedChooserResults.shift() ?? []; break
        case 'clarity:ingest-file-as-node': value = await store.ingestFileAsNode(payload.workspaceId, payload.sourcePath, { node: payload.node, originalName: payload.originalName, mimeType: payload.mimeType }); break
        case 'clarity:retry-artifact-extraction': value = await store.retryArtifactExtraction(payload.workspaceId, payload.artifactId); break
        case 'clarity:core-status': value = { ready: true, workspaceCount: (await store.list()).length, schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION, storageMode: 'sqlite' }; break
        default: throw Object.assign(new Error(`Unexpected bridge channel: ${channel}`), { code: 'UNKNOWN_BRIDGE_CHANNEL' })
      }
      return { ok: true, value }
    } catch (error) {
      return { ok: false, error: { code: typeof error?.code === 'string' ? error.code : 'CLARITY_CORE_ERROR', message: error instanceof Error ? error.message : 'Clarity Core request failed.' } }
    }
  })

  await context.addInitScript(() => {
    const invoke = async (channel, payload) => {
      const result = await window.__clarityInvoke(channel, payload)
      if (result?.ok) return result.value
      const error = new Error(result?.error?.message || 'Clarity Core request failed.')
      error.code = result?.error?.code || 'CLARITY_CORE_ERROR'
      throw error
    }
    window.clarityCore = Object.freeze({
      listWorkspaces: () => invoke('clarity:list-workspaces'),
      createWorkspace: (name) => invoke('clarity:create-workspace', { name }),
      getWorkspace: (workspaceId) => invoke('clarity:get-workspace', { workspaceId }),
      saveHumanWorkspace: (workspaceId, input) => invoke('clarity:save-human-workspace', { workspaceId, input }),
      deleteWorkspace: () => { throw new Error('not used') },
      importWorkspaceDocument: () => { throw new Error('not used') },
      replaceGraph: () => { throw new Error('not used') },
      importLegacyWorkspace: () => { throw new Error('not used') },
      status: () => invoke('clarity:core-status'),
    })
    window.clarityFiles = Object.freeze({
      chooseFiles: () => invoke('clarity:choose-ingestion-files'),
      getPathForFile: (file) => window.__clarityDropPaths?.[file.name] || '',
      ingestFileAsNode: (workspaceId, sourcePath, node, options) => invoke('clarity:ingest-file-as-node', { workspaceId, sourcePath, node, ...options }),
      retryArtifactExtraction: (workspaceId, artifactId) => invoke('clarity:retry-artifact-extraction', { workspaceId, artifactId }),
    })
  })
  page = await context.newPage()
  page.setDefaultTimeout(12_000)
  await page.goto(baseUrl, { waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  await page.getByLabel('Workspace name').fill('Chunk 3 Stage 1 browser workspace')
  await page.getByRole('button', { name: 'Create empty workspace' }).click()
  await page.getByRole('heading', { name: 'Chunk 3 Stage 1 browser workspace' }).waitFor()

  await page.getByRole('button', { name: 'Add files' }).click()
  await page.locator('.react-flow__node').filter({ hasText: 'operator-notes.md' }).waitFor()
  const first = (await store.list())[0]
  let workspace = await store.read(first.id)
  assert.equal(workspace.artifacts.length, 1)
  assert.equal(workspace.artifacts[0].extractionStatus, 'extracted')
  assert.equal(workspace.artifacts[0].extractedText, markdownContents)
  assert.equal(await readFile(store.resolveArtifactPath(workspace.artifacts[0]), 'utf8'), markdownContents)
  await page.locator('.react-flow__node').filter({ hasText: 'operator-notes.md' }).click({ force: true })
  await page.getByRole('heading', { name: 'operator-notes.md' }).waitFor()
  await page.getByText(/extracted characters/).waitFor()
  await page.getByText('Bytes selected by the operator.', { exact: false }).waitFor()

  await page.getByRole('button', { name: 'Add files' }).click()
  await page.locator('.react-flow__node').filter({ hasText: 'unreadable.pdf' }).waitFor()
  workspace = await store.read(first.id)
  assert.equal(workspace.artifacts.length, 2)
  const unsupported = workspace.artifacts.find((artifact) => artifact.originalName === 'unreadable.pdf')
  assert(unsupported)
  assert.equal(unsupported.extractionStatus, 'unsupported')
  assert.equal(unsupported.extractedText, undefined)
  assert.deepEqual(await readFile(store.resolveArtifactPath(unsupported)), Buffer.from('%PDF-operator-bytes%'))
  await page.locator('.react-flow__node').filter({ hasText: 'unreadable.pdf' }).click({ force: true })
  await page.getByText(/Bytes stored · extraction unsupported/).waitFor()

  // Exercise the actual graph drop wiring with a real File event and a path
  // resolved by the injected equivalent of Electron webUtils.getPathForFile.
  await page.evaluate((sourcePath) => { window.__clarityDropPaths = { 'dropped-notes.md': sourcePath } }, markdownPath)
  await page.evaluate(() => {
    const transfer = new DataTransfer()
    transfer.items.add(new File(['# dropped'], 'dropped-notes.md', { type: 'text/markdown' }))
    document.querySelector('.graph-canvas').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }))
  })
  for (let attempt = 0; attempt < 40; attempt += 1) {
    workspace = await store.read(first.id)
    if (workspace.artifacts.some((artifact) => artifact.originalName === 'dropped-notes.md')) break
    await delay(100)
  }
  assert.equal(workspace.artifacts.filter((artifact) => artifact.originalName === 'dropped-notes.md').length, 1)
  assert.equal(workspace.artifacts.filter((artifact) => artifact.originalName === 'dropped-notes.md')[0].extractionStatus, 'extracted')
  assert.equal(workspace.nodes.length, 3)

  console.log(JSON.stringify({ status: 'passed', boundary: 'production renderer against real SQLite Store with native-bridge chooser/drop paths', schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION, workspaceId: first.id, nodes: workspace.nodes.length, artifacts: workspace.artifacts.length, extracted: workspace.artifacts.filter((artifact) => artifact.extractionStatus === 'extracted').length, unsupported: workspace.artifacts.filter((artifact) => artifact.extractionStatus === 'unsupported').length }, null, 2))
} finally {
  await page?.close().catch(() => undefined)
  await context?.close().catch(() => undefined)
  await browser?.close().catch(() => undefined)
  await store?.close().catch(() => undefined)
  await new Promise((resolve) => server?.close(() => resolve()))
  await rm(temporaryDirectory, { recursive: true, force: true })
}
