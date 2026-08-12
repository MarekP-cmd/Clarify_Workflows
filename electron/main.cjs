const { app, BrowserWindow, dialog, ipcMain, session } = require('electron')
const { stat } = require('fs/promises')
const path = require('path')
const { pathToFileURL } = require('url')

app.setName('Clarity Workflows')
if (process.platform === 'win32') app.setAppUserModelId('app.clarityworkflows.desktop')

let clarityStore = null
const closeStates = new WeakMap()
const CLOSE_SAVE_TIMEOUT_MS = 10_000

function resultOk(value) {
  return { ok: true, value }
}

function resultError(error) {
  return {
    ok: false,
    error: {
      code: typeof error?.code === 'string' ? error.code : 'CLARITY_CORE_ERROR',
      message: error instanceof Error ? error.message : 'Clarity Core could not complete the request.',
    },
  }
}

function inferredMimeType(filePath) {
  const extension = path.extname(filePath).toLowerCase()
  const mimeTypes = {
    '.txt': 'text/plain',
    '.md': 'text/markdown',
    '.markdown': 'text/markdown',
    '.csv': 'text/csv',
    '.tsv': 'text/tab-separated-values',
    '.json': 'application/json',
    '.jsonl': 'application/x-ndjson',
    '.ndjson': 'application/x-ndjson',
    '.js': 'text/javascript',
    '.ts': 'text/typescript',
    '.tsx': 'text/typescript',
    '.py': 'text/x-python',
    '.sql': 'application/sql',
    '.xml': 'application/xml',
    '.css': 'text/css',
  }
  return mimeTypes[extension] || 'application/octet-stream'
}

function registerCoreHandler(channel, operation) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return resultOk(await operation(payload))
    } catch (error) {
      return resultError(error)
    }
  })
}

async function initializeClarityCore() {
  const storeModuleUrl = pathToFileURL(path.join(__dirname, '..', 'plugin', 'dist', 'store.js')).href
  const { CLARITY_DATABASE_SCHEMA_VERSION, WorkspaceStore } = await import(storeModuleUrl)
  clarityStore = new WorkspaceStore()
  await clarityStore.initialize()

  registerCoreHandler('clarity:list-workspaces', () => clarityStore.list())
  registerCoreHandler('clarity:create-workspace', (payload) => clarityStore.create(payload?.name))
  registerCoreHandler('clarity:get-workspace', (payload) => clarityStore.read(payload?.workspaceId))
  registerCoreHandler('clarity:save-human-workspace', (payload) => clarityStore.saveHumanWorkspace(
    payload?.workspaceId,
    payload?.input,
  ))
  registerCoreHandler('clarity:delete-workspace', (payload) => clarityStore.deleteWorkspace(
    payload?.workspaceId,
    payload?.expectedRevision,
  ))
  registerCoreHandler('clarity:import-workspace-document', (payload) => clarityStore.importWorkspaceDocument(payload?.document))
  registerCoreHandler('clarity:replace-graph', (payload) => clarityStore.replaceGraph(
    payload?.workspaceId,
    payload?.nodes,
    payload?.edges,
  ))
  registerCoreHandler('clarity:import-legacy-workspace', (payload) => clarityStore.importLegacyWorkspace(payload?.workspace, false))
  registerCoreHandler('clarity:choose-ingestion-files', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Add files to Clarity',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'Supported text and data files', extensions: ['txt', 'md', 'markdown', 'csv', 'tsv', 'json', 'jsonl', 'ndjson', 'c', 'cpp', 'css', 'go', 'h', 'java', 'js', 'jsx', 'py', 'rs', 'sql', 'swift', 'ts', 'tsx', 'vue', 'xml'] },
        { name: 'All files', extensions: ['*'] },
      ],
    })
    if (result.canceled) return []
    return Promise.all(result.filePaths.map(async (sourcePath) => {
      const fileStats = await stat(sourcePath)
      return { sourcePath, originalName: path.basename(sourcePath), mimeType: inferredMimeType(sourcePath), sizeBytes: fileStats.size }
    }))
  })
  registerCoreHandler('clarity:ingest-file-as-node', (payload) => clarityStore.ingestFileAsNode(
    payload?.workspaceId,
    payload?.sourcePath,
    { node: payload?.node, originalName: payload?.originalName, mimeType: payload?.mimeType },
  ))
  registerCoreHandler('clarity:retry-artifact-extraction', (payload) => clarityStore.retryArtifactExtraction(
    payload?.workspaceId,
    payload?.artifactId,
  ))
  registerCoreHandler('clarity:core-status', async () => ({
    ready: true,
    workspaceCount: (await clarityStore.list()).length,
    schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION,
    storageMode: 'sqlite',
  }))

  ipcMain.handle('clarity:close-ready', async (event) => {
    try {
      const window = BrowserWindow.fromWebContents(event.sender)
      const closeState = window ? closeStates.get(window) : null
      if (!window || !closeState?.waiting) throw Object.assign(new Error('No Clarity close request is waiting for saved renderer state.'), { code: 'CLOSE_NOT_PENDING' })
      closeState.waiting = false
      closeState.ready = true
      clearTimeout(closeState.timer)
      window.close()
      return resultOk(true)
    } catch (error) {
      return resultError(error)
    }
  })
}

