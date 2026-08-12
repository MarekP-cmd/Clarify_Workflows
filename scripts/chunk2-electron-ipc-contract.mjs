import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createRequire } from 'node:module'
import os from 'node:os'
import path from 'node:path'
import vm from 'node:vm'

const projectRoot = process.cwd()
const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk2-ipc-contract-'))
const databasePath = path.join(temporaryDirectory, 'clarity.sqlite3')
const artifactDirectory = path.join(temporaryDirectory, 'artifacts')
const mainPath = path.join(projectRoot, 'electron', 'main.cjs')
const preloadPath = path.join(projectRoot, 'electron', 'preload.cjs')
const nativeRequire = createRequire(mainPath)

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function waitFor(predicate, label, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const value = await predicate()
    if (value) return value
    await delay(25)
  }
  throw new Error(`Timed out waiting for ${label}.`)
}

async function evaluateCommonJs(filePath, customRequire) {
  const source = await readFile(filePath, 'utf8')
  const wrapped = `(function (require, module, exports, __filename, __dirname) { ${source}\n})`
  const script = new vm.Script(wrapped, {
    filename: filePath,
    importModuleDynamically: vm.constants.USE_MAIN_CONTEXT_DEFAULT_LOADER,
  })
  const moduleValue = { exports: {} }
  const execute = script.runInThisContext()
  execute(customRequire, moduleValue, moduleValue.exports, filePath, path.dirname(filePath))
  return moduleValue.exports
}

const ipcHandlers = new Map()
const ipcRendererEvents = new EventEmitter()
const exposedWorld = {}
const createdWindows = []
let quitCount = 0

const ipcMain = {
  handle(channel, handler) {
    assert.equal(ipcHandlers.has(channel), false, `Electron main registered duplicate IPC handler ${channel}.`)
    ipcHandlers.set(channel, handler)
  },
}

class FakeWebContents extends EventEmitter {
  constructor(owner) {
    super()
    this.owner = owner
  }

  setWindowOpenHandler(handler) {
    this.windowOpenHandler = handler
  }

  send(channel, ...args) {
    ipcRendererEvents.emit(channel, {}, ...args)
  }
}

class FakeBrowserWindow extends EventEmitter {
  static fromWebContents(webContents) {
    return webContents?.owner ?? null
  }

  static getAllWindows() {
    return createdWindows.filter((window) => !window.destroyed)
  }

  constructor(options) {
    super()
    this.options = options
    this.destroyed = false
    this.visible = false
    this.webContents = new FakeWebContents(this)
    createdWindows.push(this)
  }

  async loadURL(url) {
    this.loadedUrl = url
    queueMicrotask(() => this.emit('ready-to-show'))
  }

  show() {
    this.visible = true
  }

  isDestroyed() {
    return this.destroyed
  }

  close() {
    if (this.destroyed) return
    let prevented = false
    const event = { preventDefault: () => { prevented = true } }
    this.emit('close', event)
    if (prevented) return
    this.destroyed = true
    this.emit('closed')
  }
}

class FakeApp extends EventEmitter {
  setName(name) { this.name = name }
  setAppUserModelId(id) { this.appUserModelId = id }
  whenReady() { return Promise.resolve() }
  quit() { quitCount += 1 }
}

const app = new FakeApp()
const session = {
  defaultSession: {
    setPermissionCheckHandler(handler) { this.permissionCheckHandler = handler },
    setPermissionRequestHandler(handler) { this.permissionRequestHandler = handler },
  },
}
const dialog = { async showMessageBox() { return { response: 0 } } }
const fakeElectronMain = { app, BrowserWindow: FakeBrowserWindow, dialog, ipcMain, session }

const previousEnvironment = {
  CLARITY_DATABASE_FILE: process.env.CLARITY_DATABASE_FILE,
  CLARITY_ARTIFACTS_DIR: process.env.CLARITY_ARTIFACTS_DIR,
  CLARITY_DATA_FILE: process.env.CLARITY_DATA_FILE,
}
process.env.CLARITY_DATABASE_FILE = databasePath
process.env.CLARITY_ARTIFACTS_DIR = artifactDirectory
delete process.env.CLARITY_DATA_FILE

