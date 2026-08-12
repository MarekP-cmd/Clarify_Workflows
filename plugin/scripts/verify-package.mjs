import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const manifestUrl = new URL('../../.codex-plugin/plugin.json', import.meta.url)
const skillUrl = new URL('../../skills/clarity-workflows/SKILL.md', import.meta.url)
const widgetUrl = new URL('../public/clarity-widget.html', import.meta.url)
const iconUrl = new URL('../../assets/clarity-icon.svg', import.meta.url)
const configureUrl = new URL('./configure-app.mjs', import.meta.url)

const manifest = JSON.parse(await readFile(manifestUrl, 'utf8'))
const skill = await readFile(skillUrl, 'utf8')
const widget = await readFile(widgetUrl, 'utf8')
const icon = await readFile(iconUrl, 'utf8')
const configure = await readFile(configureUrl, 'utf8')
const distFiles = await readdir(new URL('../dist/', import.meta.url))

assert.equal(manifest.name, 'clarity-workflows')
assert.equal(manifest.version, '0.6.0')
assert.equal(manifest.skills, './skills/')
assert.equal(manifest.interface.composerIcon, './assets/clarity-icon.svg')
assert.equal(manifest.interface.logo, './assets/clarity-icon.svg')
if (manifest.apps !== undefined) {
  assert.equal(manifest.apps, './.app.json')
  const appMapping = JSON.parse(await readFile(new URL('../../.app.json', import.meta.url), 'utf8'))
  assert.match(appMapping.apps?.['clarity-workflows']?.id ?? '', /^plugin_asdk_app_[A-Za-z0-9_-]+$/)
  assert.equal(appMapping.apps['clarity-workflows'].required, true)
}
assert.match(skill, /^---\nname: clarity-workflows\ndescription:/)
assert.match(skill, /prepare_workflow_context/)
assert.match(skill, /Never claim that a staged candidate is committed/)
assert.doesNotMatch(skill, /paper-1|dataset-1|Why We Sleep/)
assert.match(widget, /ui\/initialize/)
assert.match(widget, /approve_candidate_result/)
assert.match(icon, /^<svg/)
assert.match(configure, /plugin_asdk_app_/)
assert.equal(distFiles.some((name) => name.startsWith('seed.')), false)

console.log('Clarity plugin package manifest, skill, and embedded component passed structural verification.')
