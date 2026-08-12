import assert from 'node:assert/strict'
import { fork } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { fileURLToPath, pathToFileURL } from 'node:url'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

const scriptPath = fileURLToPath(import.meta.url)
const projectRoot = path.resolve(path.dirname(scriptPath), '..')
const storeModuleUrl = pathToFileURL(path.join(projectRoot, 'plugin', 'dist', 'store.js')).href

function serializedError(error) {
  return {
    name: error instanceof Error ? error.name : 'Error',
    code: typeof error?.code === 'string' ? error.code : undefined,
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  }
}

async function runInitializerWorker() {
  const [databasePath, artifactDirectory, label] = process.argv.slice(3)
  assert(databasePath && artifactDirectory && label, 'Concurrent initializer worker arguments are required.')
  assert(process.send, 'Concurrent initializer workers require a parent IPC channel.')

  const { CLARITY_DATABASE_SCHEMA_VERSION, WorkspaceStore } = await import(storeModuleUrl)
  process.send({ type: 'ready', label, pid: process.pid })

  const release = await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timed out waiting at the concurrent-initialize barrier.')), 10_000)
    process.once('message', (message) => {
      clearTimeout(timeout)
      if (!message || message.type !== 'release' || !Number.isFinite(message.releaseAt)) {
        reject(new Error('Received an invalid concurrent-initialize barrier release.'))
        return
      }
      resolve(message)
    })
  })

  const delay = Math.max(0, release.releaseAt - Date.now())
  if (delay) await new Promise((resolve) => setTimeout(resolve, delay))
  const startedAt = Date.now()
  const store = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })

  try {
    await store.initialize()
    const workspaces = await store.list()
    await store.close()
    process.send({
      type: 'result',
      ok: true,
      label,
      pid: process.pid,
      startedAt,
      finishedAt: Date.now(),
      schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION,
      workspaceCount: workspaces.length,
    }, () => process.disconnect())
  } catch (error) {
    await store.close().catch(() => undefined)
    process.send({
      type: 'result',
      ok: false,
      label,
      pid: process.pid,
      error: serializedError(error),
    }, () => process.disconnect())
    process.exitCode = 1
  }
}

if (process.argv[2] === '--worker') {
  await runInitializerWorker()
} else {
  const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-chunk2-concurrent-init-'))
  const databasePath = path.join(temporaryDirectory, 'clarity.sqlite3')
  const artifactDirectory = path.join(temporaryDirectory, 'artifacts')

  function spawnInitializer(label) {
    const child = fork(scriptPath, ['--worker', databasePath, artifactDirectory, label], {
      cwd: projectRoot,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk })
    child.stderr.on('data', (chunk) => { stderr += chunk })

    let resolveReady
    let rejectReady
    const ready = new Promise((resolve, reject) => {
      resolveReady = resolve
      rejectReady = reject
    })
    let resolveResult
    let rejectResult
    const result = new Promise((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    const timeout = setTimeout(() => {
      const error = new Error(`Timed out waiting for concurrent initializer ${label}.`)
      rejectReady(error)
      rejectResult(error)
      child.kill()
    }, 15_000)

    child.on('message', (message) => {
      if (message?.type === 'ready') resolveReady(message)
      if (message?.type === 'result') resolveResult(message)
    })
    child.once('error', (error) => {
      clearTimeout(timeout)
      rejectReady(error)
      rejectResult(error)
    })
    child.once('exit', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) return
      const error = new Error(
        `Concurrent initializer ${label} exited with code ${String(code)} signal ${String(signal)}.`
        + `${stderr ? `\nstderr:\n${stderr}` : ''}${stdout ? `\nstdout:\n${stdout}` : ''}`,
      )
      rejectReady(error)
      rejectResult(error)
    })
    return { child, ready, result, getLogs: () => ({ stdout, stderr }) }
  }

  const initializers = [spawnInitializer('initializer-a'), spawnInitializer('initializer-b')]

  try {
    const ready = await Promise.all(initializers.map((initializer) => initializer.ready))
    assert.equal(new Set(ready.map((message) => message.pid)).size, 2, 'The barrier must contain two distinct OS processes.')

    // Both independent processes wait for the same future epoch before either
    // opens the brand-new SQLite file. This is the migration-race barrier.
    const releaseAt = Date.now() + 150
    for (const initializer of initializers) initializer.child.send({ type: 'release', releaseAt })

    const results = await Promise.all(initializers.map((initializer) => initializer.result))
    for (const result of results) {
      assert.equal(result.ok, true, `${result.label} failed: ${JSON.stringify(result.error)}`)
      assert.equal(result.schemaVersion, 6)
      assert.equal(result.workspaceCount, 0, 'Fresh production Core initialization must not seed a workspace.')
    }
    assert.equal(new Set(results.map((result) => result.pid)).size, 2)
    assert(
      Math.abs(results[0].startedAt - results[1].startedAt) <= 100,
      `The two processes did not cross the barrier together: ${results.map((result) => result.startedAt).join(', ')}.`,
    )

    const database = new DatabaseSync(databasePath)
    try {
      const quickCheck = database.prepare('PRAGMA quick_check(1)').get()
      assert.equal(quickCheck.quick_check, 'ok')
      assert.deepEqual(database.prepare('PRAGMA foreign_key_check').all(), [])
      assert.deepEqual(
        database.prepare('SELECT version FROM schema_migrations ORDER BY version').all().map((row) => row.version),
        [1, 2, 3, 4, 5, 6],
      )
      assert.equal(database.prepare('SELECT COUNT(*) AS count FROM workspaces').get().count, 0)

      const tableNames = database.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all()
        .map((row) => row.name)
      for (const expectedTable of ['activities', 'annotations', 'artifact_cleanup', 'nodes', 'schema_migrations', 'search_chunks', 'search_documents', 'search_index_state', 'workspaces']) {
        assert(tableNames.includes(expectedTable), `Final schema is missing ${expectedTable}.`)
      }
      const columnNames = (table) => database.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name)
      assert(columnNames('workspaces').includes('revision'))
      assert(columnNames('workspaces').includes('status'))
      assert(columnNames('nodes').includes('origin'))
      assert(columnNames('annotations').includes('origin'))
      assert(columnNames('annotations').includes('declared_author'))
    } finally {
      database.close()
    }

    const { CLARITY_DATABASE_SCHEMA_VERSION, WorkspaceStore } = await import(storeModuleUrl)
    const verifier = new WorkspaceStore({ databasePath, artifactDirectory, legacyJsonPaths: [] })
    await verifier.initialize()
    assert.equal(CLARITY_DATABASE_SCHEMA_VERSION, 6)
    assert.deepEqual(await verifier.list(), [])
    await verifier.close()

    console.log(JSON.stringify({
      status: 'passed',
      boundary: 'two independent Node OS processes released by one IPC barrier onto a fresh shared SQLite file',
      schemaVersion: CLARITY_DATABASE_SCHEMA_VERSION,
      processIds: results.map((result) => result.pid),
      startSkewMs: Math.abs(results[0].startedAt - results[1].startedAt),
      migrationVersions: [1, 2, 3, 4, 5, 6],
      finalWorkspaceCount: 0,
      quickCheck: 'ok',
    }, null, 2))
  } catch (error) {
    for (const initializer of initializers) {
      if (initializer.child.exitCode === null) initializer.child.kill()
      const logs = initializer.getLogs()
      if (logs.stderr) process.stderr.write(logs.stderr)
      if (logs.stdout) process.stderr.write(logs.stdout)
    }
    throw error
  } finally {
    await rm(temporaryDirectory, { recursive: true, force: true })
  }
}