try {
  // Load the shipped main process unchanged. Only Electron's host objects are
  // instrumented because the managed test container has no X display; every
  // registered operation still executes the production SQLite WorkspaceStore.
  await evaluateCommonJs(mainPath, (specifier) => specifier === 'electron' ? fakeElectronMain : nativeRequire(specifier))
  await waitFor(() => ipcHandlers.has('clarity:core-status') && createdWindows.length === 1, 'Electron Core handler registration')

  const electronWindow = createdWindows[0]
  assert.equal(electronWindow.options.webPreferences.preload, preloadPath)
  assert.deepEqual({
    contextIsolation: electronWindow.options.webPreferences.contextIsolation,
    nodeIntegration: electronWindow.options.webPreferences.nodeIntegration,
    sandbox: electronWindow.options.webPreferences.sandbox,
    webSecurity: electronWindow.options.webPreferences.webSecurity,
    allowRunningInsecureContent: electronWindow.options.webPreferences.allowRunningInsecureContent,
  }, {
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
  })
  assert.deepEqual(electronWindow.webContents.windowOpenHandler(), { action: 'deny' })
  assert.equal(session.defaultSession.permissionCheckHandler(), false)
  let permissionAllowed = true
  session.defaultSession.permissionRequestHandler(null, 'camera', (allowed) => { permissionAllowed = allowed })
  assert.equal(permissionAllowed, false)

  const expectedChannels = [
    'clarity:choose-ingestion-files',
    'clarity:close-ready',
    'clarity:core-status',
    'clarity:create-workspace',
    'clarity:delete-workspace',
    'clarity:get-workspace',
    'clarity:import-legacy-workspace',
    'clarity:import-workspace-document',
    'clarity:ingest-file-as-node',
    'clarity:list-workspaces',
    'clarity:replace-graph',
    'clarity:retry-artifact-extraction',
    'clarity:save-human-workspace',
  ]
  assert.deepEqual([...ipcHandlers.keys()].sort(), expectedChannels)

  const ipcRenderer = {
    async invoke(channel, payload) {
      const handler = ipcHandlers.get(channel)
      if (!handler) throw new Error(`No instrumented main handler exists for ${channel}.`)
      return handler({ sender: electronWindow.webContents }, payload)
    },
    on(channel, listener) { ipcRendererEvents.on(channel, listener) },
    removeListener(channel, listener) { ipcRendererEvents.removeListener(channel, listener) },
  }
  const contextBridge = {
    exposeInMainWorld(name, value) {
      assert.equal(Object.hasOwn(exposedWorld, name), false)
      exposedWorld[name] = value
    },
  }

  // Load the shipped preload unchanged, connected to the handlers registered
  // above by the shipped main process.
  await evaluateCommonJs(preloadPath, (specifier) => {
    if (specifier === 'electron') return { contextBridge, ipcRenderer }
    return nativeRequire(specifier)
  })
  const core = exposedWorld.clarityCore
  const lifecycle = exposedWorld.clarityLifecycle
  assert(core && lifecycle)
  assert.equal(Object.isFrozen(core), true)
  assert.equal(Object.isFrozen(lifecycle), true)

  assert.deepEqual(await core.listWorkspaces(), [], 'The real IPC-backed Core must start without seeded workspaces.')
  const initialStatus = await core.status()
  assert.deepEqual(initialStatus, {
    ready: true,
    workspaceCount: 0,
    schemaVersion: 6,
    storageMode: 'sqlite',
  })

  const created = await core.createWorkspace('IPC Human Workspace')
  assert.equal(created.revision, 0)
  const humanInput = {
    expectedRevision: created.revision,
    name: 'IPC Human Workspace Saved',
    status: 'active',
    projects: [{
      id: 'ipc-project',
      name: 'IPC project',
      description: 'Created through the shipped preload/main boundary.',
      status: 'active',
    }],
    nodes: [
      {
        id: 'ipc-paper',
        projectId: 'ipc-project',
        origin: 'human',
        kind: 'paper',
        title: 'IPC paper',
        description: 'Human metadata passed through production IPC.',
        schemaType: 'ScholarlyArticle',
        status: 'verified',
        tags: ['ipc'],
        provenance: 'Entered by the IPC acceptance operator',
        position: { x: 100, y: 120 },
        pinned: true,
      },
      {
        id: 'ipc-question',
        origin: 'human',
        kind: 'question',
        title: 'IPC question',
        description: 'Second human work item.',
        schemaType: 'Question',
        status: 'candidate',
        tags: ['ipc'],
        provenance: 'Entered by the IPC acceptance operator',
        position: { x: 420, y: 180 },
      },
    ],
    edges: [{ id: 'ipc-edge', source: 'ipc-paper', target: 'ipc-question', relation: 'frames' }],
    annotations: [{
      id: 'ipc-annotation',
      nodeId: 'ipc-paper',
      author: 'human',
      origin: 'local',
      body: 'Human annotation through production IPC.',
    }],
  }
  const saved = await core.saveHumanWorkspace(created.id, humanInput)
  assert.equal(saved.revision, 1)
  assert.equal(saved.projects.length, 1)
  assert.equal(saved.nodes.length, 2)
  assert.equal(saved.edges.length, 1)
  assert.equal(saved.annotations.length, 1)
  assert.equal((await core.getWorkspace(created.id)).nodes[0].origin, 'human')

  await assert.rejects(
    core.saveHumanWorkspace(created.id, humanInput),
    (error) => error instanceof Error && error.code === 'WORKSPACE_CONFLICT' && /revision/.test(error.message),
    'The preload must reconstruct structured Core errors from the main-process envelope.',
  )

  const imported = await core.importWorkspaceDocument({
    format: 'clarity-workspace',
    version: 1,
    exportedAt: '2026-08-11T12:00:00.000Z',
    name: 'IPC portable import',
    status: 'active',
    projects: [],
    nodes: [{
      id: 'ipc-imported-question',
      origin: 'human',
      kind: 'question',
      title: 'Imported IPC question',
      description: 'Portable human graph record.',
      schemaType: 'Question',
      status: 'candidate',
      tags: [],
      provenance: 'Portable IPC contract document',
      position: { x: 40, y: 60 },
    }],
    edges: [],
    annotations: [],
  })
  assert.equal(imported.nodes[0].origin, 'imported-unverified')
  await assert.rejects(core.deleteWorkspace(imported.id, imported.revision + 1), (error) => error?.code === 'WORKSPACE_CONFLICT')
  assert.equal((await core.deleteWorkspace(imported.id, imported.revision)).deleted, true)

  // Exercise the exact preload listener and main close-ready handler. The
  // window remains open until the callback's Core save resolves and invokes
  // the production confirmation bridge.
  let closeCallbackFinished = false
  const removePrepareClose = lifecycle.onPrepareClose(async () => {
    const current = await core.getWorkspace(created.id)
    await core.saveHumanWorkspace(created.id, {
      expectedRevision: current.revision,
      name: 'IPC Close Drained',
      status: current.status,
      projects: current.projects,
      nodes: current.nodes,
      edges: current.edges,
      annotations: current.annotations.filter((annotation) => annotation.author === 'human'),
    })
    await lifecycle.confirmCloseReady()
    closeCallbackFinished = true
  })
  electronWindow.close()
  assert.equal(electronWindow.destroyed, false, 'Main must prevent the initial close while the renderer drains.')
  await waitFor(() => closeCallbackFinished && electronWindow.destroyed, 'preload/main close-save acknowledgement')
  const closeDrainedWorkspace = await core.getWorkspace(created.id)
  assert.equal(closeDrainedWorkspace.name, 'IPC Close Drained')
  removePrepareClose()

  const beforeQuit = { prevented: false, preventDefault() { this.prevented = true } }
  app.emit('before-quit', beforeQuit)
  assert.equal(beforeQuit.prevented, true)
  await waitFor(() => quitCount > 0, 'Core shutdown before app quit')

  console.log(JSON.stringify({
    status: 'passed',
    boundary: 'shipped electron/main.cjs + electron/preload.cjs with instrumented host APIs',
    schemaVersion: initialStatus.schemaVersion,
    registeredChannels: expectedChannels.length,
    persistedWorkspaceId: created.id,
    finalRevision: closeDrainedWorkspace.revision,
  }, null, 2))
} finally {
  if (previousEnvironment.CLARITY_DATABASE_FILE === undefined) delete process.env.CLARITY_DATABASE_FILE
  else process.env.CLARITY_DATABASE_FILE = previousEnvironment.CLARITY_DATABASE_FILE
  if (previousEnvironment.CLARITY_ARTIFACTS_DIR === undefined) delete process.env.CLARITY_ARTIFACTS_DIR
  else process.env.CLARITY_ARTIFACTS_DIR = previousEnvironment.CLARITY_ARTIFACTS_DIR
  if (previousEnvironment.CLARITY_DATA_FILE === undefined) delete process.env.CLARITY_DATA_FILE
  else process.env.CLARITY_DATA_FILE = previousEnvironment.CLARITY_DATA_FILE
  await rm(temporaryDirectory, { recursive: true, force: true })
}
