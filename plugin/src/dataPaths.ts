import { homedir } from 'node:os'
import path from 'node:path'

export type ClarityDataPaths = {
  dataDirectory: string
  databaseFile: string
  artifactDirectory: string
  legacyWorkspaceFiles: string[]
}

type Environment = Record<string, string | undefined>

function defaultDataDirectory(environment: Environment, platform: NodeJS.Platform) {
  if (environment.CLARITY_DATA_DIR) return path.resolve(environment.CLARITY_DATA_DIR)

  if (platform === 'win32') {
    const localAppData = environment.LOCALAPPDATA
      || path.join(homedir(), 'AppData', 'Local')
    return path.join(localAppData, 'Clarity Workflows', 'data')
  }

  if (platform === 'darwin') {
    return path.join(homedir(), 'Library', 'Application Support', 'Clarity Workflows')
  }

  const xdgData = environment.XDG_DATA_HOME || path.join(homedir(), '.local', 'share')
  return path.join(xdgData, 'clarity-workflows')
}

export function resolveClarityDataPaths(
  environment: Environment = process.env,
  platform: NodeJS.Platform = process.platform,
): ClarityDataPaths {
  const configuredDatabase = environment.CLARITY_DATABASE_FILE
  const dataDirectory = configuredDatabase
    ? path.dirname(path.resolve(configuredDatabase))
    : defaultDataDirectory(environment, platform)
  const databaseFile = configuredDatabase
    ? path.resolve(configuredDatabase)
    : path.join(dataDirectory, 'clarity.sqlite3')
  const artifactDirectory = environment.CLARITY_ARTIFACTS_DIR
    ? path.resolve(environment.CLARITY_ARTIFACTS_DIR)
    : path.join(dataDirectory, 'artifacts')

  const legacyWorkspaceFiles = [
    environment.CLARITY_DATA_FILE,
    path.join(dataDirectory, 'workspace.json'),
    path.join(path.dirname(dataDirectory), 'workspace.json'),
  ].filter((candidate, index, values): candidate is string => (
    Boolean(candidate) && values.indexOf(candidate) === index
  )).map((candidate) => path.resolve(candidate))

  return { dataDirectory, databaseFile, artifactDirectory, legacyWorkspaceFiles }
}
