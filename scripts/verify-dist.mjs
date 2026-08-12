import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'

const projectRoot = resolve(import.meta.dirname, '..')
const indexPath = resolve(projectRoot, 'dist', 'index.html')

if (!existsSync(indexPath)) throw new Error('dist/index.html is missing. Run npm run build first.')

const html = readFileSync(indexPath, 'utf8')
if (!html.includes('<title>Clarity Workflows')) throw new Error('The built renderer has the wrong product title.')

const assetReferences = [...html.matchAll(/(?:src|href)="(\.\/assets\/[^"]+)"/g)].map((match) => match[1])
if (assetReferences.length === 0) throw new Error('No relative renderer assets were found.')
if (/="\/assets\//.test(html)) throw new Error('Root-relative assets will not load through Electron file URLs.')

for (const reference of assetReferences) {
  const assetPath = resolve(projectRoot, 'dist', reference.replace(/^\.\//, ''))
  if (!existsSync(assetPath)) throw new Error(`Built renderer asset is missing: ${reference}`)
}

const builtAssets = readdirSync(resolve(projectRoot, 'dist', 'assets'))
  .filter((name) => name.endsWith('.js'))
  .map((name) => readFileSync(resolve(projectRoot, 'dist', 'assets', name), 'utf8'))
  .join('\n')

for (const forbiddenPrototypeValue of [
  'Why We Sleep',
  'Sleep Study 2024',
  'Clarity Workflows — Research Graph',
]) {
  if (builtAssets.includes(forbiddenPrototypeValue)) {
    throw new Error(`Production renderer still contains prototype data: ${forbiddenPrototypeValue}`)
  }
}

console.log(`Verified Clarity Workflows renderer and ${assetReferences.length} local assets.`)
