import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

const RELEASE_VERSION = '0.6.0'

const readJson = async (relativePath) => JSON.parse(await readFile(new URL(relativePath, import.meta.url), 'utf8'))
const readText = async (relativePath) => readFile(new URL(relativePath, import.meta.url), 'utf8')

const rootPackage = await readJson('../package.json')
const rootLock = await readJson('../package-lock.json')
const runtimePackage = await readJson('../plugin/runtime-package/package.json')
const runtimeLock = await readJson('../plugin/runtime-package/package-lock.json')
const pluginManifest = await readJson('../.codex-plugin/plugin.json')

assert.equal(rootPackage.version, RELEASE_VERSION, 'desktop package version')
assert.equal(rootLock.version, RELEASE_VERSION, 'desktop lockfile version')
assert.equal(rootLock.packages?.['']?.version, RELEASE_VERSION, 'desktop lockfile root package version')
assert.equal(runtimePackage.version, RELEASE_VERSION, 'private MCP runtime package version')
assert.equal(runtimeLock.version, RELEASE_VERSION, 'private MCP runtime lockfile version')
assert.equal(runtimeLock.packages?.['']?.version, RELEASE_VERSION, 'private MCP runtime lockfile root package version')
assert.equal(pluginManifest.version, RELEASE_VERSION, 'Clarity plugin manifest version')

const server = await readText('../plugin/src/server.ts')
const widget = await readText('../plugin/public/clarity-widget.html')
const launcher = await readText('./Start-ClarityChatGPT.ps1')
const readme = await readText('../README.md')
const pluginReadme = await readText('../plugin/README.md')
const readFirst = await readText('../READ ME FIRST.txt')
const handoff = await readText('../CLARITY_PROJECT_HANDOFF.md')
const report = await readText('../CLARITY_V0.6.0_CHUNK4_REPORT.md')

assert.match(server, new RegExp(`CLARITY_VERSION = '${RELEASE_VERSION.replaceAll('.', '\\.')}'`))
assert.match(widget, new RegExp(`appInfo: \\{ name: 'clarity-workflows-graph', version: '${RELEASE_VERSION.replaceAll('.', '\\.')}' \\}`))
assert.match(launcher, new RegExp(`\\$ExpectedVersion = '${RELEASE_VERSION.replaceAll('.', '\\.')}'`))
assert.match(readme, new RegExp(`v${RELEASE_VERSION.replaceAll('.', '\\.')} — Chunk 4`))
assert.match(pluginReadme, new RegExp(`Version ${RELEASE_VERSION.replaceAll('.', '\\.')}`))
assert.match(readFirst, new RegExp(`CLARITY WORKFLOWS v${RELEASE_VERSION.replaceAll('.', '\\.')}`))
assert.match(handoff, new RegExp(`Current release: v${RELEASE_VERSION.replaceAll('.', '\\.')}`))
assert.match(report, new RegExp(`Clarity Workflows v${RELEASE_VERSION.replaceAll('.', '\\.')} — Chunk 4`))

console.log(`Clarity Workflows release-version surfaces agree on ${RELEASE_VERSION}.`)
