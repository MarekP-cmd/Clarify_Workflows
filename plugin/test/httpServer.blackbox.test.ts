// @vitest-environment node

import { mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { startClarityPluginServer, type ClarityHttpServerOptions, type RunningClarityServer } from '../src/server.js'

const temporaryDirectories: string[] = []
const runningServers: RunningClarityServer[] = []

afterEach(async () => {
  await Promise.all(runningServers.splice(0).map((server) => server.close().catch(() => undefined)))
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })))
})

async function start(options: ClarityHttpServerOptions = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'clarity-http-blackbox-'))
  temporaryDirectories.push(directory)
  const server = await startClarityPluginServer({
    dataFile: path.join(directory, 'workspace.json'),
    host: '127.0.0.1',
    port: 0,
    ...options,
  })
  runningServers.push(server)
  return server
}

function url(server: RunningClarityServer, pathname: string) {
  return `http://${server.host}:${server.port}${pathname}`
}

describe('Clarity HTTP black-box behavior', () => {
  it('exposes health and both integration-status aliases without caching', async () => {
    const server = await start()
    for (const pathname of ['/', '/healthz', '/connectionz', '/integrationz']) {
      const response = await fetch(url(server, pathname))
      expect(response.status).toBe(200)
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('x-content-type-options')).toBe('nosniff')
      expect((await response.json()).version).toBe('0.6.0')
    }
  })

  it('permits an allowlisted browser origin and rejects a different origin', async () => {
    const server = await start({ allowedOrigins: ['https://chatgpt.com'] })
    const allowed = await fetch(url(server, '/healthz'), { headers: { Origin: 'https://chatgpt.com' } })
    expect(allowed.status).toBe(200)
    expect(allowed.headers.get('access-control-allow-origin')).toBe('https://chatgpt.com')
    expect(allowed.headers.get('vary')).toBe('Origin')

    const denied = await fetch(url(server, '/healthz'), { headers: { Origin: 'https://untrusted.example' } })
    expect(denied.status).toBe(403)
    expect(await denied.text()).toBe('Origin not allowed')
  })

  it('handles CORS preflight and rejects unsupported paths and methods', async () => {
    const server = await start()
    const preflight = await fetch(server.mcpUrl, { method: 'OPTIONS' })
    expect(preflight.status).toBe(204)
    expect(preflight.headers.get('access-control-allow-methods')).toContain('POST')

    expect((await fetch(url(server, '/missing'))).status).toBe(404)
    expect((await fetch(server.mcpUrl, { method: 'PUT' })).status).toBe(404)
  })

  it('enforces optional bearer authentication before MCP processing', async () => {
    const server = await start({ bearerToken: 'private-test-token' })
    const missing = await fetch(server.mcpUrl, { method: 'POST' })
    expect(missing.status).toBe(401)
    expect(missing.headers.get('www-authenticate')).toContain('Bearer')

    const wrong = await fetch(server.mcpUrl, { method: 'POST', headers: { Authorization: 'Bearer wrong' } })
    expect(wrong.status).toBe(401)

    const authenticated = await fetch(server.mcpUrl, {
      method: 'POST',
      headers: { Authorization: 'Bearer private-test-token', 'content-type': 'application/json' },
      body: '{}',
    })
    expect(authenticated.status).not.toBe(401)
  })

  it('rejects declared oversized requests before the MCP transport reads them', async () => {
    const server = await start()
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const outgoing = request(server.mcpUrl, {
          method: 'POST',
          headers: { 'content-length': '1000001', 'content-type': 'application/json' },
        }, (incoming) => {
          let body = ''
          incoming.setEncoding('utf8')
          incoming.on('data', (chunk) => { body += chunk })
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }))
        })
        outgoing.on('error', reject)
        outgoing.end()
      }).catch(reject)
    })
    expect(response).toEqual({ status: 413, body: 'Request too large' })
  })

  it('rejects chunked oversized requests while they are streaming', async () => {
    const server = await start()
    const response = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      import('node:http').then(({ request }) => {
        const outgoing = request(server.mcpUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/json', connection: 'close' },
        }, (incoming) => {
          let body = ''
          incoming.setEncoding('utf8')
          incoming.on('data', (chunk) => { body += chunk })
          incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }))
        })
        outgoing.on('error', reject)
        const chunk = Buffer.alloc(64 * 1024, 0x20)
        for (let index = 0; index < 16; index += 1) outgoing.write(chunk)
        outgoing.end()
      }).catch(reject)
    })
    expect(response).toEqual({ status: 413, body: 'Request too large' })
  })

  it.each([-1, 65_536, 1.5, Number.NaN])('rejects invalid TCP port %s', async (port) => {
    await expect(startClarityPluginServer({ port })).rejects.toThrow(/Invalid plugin port/)
  })
})
