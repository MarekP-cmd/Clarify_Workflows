import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { CLARITY_TOOL_COUNT, CLARITY_UI_URI, CLARITY_VERSION, startClarityPluginServer } from '../dist/server.js'
import { createTemporaryTestWorkspace } from './test-fixture.mjs'

const temporaryDirectory = await mkdtemp(path.join(os.tmpdir(), 'clarity-plugin-smoke-'))
let running
let client

try {
  const databaseFile = await createTemporaryTestWorkspace(temporaryDirectory)
  running = await startClarityPluginServer({
    databaseFile,
    artifactDirectory: path.join(temporaryDirectory, 'artifacts'),
    legacyJsonPaths: [],
    host: '127.0.0.1',
    port: 0,
  })

  client = new Client({ name: 'clarity-release-smoke', version: CLARITY_VERSION })
  await client.connect(new StreamableHTTPClientTransport(new URL(running.mcpUrl)))

  const listed = await client.listTools()
  assert.equal(listed.tools.length, CLARITY_TOOL_COUNT)
  const names = new Set(listed.tools.map((tool) => tool.name))
  for (const expected of [
    'get_clarity_workspace',
    'prepare_workflow_context',
    'search_clarity_workspace',
    'retrieve_search_passage',
    'admit_search_citations',
    'stage_candidate_result',
    'render_clarity_workflow',
    'approve_candidate_result',
  ]) {
    assert(names.has(expected), `Missing MCP tool: ${expected}`)
  }

  const workspaceResult = await client.callTool({ name: 'get_clarity_workspace', arguments: {} })
  assert.equal(workspaceResult.isError, undefined)
  assert(Array.isArray(workspaceResult.structuredContent?.workspace?.nodes))

  const resource = await client.readResource({ uri: CLARITY_UI_URI })
  assert.equal(resource.contents[0]?.mimeType, 'text/html;profile=mcp-app')
  assert.match(resource.contents[0]?.text ?? '', /Clarity Workflows/)

  console.log(`Clarity MCP smoke test passed: ${listed.tools.length} tools, shared Core graph data, and embedded UI resource.`)
} finally {
  await client?.close().catch(() => undefined)
  await running?.close().catch(() => undefined)
  await rm(temporaryDirectory, { recursive: true, force: true })
}