function createWindow() {
  const rendererUrl = pathToFileURL(path.join(__dirname, '..', 'dist', 'index.html')).toString()
  const window = new BrowserWindow({
    width: 1680,
    height: 1020,
    minWidth: 1180,
    minHeight: 760,
    backgroundColor: '#0b1018',
    title: 'Clarity Workflows',
    show: false,
    autoHideMenuBar: process.platform !== 'darwin',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  })

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, targetUrl) => {
    if (targetUrl !== rendererUrl) event.preventDefault()
  })
  const closeState = { waiting: false, ready: false, timer: null }
  closeStates.set(window, closeState)
  window.on('close', (event) => {
    if (closeState.ready) return
    event.preventDefault()
    if (closeState.waiting || window.isDestroyed()) return
    closeState.waiting = true
    window.webContents.send('clarity:prepare-close')
    closeState.timer = setTimeout(() => {
      closeState.waiting = false
      console.error('Clarity kept the window open because the renderer did not confirm that pending changes were saved.')
      void dialog.showMessageBox(window, {
        type: 'error',
        title: 'Clarity is still saving',
        message: 'The window stayed open to protect unsaved workspace changes.',
        detail: 'Review the save status, retry any failed save, and close the window again.',
      })
    }, CLOSE_SAVE_TIMEOUT_MS)
  })
  window.on('closed', () => {
    if (closeState.timer) clearTimeout(closeState.timer)
    closeStates.delete(window)
  })
  window.once('ready-to-show', () => window.show())
  window.loadURL(rendererUrl).catch((error) => {
    console.error('Unable to load Clarity Workflows renderer:', error)
    app.quit()
  })
}

app.whenReady().then(async () => {
  session.defaultSession.setPermissionCheckHandler(() => false)
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  try {
    await initializeClarityCore()
    createWindow()
  } catch (error) {
    console.error('Unable to initialize Clarity Core:', error)
    app.quit()
  }
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0 && clarityStore) createWindow()
  })
})

let coreClosing = false
let quitAfterWindowsClose = false
app.on('before-quit', (event) => {
  if (!clarityStore || coreClosing) return
  event.preventDefault()
  const windows = BrowserWindow.getAllWindows()
  if (windows.length) {
    quitAfterWindowsClose = true
    for (const window of windows) window.close()
    return
  }
  coreClosing = true
  clarityStore.close()
    .catch((error) => console.error('Unable to close Clarity Core cleanly:', error))
    .finally(() => app.quit())
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin' || quitAfterWindowsClose) app.quit()
})
