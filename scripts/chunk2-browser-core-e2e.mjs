import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { chromium } from '@playwright/test'

const projectRoot = process.cwd()
const distRoot = path.join(projectRoot, 'dist')
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk2-browser-core-'))
const databasePath = path.join(temporaryDirectory, 'clarity.sqlite3')
const artifactDirectory = path.join(temporaryDirectory, 'artifacts')
const portableExportPath = path.join(temporaryDirectory, 'human-graph.clarity.json')
const jsonLdExportPath = path.join(temporaryDirectory, 'human-graph.jsonld')
const conflictExportPath = path.join(temporaryDirectory, 'conflicted-local-draft.clarity.json')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
])

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function jsonValue(value) {
  return JSON.parse(JSON.stringify(value))
}

function safeDistPath(urlPath) {
  const relative = urlPath === '/' ? 'index.html' : decodeURIComponent(urlPath).replace(/^\/+/, '')
  const resolved = path.resolve(distRoot, relative)
  return resolved === distRoot || resolved.startsWith(`${distRoot}${path.sep}`) ? resolved : null
}

function staticServer() {
  return createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      const filePath = safeDistPath(requestUrl.pathname)
      if (!filePath || !(await stat(filePath)).isFile()) {
        response.writeHead(404).end('Not Found')
        return
      }
      const headers = {
        'content-type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
        'cache-control': 'no-store',
      }
      if (path.extname(filePath) === '.html') headers['content-security-policy'] = "frame-ancestors 'none'"
      response.writeHead(200, headers)
      response.end(await readFile(filePath))
    } catch {
      response.writeHead(404).end('Not Found')
    }
  })
}

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  assert(address && typeof address !== 'string')
  return `http://127.0.0.1:${address.port}`
}

