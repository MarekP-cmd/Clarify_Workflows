import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { request } from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js'
import { startClarityPluginServer } from '../plugin/dist/server.js'

const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-v030-diagnostics-'))
const server = await startClarityPluginServer({
  dataFile: path.join(directory, 'workspace.json'),
  host: '127.0.0.1',
  port: 0,
})
const client = new Client({ name: 'clarity-diagnostic-client', version: '0.4.0' })

function chunkedOversizeRequest() {
  return new Promise((resolve, reject) => {
    const outgoing = request(server.mcpUrl, {
      method: 'POST',
      headers: {
        accept: 'application/json, text/event-stream',
        'content-type': 'application/json',
        connection: 'close',
      },
    }, (incoming) => {
      let responseBody = ''
      incoming.setEncoding('utf8')
      incoming.on('data', (chunk) => { responseBody += chunk })
      incoming.on('end', () => resolve({ status: incoming.statusCode, body: responseBody.slice(0, 300) }))
    })
    outgoing.on('error', reject)
    const chunk = Buffer.alloc(64 * 1024, 0x20)
    for (let written = 0; written <= 1_000_000; written += chunk.length) outgoing.write(chunk)
    outgoing.end()
  })
}

try {
  await client.connect(new StreamableHTTPClientTransport(new URL(server.mcpUrl)))
  const invalidToolResult = await client.callTool({
    name: 'inspect_clarity_node',
    arguments: { node_id: 'missing-diagnostic-node' },
  })
  const integrationAfterFailedTool = await fetch(server.integrationUrl).then((response) => response.json())
  const chunkedOversize = await chunkedOversizeRequest()

  assert.equal(invalidToolResult.isError, true)
  assert.equal(integrationAfterFailedTool.phase, 'tool_failed')
  assert.equal(integrationAfterFailedTool.toolCallObserved, false)
  assert.equal(integrationAfterFailedTool.failedToolCalls, 1)
  assert.equal(chunkedOversize.status, 413)

  console.log(JSON.stringify({
    invalidToolResult: {
      isError: invalidToolResult.isError,
      message: invalidToolResult.content?.[0]?.text,
    },
    integrationAfterFailedTool: {
      phase: integrationAfterFailedTool.phase,
      toolCallObserved: integrationAfterFailedTool.toolCallObserved,
      failedToolCalls: integrationAfterFailedTool.failedToolCalls,
      lastFailedToolName: integrationAfterFailedTool.lastFailedToolName,
    },
    chunkedOversize,
  }, null, 2))
} finally {
  await client.close().catch(() => undefined)
  await server.close().catch(() => undefined)
  await rm(directory, { recursive: true, force: true })
}
