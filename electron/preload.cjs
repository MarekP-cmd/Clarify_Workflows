const { contextBridge, ipcRenderer, webUtils } = require('electron')

async function invoke(channel, payload) {
  const result = await ipcRenderer.invoke(channel, payload)
  if (result?.ok) return result.value
  const error = new Error(result?.error?.message || 'Clarity Core request failed.')
  error.code = result?.error?.code || 'CLARITY_CORE_ERROR'
  throw error
}

contextBridge.exposeInMainWorld('clarityCore', Object.freeze({
  listWorkspaces: () => invoke('clarity:list-workspaces'),
  createWorkspace: (name) => invoke('clarity:create-workspace', { name }),
  getWorkspace: (workspaceId) => invoke('clarity:get-workspace', { workspaceId }),
  saveHumanWorkspace: (workspaceId, input) => invoke('clarity:save-human-workspace', { workspaceId, input }),
  deleteWorkspace: (workspaceId, expectedRevision) => invoke('clarity:delete-workspace', { workspaceId, expectedRevision }),
  importWorkspaceDocument: (document) => invoke('clarity:import-workspace-document', { document }),
  replaceGraph: (workspaceId, nodes, edges) => invoke('clarity:replace-graph', { workspaceId, nodes, edges }),
  importLegacyWorkspace: (workspace) => invoke('clarity:import-legacy-workspace', { workspace }),
  status: () => invoke('clarity:core-status'),
}))

contextBridge.exposeInMainWorld('clarityFiles', Object.freeze({
  chooseFiles: () => invoke('clarity:choose-ingestion-files'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  ingestFileAsNode: (workspaceId, sourcePath, node, options) => invoke('clarity:ingest-file-as-node', { workspaceId, sourcePath, node, ...options }),
  retryArtifactExtraction: (workspaceId, artifactId) => invoke('clarity:retry-artifact-extraction', { workspaceId, artifactId }),
}))

contextBridge.exposeInMainWorld('clarityLifecycle', Object.freeze({
  onPrepareClose: (callback) => {
    if (typeof callback !== 'function') throw new TypeError('A close-preparation callback is required.')
    const listener = () => {
      void Promise.resolve(callback()).catch((error) => console.error('Clarity could not prepare the renderer for closing:', error))
    }
    ipcRenderer.on('clarity:prepare-close', listener)
    return () => ipcRenderer.removeListener('clarity:prepare-close', listener)
  },
  confirmCloseReady: () => invoke('clarity:close-ready'),
}))
