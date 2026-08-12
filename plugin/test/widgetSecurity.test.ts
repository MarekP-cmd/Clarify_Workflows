// @vitest-environment node

import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'

const widgetUrl = new URL('../public/clarity-widget.html', import.meta.url)

describe('Clarity MCP App component', () => {
  it('uses the MCP Apps bridge and keeps authoritative state off browser storage', async () => {
    const widget = await readFile(widgetUrl, 'utf8')
    expect(widget).toContain("protocolVersion: '2026-01-26'")
    expect(widget).toContain("rpcNotify('ui/notifications/initialized'")
    expect(widget).toContain("rpcRequest('ui/update-model-context'")
    expect(widget).toContain("callTool('get_candidate_approval_challenge'")
    expect(widget).toContain("'approve_candidate_result'")
    expect(widget).toContain('function toolCallError(result)')
    expect(widget).toContain('if (response?.isError !== true) return null;')
    expect(widget).toContain('if (error) throw error;')
    expect(widget).toContain('function buildDisplayGraph()')
    expect(widget).toContain('graph.nodeElements')
    expect(widget).toContain('const nodes = [...latestView.workspace.nodes]')
    expect(widget).toContain('latestView.workspace.annotations.filter')
    expect(widget).toContain('Imported ${declared} note · unverified')
    expect(widget).toContain('Imported content is not proof of a local Clarity approval.')
    expect(widget).toContain('AI-staged · uncommitted')
    expect(widget).toContain('function renderCitationPresentation(parent, citation)')
    expect(widget).toContain('Grounding citations · ${latestView.citationCount ?? citations.length}')
    expect(widget).toContain('Bounded source previews admitted from the verified Core search projection.')
    expect(widget).toContain('Unverified source data')
    expect(widget).not.toContain('const nodes = latestView.workspace.nodes;')
    expect(widget).not.toContain('nodes.map((node) => ({ ...node }))')
    expect(widget).not.toMatch(/localStorage|sessionStorage|document\.cookie|eval\s*\(/)
    expect(widget).not.toMatch(
      /<(?:script|link)[^>]+(?:src|href)=["']https?:\/\//i,
    )
    expect(widget).not.toMatch(/\bfetch\s*\(\s*["']https?:\/\//i)
  })
})