async function closeServer(server) {
  if (!server.listening) return
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
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

async function waitForWorkspace(store, workspaceId, predicate, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue
  let lastError
  while (Date.now() < deadline) {
    try {
      lastValue = await store.read(workspaceId)
      if (predicate(lastValue)) return lastValue
    } catch (error) {
      lastError = error
    }
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${label}. Last Core value: ${JSON.stringify(lastValue)}; last error: ${lastError instanceof Error ? lastError.message : String(lastError ?? '')}`)
}

async function waitForWorkspaceList(store, predicate, label, timeoutMs = 12_000) {
  const deadline = Date.now() + timeoutMs
  let lastValue = []
  while (Date.now() < deadline) {
    lastValue = await store.list()
    if (predicate(lastValue)) return lastValue
    await delay(50)
  }
  throw new Error(`Timed out waiting for ${label}. Last workspace list: ${JSON.stringify(lastValue)}`)
}

async function waitForUiRevision(page, revision) {
  try {
    await page.waitForFunction((expectedRevision) => {
      const status = document.querySelector('.core-status')?.textContent ?? ''
      return status.includes('Saved to Clarity Core') && status.includes(`revision ${expectedRevision}`)
    }, revision, { timeout: 12_000 })
  } catch (error) {
    const actualStatus = await page.locator('.core-status').textContent().catch(() => '')
    throw new Error(`Timed out waiting for UI revision ${revision}. Visible Core status: ${JSON.stringify(actualStatus)}`, { cause: error })
  }
}

async function acceptConfirmation(page, locator) {
  const accepted = new Promise((resolve, reject) => {
    page.once('dialog', (dialog) => {
      dialog.accept().then(() => resolve(dialog.message()), reject)
    })
  })
  await locator.click()
  return accepted
}

function dialogField(dialog, label, control = 'input, textarea, select') {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return dialog.locator('label.field').filter({ hasText: new RegExp(`^${escaped}`) }).locator(control).first()
}

async function addWorkItem(page, values) {
  await page.getByRole('button', { name: 'Add item', exact: true }).click()
  const dialog = page.getByRole('dialog', { name: 'Add work item' })
  await dialogField(dialog, 'Title', 'input').fill(values.title)
  await dialogField(dialog, 'Item type', 'select').selectOption(values.kind)
  await dialogField(dialog, 'Side project', 'select').selectOption({ label: values.project ?? 'Workspace root' })
  await dialogField(dialog, 'Description', 'textarea').fill(values.description)
  await dialogField(dialog, 'Status', 'select').selectOption(values.status)
  await dialogField(dialog, 'Priority', 'select').selectOption(values.priority ?? '')
  await dialogField(dialog, 'Tags', 'input').fill(values.tags)
  await dialogField(dialog, 'Provenance', 'textarea').fill(values.provenance)
  if (values.sourceUri) await dialogField(dialog, 'Source URI', 'input').fill(values.sourceUri)
  await dialog.getByRole('button', { name: 'Add to graph' }).click()
}

async function chooseNode(page, title) {
  const node = page.locator('.react-flow__node').filter({ hasText: title }).first()
  try {
    await node.waitFor({ state: 'visible' })
  } catch (error) {
    throw new Error(`Could not choose graph node ${JSON.stringify(title)}. Rendered nodes: ${JSON.stringify(await page.locator('.react-flow__node').allInnerTexts())}; filters: ${JSON.stringify(await page.locator('.filterbar').innerText())}`, { cause: error })
  }
  await node.click({ force: true })
  await page.locator('aside[aria-label="Work item inspector"]').getByRole('heading', { name: title }).waitFor()
}

async function chooseRelationship(page, nodeTitle, relation) {
  await chooseNode(page, nodeTitle)
  await page.locator('aside[aria-label="Work item inspector"]').getByRole('button', { name: relation, exact: true }).click()
  await page.locator('aside[aria-label="Relationship inspector"]').waitFor()
}

function structured(result, toolName) {
  if (result.isError) {
    const text = result.content?.map((item) => item.type === 'text' ? item.text : '').join(' ') ?? ''
    throw new Error(`${toolName} failed: ${text}`)
  }
  assert(result.structuredContent, `${toolName} did not return structured content.`)
  return result.structuredContent
}

async function connectMcp(server, name) {
  const client = new Client({ name, version: '0.4.0' })
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
  return client
}

async function callMcp(client, name, argumentsValue) {
  return structured(await client.callTool({ name, arguments: argumentsValue }), name)
}

await stat(path.join(distRoot, 'index.html')).catch(() => {
  throw new Error('Chunk 2 browser acceptance requires a fresh production build. Run npm run build first.')
})

const {
  CLARITY_DATABASE_SCHEMA_VERSION,
  WorkspaceStore,
} = await import('../plugin/dist/store.js')
const { startClarityPluginServer } = await import('../plugin/dist/server.js')

let desktopStore = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
let restartedStore
let browser
let browserContext
let page
let webServer
let mcpServer
let mcpClient
let restartedMcpServer
let restartedMcpClient
let saveDelayMs = 0
const consoleErrors = []
const pageErrors = []
const result = {
  browser: '',
  databaseSchemaVersion: CLARITY_DATABASE_SCHEMA_VERSION,
  sourceWorkspaceId: '',
  importedWorkspaceId: '',
  finalRevision: 0,
  finalNodes: 0,
  finalEdges: 0,
  finalAnnotations: 0,
  finalActivities: 0,
}

try {
  await desktopStore.initialize()
  assert.deepEqual(await desktopStore.list(), [], 'A clean production Core must not contain seeded workspaces.')

  mcpServer = await startClarityPluginServer({
    databaseFile: databasePath,
    artifactDirectory,
    legacyJsonPaths: [],
    host: '127.0.0.1',
    port: 0,
  })
  mcpClient = await connectMcp(mcpServer, 'clarity-chunk2-browser-live')

  webServer = staticServer()
  const baseUrl = await listen(webServer)
  browser = await launchBrowser()
  result.browser = await browser.version()
  browserContext = await browser.newContext({ viewport: { width: 1680, height: 1020 }, acceptDownloads: true })

  await browserContext.exposeBinding('__clarityInvoke', async (_source, channel, payload = {}) => {
    try {
      let value
      switch (channel) {
        case 'clarity:list-workspaces': value = await desktopStore.list(); break
        case 'clarity:create-workspace': value = await desktopStore.create(payload.name); break
        case 'clarity:get-workspace': value = await desktopStore.read(payload.workspaceId); break
        case 'clarity:save-human-workspace': {
          if (saveDelayMs > 0) {
            const currentDelay = saveDelayMs
            saveDelayMs = 0
            await delay(currentDelay)
          }
          value = await desktopStore.saveHumanWorkspace(payload.workspaceId, payload.input)
          break
        }
        case 'clarity:delete-workspace': value = await desktopStore.deleteWorkspace(payload.workspaceId, payload.expectedRevision); break
        case 'clarity:import-workspace-document': value = await desktopStore.importWorkspaceDocument(payload.document); break
        case 'clarity:replace-graph': value = await desktopStore.replaceGraph(payload.workspaceId, payload.nodes, payload.edges); break
        case 'clarity:import-legacy-workspace': value = await desktopStore.importLegacyWorkspace(payload.workspace, false); break
        case 'clarity:core-status': value = {
          ready: true,
          workspaceCount: (await desktopStore.list()).length,
          schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION,
          storageMode: 'sqlite',
        }; break
        default: throw Object.assign(new Error(`Unexpected Clarity bridge channel: ${channel}`), { code: 'UNKNOWN_BRIDGE_CHANNEL' })
      }
      return { ok: true, value }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: typeof error?.code === 'string' ? error.code : 'CLARITY_CORE_ERROR',
          message: error instanceof Error ? error.message : 'Clarity Core request failed.',
        },
      }
    }
  })

  await browserContext.addInitScript(() => {
    const invoke = async (channel, payload) => {
      const resultValue = await window.__clarityInvoke(channel, payload)
      if (resultValue?.ok) return resultValue.value
      const error = new Error(resultValue?.error?.message || 'Clarity Core request failed.')
      error.code = resultValue?.error?.code || 'CLARITY_CORE_ERROR'
      throw error
    }
    window.clarityCore = Object.freeze({
      listWorkspaces: () => invoke('clarity:list-workspaces'),
      createWorkspace: (name) => invoke('clarity:create-workspace', { name }),
      getWorkspace: (workspaceId) => invoke('clarity:get-workspace', { workspaceId }),
      saveHumanWorkspace: (workspaceId, input) => invoke('clarity:save-human-workspace', { workspaceId, input }),
      deleteWorkspace: (workspaceId, expectedRevision) => invoke('clarity:delete-workspace', { workspaceId, expectedRevision }),
      importWorkspaceDocument: (document) => invoke('clarity:import-workspace-document', { document }),
      replaceGraph: (workspaceId, nodes, edges) => invoke('clarity:replace-graph', { workspaceId, nodes, edges }),
      importLegacyWorkspace: (workspace) => invoke('clarity:import-legacy-workspace', { workspace }),
      status: () => invoke('clarity:core-status'),
    })
    const prepareCloseCallbacks = new Set()
    window.__clarityTestCloseAcknowledged = false
    window.__clarityTestTriggerPrepareClose = async () => {
      await Promise.all([...prepareCloseCallbacks].map((callback) => callback()))
    }
    window.clarityLifecycle = Object.freeze({
      onPrepareClose: (callback) => {
        prepareCloseCallbacks.add(callback)
        return () => prepareCloseCallbacks.delete(callback)
      },
      confirmCloseReady: async () => {
        window.__clarityTestCloseAcknowledged = true
        return true
      },
    })
  })

  page = await browserContext.newPage()
  page.setDefaultTimeout(12_000)
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()) })
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await page.goto(baseUrl, { waitUntil: 'networkidle' })

  await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  assert.deepEqual(await desktopStore.list(), [], 'Opening the real desktop UI must not create sample data.')
  await page.getByLabel('Workspace name').fill('Chunk 2 Browser Source')
  await page.getByRole('button', { name: 'Create empty workspace' }).click()
  const [sourceSummary] = await waitForWorkspaceList(desktopStore, (items) => items.length === 1, 'the UI-created workspace')
  const sourceWorkspaceId = sourceSummary.id
  result.sourceWorkspaceId = sourceWorkspaceId
  await page.getByRole('heading', { name: 'Chunk 2 Browser Source' }).waitFor()
  await waitForUiRevision(page, 0)

  // Side-project create.
  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  let dialog = page.getByRole('dialog', { name: 'Create side project' })
  await dialogField(dialog, 'Name', 'input').fill('Human Research Project')
  await dialogField(dialog, 'Description', 'textarea').fill('A human-created side project exercised through visible controls.')
  await dialog.getByRole('button', { name: 'Create project' }).click()
  let state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.projects.some((project) => project.name === 'Human Research Project'), 'side-project creation')
  await waitForUiRevision(page, state.revision)

  // Complete work-item create/edit/duplicate/delete, with persisted undo/redo.
  await addWorkItem(page, {
    title: 'Primary Evidence Paper',
    kind: 'paper',
    project: 'Human Research Project',
    description: 'Operator-entered evidence metadata for the browser acceptance test.',
    status: 'verified',
    priority: 'high',
    tags: 'evidence, browser-e2e',
    provenance: 'Entered by the human operator through the Chunk 2 desktop form',
    sourceUri: 'urn:clarity:chunk2:primary-evidence',
  })
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.some((node) => node.title === 'Primary Evidence Paper'), 'the first work item')
  await waitForUiRevision(page, state.revision)

  await addWorkItem(page, {
    title: 'Counter Question',
    kind: 'question',
    description: 'A second human-authored item used for relationship and history checks.',
    status: 'candidate',
    priority: '',
    tags: 'question, browser-e2e',
    provenance: 'Entered by the human operator through the Chunk 2 desktop form',
  })
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.some((node) => node.title === 'Counter Question'), 'the second work item')
  await waitForUiRevision(page, state.revision)

  await page.locator('.project-section .nav-item').filter({ hasText: 'All projects' }).click()
  await chooseNode(page, 'Counter Question')
  let inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('button', { name: 'Edit item' }).click()
  dialog = page.getByRole('dialog', { name: 'Edit work item' })
  await dialogField(dialog, 'Title', 'input').fill('Counter Question Revised')
  await dialogField(dialog, 'Description', 'textarea').fill('Revised through the visible work-item editor.')
  await dialogField(dialog, 'Status', 'select').selectOption('needs-evidence')
  await dialogField(dialog, 'Priority', 'select').selectOption('medium')
  await dialog.getByRole('button', { name: 'Save changes' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.some((node) => node.title === 'Counter Question Revised' && node.status === 'needs-evidence'), 'work-item editing')
  await waitForUiRevision(page, state.revision)

  await chooseNode(page, 'Counter Question Revised')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('button', { name: 'Duplicate' }).click()
  dialog = page.getByRole('dialog', { name: 'Duplicate work item' })
  await dialogField(dialog, 'Title', 'input').fill('Temporary Duplicate')
  await dialog.getByRole('button', { name: 'Add to graph' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.some((node) => node.title === 'Temporary Duplicate'), 'work-item duplication')
  await waitForUiRevision(page, state.revision)

  await page.locator('.react-flow__controls-fitview').click()
  await chooseNode(page, 'Temporary Duplicate')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await acceptConfirmation(page, inspector.getByRole('button', { name: 'Delete item' }))
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.length === 2 && !value.nodes.some((node) => node.title === 'Temporary Duplicate'), 'work-item deletion')
  await waitForUiRevision(page, state.revision)
  await page.getByRole('button', { name: 'Undo' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.some((node) => node.title === 'Temporary Duplicate'), 'Undo restoring the deleted item')
  await waitForUiRevision(page, state.revision)
  await page.getByRole('button', { name: 'Redo' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.length === 2 && !value.nodes.some((node) => node.title === 'Temporary Duplicate'), 'Redo deleting the item again')
  await waitForUiRevision(page, state.revision)

  const paperId = state.nodes.find((node) => node.title === 'Primary Evidence Paper')?.id
  const questionId = state.nodes.find((node) => node.title === 'Counter Question Revised')?.id
  assert(paperId && questionId)
  assert(state.nodes.every((node) => node.origin === 'human'), 'Items created through the human UI must retain human origin.')

  // Canvas drag plus pin/unpin are human graph mutations, not ephemeral UI.
  const positionBeforeDrag = state.nodes.find((node) => node.id === paperId).position
  await page.locator('.react-flow__controls-fitview').click()
  await delay(500)
  const paperGraphNode = page.locator(`.react-flow__node[data-id="${paperId}"]`)
  assert.match(await paperGraphNode.getAttribute('class'), /draggable/, 'An active-project node must be draggable.')
  const paperBox = await paperGraphNode.boundingBox()
  assert(paperBox, 'The paper node must be visible before the drag acceptance action.')
  const dragStartX = paperBox.x + Math.min(42, paperBox.width / 3)
  const dragStartY = paperBox.y + Math.min(78, paperBox.height * 0.6)
  await page.mouse.move(dragStartX, dragStartY)
  await page.mouse.down()
  await page.mouse.move(dragStartX + 96, dragStartY + 64, { steps: 16 })
  await page.mouse.up()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => {
    const position = value.nodes.find((node) => node.id === paperId)?.position
    return Boolean(position && (Math.abs(position.x - positionBeforeDrag.x) > 10 || Math.abs(position.y - positionBeforeDrag.y) > 10))
  }, 'dragged node position persistence')
  await waitForUiRevision(page, state.revision)

  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('button', { name: 'Pin item' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.find((node) => node.id === paperId)?.pinned === true, 'pinning the work item')
  await waitForUiRevision(page, state.revision)
  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('button', { name: 'Unpin item' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.find((node) => node.id === paperId)?.pinned === false, 'unpinning the work item')
  await waitForUiRevision(page, state.revision)
  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('button', { name: 'Pin item' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.find((node) => node.id === paperId)?.pinned === true, 'repinning the work item for restart verification')
  await waitForUiRevision(page, state.revision)

  // Activity is rendered newest-first and includes the durable field change.
  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('tab', { name: 'Activity' }).click()
  const expectedNodeActivities = state.activities
    .filter((activity) => activity.entityId === paperId)
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const nodeActivityRows = await inspector.locator('.activity-row').allInnerTexts()
  assert.equal(nodeActivityRows.length, expectedNodeActivities.length)
  expectedNodeActivities.forEach((activity, index) => assert(nodeActivityRows[index].includes(activity.summary)))
  assert(nodeActivityRows[0].includes('pinned'), 'The latest node activity must identify the pin mutation.')

  await page.getByRole('button', { name: 'Activity', exact: true }).click()
  const workspaceActivity = page.locator('aside[aria-label="Workspace activity"]')
  const expectedWorkspaceActivities = [...state.activities]
    .sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt))
  const workspaceActivityRows = await workspaceActivity.locator('.activity-row').allInnerTexts()
  assert.equal(workspaceActivityRows.length, Math.min(expectedWorkspaceActivities.length, 100))
  expectedWorkspaceActivities.slice(0, 100).forEach((activity, index) => assert(workspaceActivityRows[index].includes(activity.summary)))

  // Relationship create/edit/reverse/delete, then restore with Undo.
  await page.getByRole('button', { name: 'Add relationship', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Add relationship' })
  await dialogField(dialog, 'Source item', 'select').selectOption({ label: 'Primary Evidence Paper' })
  await dialogField(dialog, 'Target item', 'select').selectOption({ label: 'Counter Question Revised' })
  await dialogField(dialog, 'Relationship meaning', 'input').fill('challenges')
  await dialog.getByRole('button', { name: 'Add relationship' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.edges.some((edge) => edge.relation === 'challenges'), 'relationship creation')
  await waitForUiRevision(page, state.revision)

  await chooseRelationship(page, 'Primary Evidence Paper', 'challenges')
  let relationshipInspector = page.locator('aside[aria-label="Relationship inspector"]')
  await relationshipInspector.getByRole('button', { name: 'Edit relationship' }).click()
  dialog = page.getByRole('dialog', { name: 'Edit relationship' })
  await dialogField(dialog, 'Relationship meaning', 'input').fill('qualifies')
  await dialog.getByRole('button', { name: 'Save relationship' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.edges.some((edge) => edge.relation === 'qualifies'), 'relationship editing')
  await waitForUiRevision(page, state.revision)
  await chooseRelationship(page, 'Primary Evidence Paper', 'qualifies')
  relationshipInspector = page.locator('aside[aria-label="Relationship inspector"]')
  await relationshipInspector.getByRole('button', { name: 'Reverse direction' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.edges.some((edge) => edge.source === questionId && edge.target === paperId), 'relationship reversal')
  await waitForUiRevision(page, state.revision)
  await chooseRelationship(page, 'Primary Evidence Paper', 'qualifies')
  relationshipInspector = page.locator('aside[aria-label="Relationship inspector"]')
  await acceptConfirmation(page, relationshipInspector.getByRole('button', { name: 'Delete relationship' }))
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.edges.length === 0, 'relationship deletion')
  await waitForUiRevision(page, state.revision)
  await page.getByRole('button', { name: 'Undo' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.edges.length === 1 && value.edges[0].relation === 'qualifies', 'Undo restoring the relationship')
  await waitForUiRevision(page, state.revision)

  // First-class annotation create/edit/delete, then restore with Undo.
  await page.locator('.project-section .nav-item').filter({ hasText: 'All projects' }).click()
  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('tab', { name: 'Notes' }).click()
  await inspector.getByPlaceholder('Capture what you want the AI to remember…').fill('Durable browser annotation')
  await inspector.getByRole('button', { name: 'Add note' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.annotations.some((annotation) => annotation.body === 'Durable browser annotation'), 'annotation creation')
  await waitForUiRevision(page, state.revision)

  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('tab', { name: 'Notes' }).click()
  let annotationCard = inspector.locator('.annotation-card').filter({ hasText: 'Durable browser annotation' })
  await annotationCard.getByRole('button', { name: 'Edit' }).click()
  await annotationCard.getByLabel('Edit annotation').fill('Durable browser annotation revised')
  await annotationCard.getByRole('button', { name: 'Save note' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.annotations.some((annotation) => annotation.body === 'Durable browser annotation revised'), 'annotation editing')
  await waitForUiRevision(page, state.revision)
  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await inspector.getByRole('tab', { name: 'Notes' }).click()
  annotationCard = inspector.locator('.annotation-card').filter({ hasText: 'Durable browser annotation revised' })
  await acceptConfirmation(page, annotationCard.getByRole('button', { name: 'Delete' }))
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.annotations.length === 0, 'annotation deletion')
  await waitForUiRevision(page, state.revision)
  await page.getByRole('button', { name: 'Undo' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.annotations.some((annotation) => annotation.body === 'Durable browser annotation revised'), 'Undo restoring the annotation')
  await waitForUiRevision(page, state.revision)

  // Project edit/archive/restore and a second project's permanent deletion.
  await page.locator('.project-section .nav-item').filter({ hasText: 'Human Research Project' }).click()
  let projectActions = page.locator('.project-actions')
  await projectActions.getByRole('button', { name: 'Rename' }).click()
  dialog = page.getByRole('dialog', { name: 'Edit side project' })
  await dialogField(dialog, 'Name', 'input').fill('Human Research Project Revised')
  await dialogField(dialog, 'Description', 'textarea').fill('Renamed through the side-project editor and retained for export.')
  await dialog.getByRole('button', { name: 'Save project' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.projects.some((project) => project.name === 'Human Research Project Revised'), 'side-project editing')
  await waitForUiRevision(page, state.revision)
  await projectActions.getByRole('button', { name: 'Archive' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.projects.some((project) => project.name === 'Human Research Project Revised' && project.status === 'archived'), 'side-project archive')
  await waitForUiRevision(page, state.revision)
  await page.getByRole('button', { name: 'Show archived projects' }).click()
  await page.locator('.project-section .nav-item').filter({ hasText: 'Human Research Project Revised' }).click()

  const archivedRevision = state.revision
  const archivedPaperPosition = state.nodes.find((node) => node.id === paperId).position
  await chooseNode(page, 'Primary Evidence Paper')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  assert.equal(await inspector.getByRole('button', { name: /^(?:Pin|Unpin) item$/ }).isDisabled(), true)
  assert.equal(await inspector.getByRole('button', { name: 'Edit item' }).count(), 0)
  await page.keyboard.press('Delete')
  await page.getByRole('alert').getByText('Restore the archived side project before deleting', { exact: false }).waitFor()
  await delay(500)
  const afterBlockedDelete = await desktopStore.read(sourceWorkspaceId)
  assert.equal(afterBlockedDelete.revision, archivedRevision)
  assert(afterBlockedDelete.nodes.some((node) => node.id === paperId))
  assert.deepEqual(afterBlockedDelete.nodes.find((node) => node.id === paperId).position, archivedPaperPosition)
  await page.getByRole('button', { name: 'Dismiss' }).click()

  projectActions = page.locator('.project-actions')
  await projectActions.getByRole('button', { name: 'Restore' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.projects.some((project) => project.name === 'Human Research Project Revised' && project.status === 'active'), 'side-project restore')
  await waitForUiRevision(page, state.revision)

  await page.getByRole('button', { name: 'Add project', exact: true }).click()
  dialog = page.getByRole('dialog', { name: 'Create side project' })
  await dialogField(dialog, 'Name', 'input').fill('Temporary Project')
  await dialogField(dialog, 'Description', 'textarea').fill('Created only to verify the visible project deletion boundary.')
  await dialog.getByRole('button', { name: 'Create project' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.projects.some((project) => project.name === 'Temporary Project'), 'temporary side-project creation')
  await waitForUiRevision(page, state.revision)

  await addWorkItem(page, {
    title: 'Temporary Project Item',
    kind: 'code',
    project: 'Temporary Project',
    description: 'This owned node must move to the workspace root when its project is deleted.',
    status: 'candidate',
    priority: 'low',
    tags: 'project-delete-boundary',
    provenance: 'Entered through the visible Chunk 2 project-deletion acceptance flow',
  })
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.nodes.some((node) => node.title === 'Temporary Project Item' && node.projectId), 'a node owned by the temporary side project')
  await waitForUiRevision(page, state.revision)
  const temporaryProjectItemId = state.nodes.find((node) => node.title === 'Temporary Project Item').id
  await acceptConfirmation(page, page.locator('.project-actions').getByRole('button', { name: 'Delete' }))
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => !value.projects.some((project) => project.name === 'Temporary Project') && value.nodes.find((node) => node.id === temporaryProjectItemId)?.projectId === undefined, 'side-project deletion moving its node to the workspace root')
  await waitForUiRevision(page, state.revision)
  await page.locator('.project-section .nav-item').filter({ hasText: 'Workspace root' }).click()
  await page.locator('.react-flow__controls-fitview').click()
  await chooseNode(page, 'Temporary Project Item')
  inspector = page.locator('aside[aria-label="Work item inspector"]')
  await acceptConfirmation(page, inspector.getByRole('button', { name: 'Delete item' }))
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => !value.nodes.some((node) => node.id === temporaryProjectItemId), 'cleanup deletion of the root-moved project item')
  await waitForUiRevision(page, state.revision)

  // Search and all three semantic filters operate on the visible graph.
  await page.locator('.project-section .nav-item').filter({ hasText: 'All projects' }).click()
  const searchInput = page.getByLabel(/Search graph/)
  await searchInput.fill('Durable browser annotation revised')
  await page.locator('.filter-count').getByText('1 visible', { exact: true }).waitFor()
  await page.getByLabel('Filter by kind').selectOption('paper')
  await page.getByLabel('Filter by status').selectOption('verified')
  await page.getByLabel('Filter by priority').selectOption('high')
  await page.locator('.filter-count').getByText('1 visible', { exact: true }).waitFor()
  await page.getByLabel('Filter by status').selectOption('blocked')
  await page.locator('.filter-count').getByText('0 visible', { exact: true }).waitFor()
  await page.locator('.filterbar').getByRole('button', { name: 'Clear filters' }).click()
  await page.locator('.filter-count').getByText('2 visible', { exact: true }).waitFor()

  // Workspace rename plus archive/restore.
  await page.getByRole('button', { name: 'Rename workspace' }).click()
  dialog = page.getByRole('dialog', { name: 'Rename workspace' })
  await dialogField(dialog, 'Workspace name', 'input').fill('Chunk 2 Human Graph Final')
  await dialog.getByRole('button', { name: 'Save name' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.name === 'Chunk 2 Human Graph Final', 'workspace rename')
  await waitForUiRevision(page, state.revision)
  await page.getByRole('button', { name: 'Archive workspace' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.status === 'archived', 'workspace archive')
  await waitForUiRevision(page, state.revision)
  await page.getByText('Archived · read-only', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'Restore workspace' }).click()
  state = await waitForWorkspace(desktopStore, sourceWorkspaceId, (value) => value.status === 'active', 'workspace restore')
  await waitForUiRevision(page, state.revision)

  // Portable and JSON-LD exports are generated only by the visible UI.
  let downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  let download = await downloadPromise
  await download.saveAs(portableExportPath)
  const portableDocument = JSON.parse(await readFile(portableExportPath, 'utf8'))
  assert.deepEqual({ format: portableDocument.format, version: portableDocument.version, name: portableDocument.name }, {
    format: 'clarity-workspace',
    version: 1,
    name: 'Chunk 2 Human Graph Final',
  })
  assert.equal(portableDocument.projects.length, 1)
  assert.equal(portableDocument.nodes.length, 2)
  assert.equal(portableDocument.edges.length, 1)
  assert.equal(portableDocument.annotations.length, 1)
  for (const runtimeField of ['artifacts', 'workflowDefinitions', 'runs', 'gates', 'approvals', 'activities']) {
    assert.equal(Object.hasOwn(portableDocument, runtimeField), false, `Portable export leaked runtime field ${runtimeField}.`)
  }

  downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'JSON-LD', exact: true }).click()
  download = await downloadPromise
  await download.saveAs(jsonLdExportPath)
  const jsonLdDocument = JSON.parse(await readFile(jsonLdExportPath, 'utf8'))
  assert(jsonLdDocument['@context'], 'The UI JSON-LD export must declare its context.')
  assert.equal(jsonLdDocument['schema:name'], 'Chunk 2 Human Graph Final')

  const sourceComplete = await desktopStore.read(sourceWorkspaceId)
  for (const entityType of ['project', 'node', 'edge', 'annotation']) {
    assert(sourceComplete.activities.some((activity) => activity.entityType === entityType), `Source activity omitted ${entityType} changes.`)
  }
  assert(sourceComplete.activities.some((activity) => activity.action === 'deleted'), 'Human deletions must be present in durable activity history.')

  // Import through the real file chooser creates a distinct portable workspace.
  const chooserPromise = page.waitForEvent('filechooser')
  await page.getByRole('button', { name: 'Import', exact: true }).click()
  const chooser = await chooserPromise
  await chooser.setFiles(portableExportPath)
  const summariesAfterImport = await waitForWorkspaceList(desktopStore, (items) => items.length === 2, 'portable workspace import')
  const importedSummary = summariesAfterImport.find((summary) => summary.id !== sourceWorkspaceId)
  assert(importedSummary)
  const importedWorkspaceId = importedSummary.id
  result.importedWorkspaceId = importedWorkspaceId
  state = await waitForWorkspace(desktopStore, importedWorkspaceId, (value) => value.nodes.length === 2 && value.annotations.length === 1, 'the imported human graph')
  assert(state.nodes.every((node) => node.origin === 'imported-unverified'))
  assert.deepEqual({
    author: state.annotations[0].author,
    origin: state.annotations[0].origin,
    declaredAuthor: state.annotations[0].declaredAuthor,
  }, { author: 'human', origin: 'imported-unverified', declaredAuthor: 'human' })
  assert.deepEqual({ artifacts: state.artifacts, workflowDefinitions: state.workflowDefinitions, runs: state.runs, gates: state.gates, approvals: state.approvals }, {
    artifacts: [], workflowDefinitions: [], runs: [], gates: [], approvals: [],
  })
  await page.getByRole('heading', { name: 'Chunk 2 Human Graph Final' }).waitFor()
  await waitForUiRevision(page, state.revision)

  // A live MCP approval advances the same SQLite workspace while the desktop
  // holds an older revision. The visible UI must surface, preserve, export,
  // and explicitly reconcile that conflict rather than overwrite ChatGPT.
  const importedFromMcp = (await callMcp(mcpClient, 'get_clarity_workspace', { workspace_id: importedWorkspaceId })).workspace
  // The Stage 2 public projection adds bounded artifact count/truncation
  // metadata. Compare the authoritative graph state separately from those
  // projection-only fields so this historical Chunk 2 parity assertion stays
  // exact without discarding the new MCP boundary metadata.
  const { artifactCount: _artifactCount, artifactsTruncated: _artifactsTruncated, ...importedGraph } = importedFromMcp
  assert.deepEqual(jsonValue(importedGraph), jsonValue(state))
  const prepared = await callMcp(mcpClient, 'prepare_workflow_context', {
    workspace_id: importedWorkspaceId,
    intent: 'Pressure-test the two human-authored browser acceptance items.',
    source_node_ids: [paperId, questionId],
    gate_policy: { minimum_sources: 2, require_dataset: false },
  })
  assert(prepared.contextId)
  const staged = await callMcp(mcpClient, 'stage_candidate_result', {
    context_id: prepared.contextId,
    title: 'MCP Approved Result',
    synthesis: 'The two admitted human records support a bounded interface and persistence acceptance result.',
    hypothesis: 'Visible human graph controls preserve authoritative state through the shared Core.',
    counterargument: 'A single browser scenario cannot establish every future concurrency behavior.',
    pressure_test: 'Restart both desktop storage and MCP, then compare their normalized workspace documents.',
    decision: 'mixed',
    confidence: 0.73,
    evidence_node_ids: [paperId, questionId],
  })
  assert(staged.run?.id)
  const challenge = await callMcp(mcpClient, 'get_candidate_approval_challenge', {
    workspace_id: importedWorkspaceId,
    run_id: staged.run.id,
  })
  const approved = await callMcp(mcpClient, 'approve_candidate_result', {
    workspace_id: importedWorkspaceId,
    run_id: staged.run.id,
    approval_token: challenge.approvalToken,
  })
  assert.equal(approved.activeRun.status, 'committed')
  assert(approved.workspace.nodes.some((node) => node.title === 'MCP Approved Result' && node.origin === 'approved-ai'))

  await page.getByRole('button', { name: 'Rename workspace' }).click()
  dialog = page.getByRole('dialog', { name: 'Rename workspace' })
  await dialogField(dialog, 'Workspace name', 'input').fill('Discarded Local Conflict Name')
  await dialog.getByRole('button', { name: 'Save name' }).click()
  await page.getByText('Core conflict detected', { exact: true }).waitFor({ timeout: 12_000 })
  await page.getByRole('alert').getByText('Workspace changed in ChatGPT—reload to reconcile.', { exact: false }).waitFor()
  const authoritativeDuringConflict = await desktopStore.read(importedWorkspaceId)
  assert.equal(authoritativeDuringConflict.name, 'Chunk 2 Human Graph Final')
  assert(authoritativeDuringConflict.nodes.some((node) => node.title === 'MCP Approved Result'))

  downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export local draft' }).click()
  download = await downloadPromise
  await download.saveAs(conflictExportPath)
  const conflictedDraft = JSON.parse(await readFile(conflictExportPath, 'utf8'))
  assert.equal(conflictedDraft.name, 'Discarded Local Conflict Name')
  assert.equal(conflictedDraft.nodes.some((node) => node.title === 'MCP Approved Result'), false)

  await acceptConfirmation(page, page.getByRole('button', { name: 'Reload authoritative' }))
  await page.getByRole('heading', { name: 'Chunk 2 Human Graph Final' }).waitFor()
  await page.getByText('MCP Approved Result', { exact: true }).first().waitFor()
  await waitForUiRevision(page, authoritativeDuringConflict.revision)

  // Prove post-conflict edits include protected MCP state rather than erasing it.
  await page.getByRole('button', { name: 'Rename workspace' }).click()
  dialog = page.getByRole('dialog', { name: 'Rename workspace' })
  await dialogField(dialog, 'Workspace name', 'input').fill('Imported UI Graph')
  await dialog.getByRole('button', { name: 'Save name' }).click()
  state = await waitForWorkspace(desktopStore, importedWorkspaceId, (value) => value.name === 'Imported UI Graph' && value.nodes.some((node) => node.title === 'MCP Approved Result'), 'post-conflict human save preserving MCP state')
  await waitForUiRevision(page, state.revision)

  // A delayed save drains fully before workspace switching. The destination
  // cannot render until the newest source draft is authoritative.
  saveDelayMs = 750
  await page.getByRole('button', { name: 'Rename workspace' }).click()
  dialog = page.getByRole('dialog', { name: 'Rename workspace' })
  await dialogField(dialog, 'Workspace name', 'input').fill('Imported UI Graph Switch Safe')
  await dialog.getByRole('button', { name: 'Save name' }).click()
  await page.locator('nav[aria-label="Workspaces"] .nav-item').filter({ hasText: 'Chunk 2 Human Graph Final' }).click()
  await delay(100)
  assert.equal(await page.getByRole('heading', { name: 'Imported UI Graph Switch Safe' }).count(), 1, 'Workspace switched before its delayed save drained.')
  await page.getByRole('heading', { name: 'Chunk 2 Human Graph Final' }).waitFor()
  state = await waitForWorkspace(desktopStore, importedWorkspaceId, (value) => value.name === 'Imported UI Graph Switch Safe', 'delayed save before workspace switch')
  await page.locator('nav[aria-label="Workspaces"] .nav-item').filter({ hasText: 'Imported UI Graph Switch Safe' }).click()
  await page.getByRole('heading', { name: 'Imported UI Graph Switch Safe' }).waitFor()
  await waitForUiRevision(page, state.revision)

  // Exercise the desktop lifecycle callback with the same delayed real-Core
  // save. Close readiness must not be acknowledged early.
  saveDelayMs = 750
  await page.getByRole('button', { name: 'Rename workspace' }).click()
  dialog = page.getByRole('dialog', { name: 'Rename workspace' })
  await dialogField(dialog, 'Workspace name', 'input').fill('Imported UI Graph Close Safe')
  await dialog.getByRole('button', { name: 'Save name' }).click()
  const closeDrainPromise = page.evaluate(() => window.__clarityTestTriggerPrepareClose())
  await delay(100)
  assert.equal(await page.evaluate(() => window.__clarityTestCloseAcknowledged), false, 'Close was acknowledged before its delayed save completed.')
  await closeDrainPromise
  assert.equal(await page.evaluate(() => window.__clarityTestCloseAcknowledged), true)
  state = await waitForWorkspace(desktopStore, importedWorkspaceId, (value) => value.name === 'Imported UI Graph Close Safe', 'delayed save before desktop close acknowledgement')
  await waitForUiRevision(page, state.revision)

  // Workspace delete is exercised on a real, disposable UI-created workspace.
  await page.getByLabel('New workspace name').fill('Temporary Delete Workspace')
  await page.getByRole('button', { name: 'Create workspace' }).click()
  const threeSummaries = await waitForWorkspaceList(desktopStore, (items) => items.length === 3 && items.some((item) => item.name === 'Temporary Delete Workspace'), 'temporary workspace creation')
  const temporaryWorkspace = threeSummaries.find((item) => item.name === 'Temporary Delete Workspace')
  assert(temporaryWorkspace)
  await page.getByRole('heading', { name: 'Temporary Delete Workspace' }).waitFor()
  await acceptConfirmation(page, page.getByRole('button', { name: 'Delete workspace', exact: true }))
  await waitForWorkspaceList(desktopStore, (items) => items.length === 2 && !items.some((item) => item.id === temporaryWorkspace.id), 'workspace deletion')
  await page.getByRole('heading', { name: 'Imported UI Graph Close Safe' }).waitFor()

  // A full renderer reload must rehydrate the same authoritative workspace.
  const beforeRendererReload = await desktopStore.read(importedWorkspaceId)
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('heading', { name: 'Imported UI Graph Close Safe' }).waitFor()
  try {
    await page.getByText('MCP Approved Result', { exact: true }).first().waitFor()
  } catch (error) {
    const graphDebug = await page.evaluate(() => ({
      graph: document.querySelector('.react-flow')?.getBoundingClientRect().toJSON(),
      viewportTransform: getComputedStyle(document.querySelector('.react-flow__viewport')).transform,
      nodes: [...document.querySelectorAll('.react-flow__node')].map((node) => ({
        id: node.getAttribute('data-id'),
        className: node.className,
        style: node.getAttribute('style'),
        visibility: getComputedStyle(node).visibility,
        display: getComputedStyle(node).display,
        opacity: getComputedStyle(node).opacity,
        rect: node.getBoundingClientRect().toJSON(),
        text: node.textContent,
      })),
    }))
    throw new Error(`Approved result was not visible after renderer reload. Graph state: ${JSON.stringify(graphDebug)}`, { cause: error })
  }
  await waitForUiRevision(page, beforeRendererReload.revision)
  const mcpAfterRendererReload = (await callMcp(mcpClient, 'get_clarity_workspace', { workspace_id: importedWorkspaceId })).workspace
  const { artifactCount: _reloadArtifactCount, artifactsTruncated: _reloadArtifactsTruncated, ...reloadGraph } = mcpAfterRendererReload
  assert.deepEqual(jsonValue(reloadGraph), jsonValue(beforeRendererReload))

  assert.deepEqual(consoleErrors, [], `Browser console errors: ${consoleErrors.join('\n')}`)
  assert.deepEqual(pageErrors, [], `Browser page errors: ${pageErrors.join('\n')}`)

  await browserContext.close()
  browserContext = undefined
  await browser.close()
  browser = undefined
  await mcpClient.close()
  mcpClient = undefined
  await mcpServer.close()
  mcpServer = undefined
  await desktopStore.close()
  desktopStore = undefined

  // Reopen both sides from disk, then compare the complete normalized result.
  restartedStore = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
  await restartedStore.initialize()
  const durable = await restartedStore.read(importedWorkspaceId)
  assert.deepEqual(jsonValue(durable), jsonValue(beforeRendererReload))
  const durablePaper = durable.nodes.find((node) => node.id === paperId)
  assert.equal(durablePaper?.pinned, true)
  assert(durablePaper && (Math.abs(durablePaper.position.x - positionBeforeDrag.x) > 10 || Math.abs(durablePaper.position.y - positionBeforeDrag.y) > 10))
  assert.deepEqual(durable.artifacts, [], 'Chunk 2 must not imply or inject dormant Chunk 3 file-ingestion state.')
  restartedMcpServer = await startClarityPluginServer({
    databaseFile: databasePath,
    artifactDirectory,
    legacyJsonPaths: [],
    host: '127.0.0.1',
    port: 0,
  })
  restartedMcpClient = await connectMcp(restartedMcpServer, 'clarity-chunk2-browser-restart')
  const durableFromMcp = (await callMcp(restartedMcpClient, 'get_clarity_workspace', { workspace_id: importedWorkspaceId })).workspace
  const { artifactCount: _durableArtifactCount, artifactsTruncated: _durableArtifactsTruncated, ...durableGraphFromMcp } = durableFromMcp
  assert.deepEqual(jsonValue(durableGraphFromMcp), jsonValue(durable))

  result.finalRevision = durable.revision
  result.finalNodes = durable.nodes.length
  result.finalEdges = durable.edges.length
  result.finalAnnotations = durable.annotations.length
  result.finalActivities = durable.activities.length
  console.log(JSON.stringify({ status: 'passed', ...result }, null, 2))
} finally {
  if (restartedMcpClient) await restartedMcpClient.close().catch(() => undefined)
  if (restartedMcpServer) await restartedMcpServer.close().catch(() => undefined)
  if (mcpClient) await mcpClient.close().catch(() => undefined)
  if (mcpServer) await mcpServer.close().catch(() => undefined)
  if (page && !page.isClosed()) await page.close().catch(() => undefined)
  if (browserContext) await browserContext.close().catch(() => undefined)
  if (browser) await browser.close().catch(() => undefined)
  if (restartedStore) await restartedStore.close().catch(() => undefined)
  if (desktopStore) await desktopStore.close().catch(() => undefined)
  if (webServer) await closeServer(webServer).catch(() => undefined)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
