import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from '@playwright/test'

const projectRoot = process.cwd()
const scriptPath = fileURLToPath(import.meta.url)

function serializeError(error) {
  return {
    code: typeof error?.code === 'string' ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error),
  }
}

async function runMcpWorker() {
  const [databasePath, artifactDirectory] = process.argv.slice(3)
  assert(databasePath && artifactDirectory, 'MCP worker paths are required.')
  const { startClarityPluginServer } = await import('../plugin/dist/server.js')
  const server = await startClarityPluginServer({ databaseFile: databasePath, artifactDirectory, legacyJsonPaths: [], host: '127.0.0.1', port: 0 })
  process.send?.({ type: 'ready', pid: process.pid, mcpUrl: server.mcpUrl })
  process.on('message', async (message) => {
    if (message?.type !== 'close') return
    await server.close()
    process.send?.({ type: 'closed' }, () => process.disconnect())
  })
}

if (process.argv[2] === '--mcp-worker') {
  await runMcpWorker()
} else {
  const distRoot = path.join(projectRoot, 'dist')
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk3-stage2-browser-'))
  const databasePath = path.join(temporaryDirectory, 'clarity.sqlite3')
  const artifactDirectory = path.join(temporaryDirectory, 'artifacts')
  const markdownPath = path.join(temporaryDirectory, 'operator-notes.md')
  const pdfPath = path.join(temporaryDirectory, 'unreadable.pdf')
  const markdownContents = '# Stage 2 operator notes\n\nThis extracted body is available only through the bounded MCP content tool.\n'
  const pdfBytes = Buffer.from('%PDF bytes are stored but never extracted%')
  await writeFile(markdownPath, markdownContents, 'utf8')
  await writeFile(pdfPath, pdfBytes)

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
  async function delay(milliseconds) { return new Promise((resolve) => setTimeout(resolve, milliseconds)) }

  const { CLARITY_DATABASE_SCHEMA_VERSION, WorkspaceStore } = await import('../plugin/dist/store.js')
  let store
  let browser
  let context
  let page
  let staticServer
  const workers = []

  function spawnMcpWorker() {
    const child = fork(scriptPath, ['--mcp-worker', databasePath, artifactDirectory], {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let stderr = ''
    child.stderr?.on('data', (chunk) => { stderr += chunk })
    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject })
    const timeout = setTimeout(() => { rejectReady(new Error(`Timed out starting MCP worker.${stderr ? `\n${stderr}` : ''}`)); child.kill() }, 20_000)
    child.on('message', (message) => {
      if (message?.type === 'ready') { clearTimeout(timeout); resolveReady(message) }
    })
    child.once('error', (error) => { clearTimeout(timeout); rejectReady(error) })
    child.once('exit', (code, signal) => {
      if (code !== 0) rejectReady(new Error(`MCP worker exited before ready: ${code ?? signal}.${stderr ? `\n${stderr}` : ''}`))
    })
    const close = async () => {
      if (child.exitCode !== null) return
      await new Promise((resolve) => {
        const closeTimeout = setTimeout(() => { child.kill(); resolve() }, 10_000)
        child.once('exit', () => { clearTimeout(closeTimeout); resolve() })
        child.send({ type: 'close' })
      })
    }
    const worker = { child, ready, close }
    workers.push(worker)
    return worker
  }

  function structured(result) {
    return result?.structuredContent
  }
  function errorText(result) {
    return (result?.content ?? []).map((item) => item?.text ?? '').join('\n')
  }
  async function connectWorker(worker, name) {
    const ready = await worker.ready
    const client = new Client({ name, version: '0.5.0' })
    await client.connect(new StreamableHTTPClientTransport(new URL(ready.mcpUrl)))
    return client
  }

  try {
    await stat(path.join(distRoot, 'index.html'))
    store = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    await store.initialize()
    assert.deepEqual(await store.list(), [])

    staticServer = createServer(async (request, response) => {
      try {
        const filePath = safeDistPath(new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
        if (!filePath || !(await stat(filePath)).isFile()) { response.writeHead(404).end('Not Found'); return }
        response.writeHead(200, { 'content-type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream', 'cache-control': 'no-store' })
        response.end(await readFile(filePath))
      } catch { response.writeHead(404).end('Not Found') }
    })
    const baseUrl = await listen(staticServer)
    browser = await launchBrowser()
    context = await browser.newContext({ viewport: { width: 1680, height: 1020 } })
    const chooserResults = [
      [{ sourcePath: markdownPath, originalName: 'operator-notes.md', mimeType: 'text/markdown', sizeBytes: Buffer.byteLength(markdownContents) }],
      [{ sourcePath: pdfPath, originalName: 'unreadable.pdf', mimeType: 'application/pdf', sizeBytes: pdfBytes.length }],
    ]
    await context.exposeBinding('__clarityInvoke', async (_source, channel, payload = {}) => {
      try {
        let value
        switch (channel) {
          case 'clarity:list-workspaces': value = await store.list(); break
          case 'clarity:create-workspace': value = await store.create(payload.name); break
          case 'clarity:get-workspace': value = await store.read(payload.workspaceId); break
          case 'clarity:save-human-workspace': value = await store.saveHumanWorkspace(payload.workspaceId, payload.input); break
          case 'clarity:choose-ingestion-files': value = chooserResults.shift() ?? []; break
          case 'clarity:ingest-file-as-node': value = await store.ingestFileAsNode(payload.workspaceId, payload.sourcePath, { node: payload.node, originalName: payload.originalName, mimeType: payload.mimeType }); break
          case 'clarity:retry-artifact-extraction': value = await store.retryArtifactExtraction(payload.workspaceId, payload.artifactId); break
          case 'clarity:core-status': value = { ready: true, workspaceCount: (await store.list()).length, schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION, storageMode: 'sqlite' }; break
          default: throw Object.assign(new Error(`Unexpected bridge channel: ${channel}`), { code: 'UNKNOWN_BRIDGE_CHANNEL' })
        }
        return { ok: true, value }
      } catch (error) {
        return { ok: false, error: serializeError(error) }
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
        getPathForFile: () => '',
        ingestFileAsNode: (workspaceId, sourcePath, node, options) => invoke('clarity:ingest-file-as-node', { workspaceId, sourcePath, node, ...options }),
        retryArtifactExtraction: (workspaceId, artifactId) => invoke('clarity:retry-artifact-extraction', { workspaceId, artifactId }),
      })
    })
    page = await context.newPage()
    page.setDefaultTimeout(12_000)
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
    await page.getByLabel('Workspace name').fill('Chunk 3 Stage 2 browser workspace')
    await page.getByRole('button', { name: 'Create empty workspace' }).click()
    await page.getByRole('heading', { name: 'Chunk 3 Stage 2 browser workspace' }).waitFor()

    await page.getByRole('button', { name: 'Add files' }).click()
    await page.locator('.react-flow__node').filter({ hasText: 'operator-notes.md' }).waitFor()
    let workspace = await store.read((await store.list())[0].id)
    const extracted = workspace.artifacts.find((artifact) => artifact.originalName === 'operator-notes.md')
    assert(extracted)
    assert.equal(extracted.extractionStatus, 'extracted')
    assert.equal(extracted.extractedText, markdownContents)
    assert.deepEqual(await readFile(store.resolveArtifactPath(extracted), 'utf8'), markdownContents)
    await page.locator('.react-flow__node').filter({ hasText: 'operator-notes.md' }).click({ force: true })
    await page.getByText(/extracted characters/).waitFor()
    await page.getByText('This extracted body is available only through the bounded MCP content tool.', { exact: false }).waitFor()

    await page.getByRole('button', { name: 'Add files' }).click()
    await page.locator('.react-flow__node').filter({ hasText: 'unreadable.pdf' }).waitFor()
    workspace = await store.read(workspace.id)
    const unsupported = workspace.artifacts.find((artifact) => artifact.originalName === 'unreadable.pdf')
    assert(unsupported)
    assert.equal(unsupported.extractionStatus, 'unsupported')
    assert.equal(unsupported.extractedText, undefined)
    assert.deepEqual(await readFile(store.resolveArtifactPath(unsupported)), pdfBytes)
    await page.locator('.react-flow__node').filter({ hasText: 'unreadable.pdf' }).click({ force: true })
    await page.getByText(/Bytes stored · extraction unsupported/).waitFor()
    assert.equal(await page.locator('.artifact-preview').count(), 0, 'Unsupported bytes must not render as a readable desktop preview.')

    const workspaceId = workspace.id
    await page.close(); page = undefined
    await context.close(); context = undefined
    await browser.close(); browser = undefined
    await new Promise((resolve) => staticServer.close(resolve)); staticServer = undefined
    await store.close(); store = undefined

    const worker = spawnMcpWorker()
    const client = await connectWorker(worker, 'clarity-chunk3-stage2-browser-e2e')
    const viewResult = await client.callTool({ name: 'get_clarity_workspace', arguments: { workspace_id: workspaceId } })
    assert.equal(viewResult.isError, undefined)
    const publicWorkspace = structured(viewResult).workspace
    assert.equal(publicWorkspace.artifactCount, 2)
    assert.equal(publicWorkspace.artifactsTruncated, false)
    assert(publicWorkspace.artifacts.every((artifact) => !Object.hasOwn(artifact, 'extractedText')))
    assert(!JSON.stringify(publicWorkspace).includes(markdownContents))
    assert(!JSON.stringify(publicWorkspace).includes(pdfBytes.toString('utf8')))

    const pageOne = structured(await client.callTool({ name: 'list_workspace_artifacts', arguments: { workspace_id: workspaceId, page_size: 1 } }))
    assert.equal(pageOne.artifacts.length, 1)
    assert.equal(pageOne.totalCount, 2)
    assert.equal(pageOne.nextCursor, '1')
    const pageTwo = structured(await client.callTool({ name: 'list_workspace_artifacts', arguments: { workspace_id: workspaceId, cursor: pageOne.nextCursor, page_size: 1 } }))
    assert.equal(pageTwo.artifacts.length, 1)
    assert.equal(pageTwo.nextCursor, null)
    assert.deepEqual(new Set([...pageOne.artifacts, ...pageTwo.artifacts].map((artifact) => artifact.id)), new Set(workspace.artifacts.map((artifact) => artifact.id)))

    const bounded = structured(await client.callTool({ name: 'get_extracted_artifact_content', arguments: { workspace_id: workspaceId, artifact_id: extracted.id, max_characters: 32 } }))
    assert.equal(bounded.extractionStatus, 'extracted')
    assert.equal(bounded.content, Array.from(markdownContents).slice(0, 32).join(''))
    assert.equal(bounded.returnedCharacterCount, 32)
    assert.equal(bounded.returnedByteCount, Buffer.byteLength(bounded.content, 'utf8'))
    assert.equal(bounded.sourceSha256, createHash('sha256').update(markdownContents).digest('hex'))
    assert.equal(bounded.truncated, true)
    assert(JSON.stringify(bounded).length < 100_000)

    const unsupportedResult = await client.callTool({ name: 'get_extracted_artifact_content', arguments: { workspace_id: workspaceId, artifact_id: unsupported.id } })
    assert.equal(unsupportedResult.isError, true)
    assert(errorText(unsupportedResult).includes('ARTIFACT_CONTENT_UNAVAILABLE'))
    assert(!errorText(unsupportedResult).includes(pdfBytes.toString('utf8')))
    const inspected = structured(await client.callTool({ name: 'inspect_clarity_node', arguments: { workspace_id: workspaceId, node_id: unsupported.nodeId } }))
    assert.equal(inspected.artifacts[0].extractionStatus, 'unsupported')
    assert(!Object.hasOwn(inspected.artifacts[0], 'extractedText'))
    const widget = await client.readResource({ uri: 'ui://clarity-workflows/graph-v1.html' })
    const widgetText = widget.contents[0]?.text ?? ''
    assert(widgetText.includes('Bytes stored · extraction unsupported · content unavailable'))
    assert(widgetText.includes('Extracted content available through bounded MCP read'))
    await client.close()
    await worker.close()

    const restarted = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    store = restarted
    await restarted.initialize()
    const durable = await restarted.read(workspaceId)
    assert.equal(durable.artifacts.find((artifact) => artifact.id === extracted.id)?.extractedText, markdownContents)
    assert.equal(durable.artifacts.find((artifact) => artifact.id === unsupported.id)?.extractedText, undefined)
    assert.deepEqual(await readFile(restarted.resolveArtifactPath(unsupported)), pdfBytes)
    await restarted.retryArtifactExtraction(workspaceId, unsupported.id)
    await writeFile(restarted.resolveArtifactPath(extracted), 'tampered extracted bytes', 'utf8')
    await assert.rejects(() => restarted.retryArtifactExtraction(workspaceId, extracted.id), (error) => error?.code === 'ARTIFACT_INTEGRITY_MISMATCH')
    await restarted.close(); store = undefined

    const integrityWorker = spawnMcpWorker()
    const integrityClient = await connectWorker(integrityWorker, 'clarity-chunk3-stage2-integrity-e2e')
    const integrityResult = await integrityClient.callTool({ name: 'get_extracted_artifact_content', arguments: { workspace_id: workspaceId, artifact_id: extracted.id } })
    assert.equal(integrityResult.isError, true)
    assert(errorText(integrityResult).includes('ARTIFACT_INTEGRITY_MISMATCH'))
    assert(!errorText(integrityResult).includes(markdownContents))
    await integrityClient.close()
    await integrityWorker.close()

    console.log(JSON.stringify({
      status: 'passed',
      boundary: 'production renderer + separate MCP OS process + SQLite restart/retry/integrity verification',
      workspaceId,
      artifacts: 2,
      extracted: 1,
      unsupported: 1,
      boundedCharacters: bounded.returnedCharacterCount,
      unsupportedRead: 'denied',
      tamperedRead: 'denied',
    }, null, 2))
  } finally {
    for (const worker of workers.reverse()) await worker.close().catch(() => undefined)
    await page?.close().catch(() => undefined)
    await context?.close().catch(() => undefined)
    await browser?.close().catch(() => undefined)
    await store?.close().catch(() => undefined)
    if (staticServer) await new Promise((resolve) => staticServer.close(resolve))
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
