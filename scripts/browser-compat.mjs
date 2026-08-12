import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, stat } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from '@playwright/test'

const projectRoot = process.cwd()
const distRoot = path.join(projectRoot, 'dist')
const widgetPath = path.join(projectRoot, 'plugin', 'public', 'clarity-widget.html')

const contentTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
])

function safeDistPath(urlPath) {
  const relative = urlPath === '/' ? 'index.html' : urlPath.replace(/^\/+/, '')
  const resolved = path.resolve(distRoot, relative)
  return resolved === distRoot || resolved.startsWith(`${distRoot}${path.sep}`) ? resolved : null
}

const server = createServer(async (request, response) => {
  try {
    const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (requestUrl.pathname === '/clarity-widget.html') {
      response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
      response.end(await readFile(widgetPath))
      return
    }
    const filePath = safeDistPath(requestUrl.pathname)
    if (!filePath || !(await stat(filePath)).isFile()) {
      response.writeHead(404).end('Not Found')
      return
    }
    const responseHeaders = {
      'content-type': contentTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
      'cache-control': 'no-store',
    }
    if (path.extname(filePath) === '.html') {
      responseHeaders['content-security-policy'] = "frame-ancestors 'none'"
    }
    response.writeHead(200, responseHeaders)
    response.end(await readFile(filePath))
  } catch {
    response.writeHead(404).end('Not Found')
  }
})

await new Promise((resolve, reject) => {
  server.once('error', reject)
  server.listen(0, '127.0.0.1', resolve)
})
const address = server.address()
assert(address && typeof address !== 'string')
const baseUrl = `http://127.0.0.1:${address.port}`

let executablePath = process.env.CLARITY_CHROMIUM_EXECUTABLE
let browserArgs = []
if (!executablePath) {
  try {
    const module = await import('@sparticuz/chromium')
    executablePath = await module.default.executablePath()
    browserArgs = module.default.args
  } catch {
    executablePath = chromium.executablePath()
  }
}

const launchBrowser = () => chromium.launch({ executablePath, args: browserArgs, headless: true })
let browser = await launchBrowser()
const results = { engine: await browser.version(), desktop: [], widget: [] }

async function dimensions(page) {
  return page.evaluate(() => ({
    innerWidth: window.innerWidth,
    bodyScrollWidth: document.body.scrollWidth,
    documentScrollWidth: document.documentElement.scrollWidth,
    bodyScrollHeight: document.body.scrollHeight,
  }))
}

async function completeHumanWorkItemForm(page, title, description) {
  const dialog = page.getByRole('dialog', { name: 'Add work item' })
  await dialog.getByLabel(/^Title/).fill(title)
  await dialog.getByLabel('Description').fill(description)
  await dialog.getByLabel(/^Provenance/).fill('Entered by the browser compatibility operator')
  await dialog.getByRole('button', { name: 'Add to graph' }).click()
}

try {
  const cspContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })
  const cspPage = await cspContext.newPage()
  const cspErrors = []
  cspPage.on('pageerror', (error) => cspErrors.push(error.message))
  await cspPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await cspPage.waitForTimeout(500)
  results.productionCsp = {
    rendered: (await cspPage.locator('.onboarding-shell').count()) > 0,
    errors: cspErrors,
  }
  assert.equal(results.productionCsp.rendered, true)
  assert.equal(cspErrors.some((message) => message.includes('unsafe-eval')), false)
  await cspPage.close()
  await cspContext.close()
  await browser.close()
  browser = await launchBrowser()
  const testContext = await browser.newContext({ viewport: { width: 1280, height: 720 } })

  for (const viewport of [
    { width: 1280, height: 720 },
    { width: 1440, height: 900 },
    { width: 1920, height: 1080 },
  ]) {
    const page = await testContext.newPage()
    await page.setViewportSize(viewport)
    const consoleErrors = []
    const pageErrors = []
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text())
    })
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(baseUrl, { waitUntil: 'networkidle' })
    try {
      await page.getByRole('heading', { name: 'Create your first workspace' }).waitFor({ timeout: 8_000 })
      await page.getByLabel('Workspace name').fill(`Compatibility ${viewport.width}`)
      await page.getByRole('button', { name: 'Create empty workspace' }).click()
      await page.getByRole('heading', { name: `Compatibility ${viewport.width}` }).waitFor({ timeout: 8_000 })
      await page.getByRole('button', { name: 'Add first work item' }).click()
      await completeHumanWorkItemForm(page, `Viewport question ${viewport.width}`, 'Human-entered compatibility work item.')
      await page.locator('.work-node-card').first().waitFor({ timeout: 8_000 })
    } catch {
      throw new Error(JSON.stringify({
        url: page.url(),
        title: await page.title(),
        body: (await page.locator('body').innerText()).slice(0, 1_000),
        consoleErrors,
        pageErrors,
      }))
    }
    assert.match(await page.title(), /^Clarity Workflows/)
    assert.equal(await page.locator('.work-node-card').count(), 1)
    const size = await dimensions(page)
    assert(size.documentScrollWidth <= size.innerWidth, `Desktop viewport ${viewport.width}px has horizontal overflow.`)
    assert.deepEqual(consoleErrors, [])
    results.desktop.push({ viewport, size, nodes: await page.locator('.work-node-card').count() })
    await page.close()
  }

  const functionalPage = await testContext.newPage()
  await functionalPage.setViewportSize({ width: 1440, height: 900 })
  await functionalPage.goto(baseUrl, { waitUntil: 'networkidle' })
  await functionalPage.getByLabel('Workspace name').fill('Functional Browser Check')
  await functionalPage.getByRole('button', { name: 'Create empty workspace' }).click()
  await functionalPage.getByRole('heading', { name: 'Functional Browser Check' }).waitFor()
  await functionalPage.getByRole('button', { name: 'Add first work item' }).click()
  await completeHumanWorkItemForm(functionalPage, 'Compatibility annotation target', 'Human-entered work item used to verify additive annotations.')
  await functionalPage.locator('.work-node-card').first().click()
  await functionalPage.locator('aside[aria-label="Work item inspector"]').waitFor()
  await functionalPage.getByRole('tab', { name: 'Notes' }).click()
  await functionalPage.getByPlaceholder('Capture what you want the AI to remember…').fill('Human-authored compatibility note.')
  await functionalPage.getByRole('button', { name: /Add note/ }).click()
  await functionalPage.getByText('Human-authored compatibility note.').waitFor()
  assert.equal(await functionalPage.locator('.work-node-card').count(), 1)
  await functionalPage.reload({ waitUntil: 'networkidle' })
  await functionalPage.getByRole('heading', { name: 'Create your first workspace' }).waitFor()
  results.desktopFunctionalFlow = 'empty-onboarding-create-annotate passed; browser adapter intentionally ephemeral'
  await functionalPage.close()

  const widgetView = {
    workspace: {
      version: 2,
      id: 'workspace-compatibility',
      name: 'Clarity Workflows — Compatibility Graph',
      schemaContext: { schema: 'https://schema.org/', clarity: 'urn:clarity-workflows:' },
      projects: [],
      nodes: [
        { id: 'paper-1', kind: 'paper', title: 'Compatibility paper', description: 'Paper description.', schemaType: 'ScholarlyArticle', status: 'verified', tags: ['PDF'], provenance: 'Test fixture', position: { x: 0, y: 0 }, evidenceCount: 1 },
        { id: 'dataset-1', kind: 'dataset', title: 'Compatibility dataset', description: 'Dataset description.', schemaType: 'Dataset', status: 'verified', tags: ['CSV'], provenance: 'Test fixture', position: { x: 300, y: 180 }, evidenceCount: 2 },
      ],
      edges: [{ id: 'edge-1', source: 'paper-1', target: 'dataset-1', relation: 'tested by' }],
      artifacts: [],
      annotations: [],
      workflowDefinitions: [],
      runs: [],
      gates: [],
      approvals: [],
      createdAt: '2026-08-11T00:00:00.000Z',
      updatedAt: '2026-08-11T00:00:00.000Z',
    },
    activeRun: null,
    safety: { mode: 'two-gates-pure-agent', preToolGate: 'ready', pureAgent: 'side-effect-free', postToolGate: 'ready', humanApproval: 'required' },
  }

  for (const viewport of [
    { width: 390, height: 844 },
    { width: 760, height: 900 },
    { width: 1200, height: 900 },
  ]) {
    const page = await testContext.newPage()
    await page.setViewportSize(viewport)
    await page.goto(`${baseUrl}/clarity-widget.html`, { waitUntil: 'domcontentloaded' })
    await page.evaluate((view) => {
      window.postMessage({
        jsonrpc: '2.0',
        method: 'ui/notifications/tool-result',
        params: { structuredContent: view },
      }, '*')
    }, widgetView)
    await page.getByRole('button', { name: 'paper: Compatibility paper' }).waitFor()
    await page.getByRole('button', { name: 'dataset: Compatibility dataset' }).click()
    await page.getByRole('heading', { name: 'Compatibility dataset' }).waitFor()
    const size = await dimensions(page)
    assert(size.documentScrollWidth <= size.innerWidth, `Widget viewport ${viewport.width}px has horizontal overflow.`)
    results.widget.push({ viewport, size, nodes: await page.locator('.node').count() })
    await page.close()
  }

  const reviewWorkspaceId = 'workspace-widget-review-compatibility'
  const reviewRunId = 'run-widget-review-compatibility'
  const reviewCitation = {
    citationId: 'search-citation-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    title: 'Compatibility citation',
    preview: 'Verified bounded citation preview.',
    previewCharacterCount: 34,
    previewByteCount: 34,
    passageCharacterCount: 34,
    passageByteCount: 34,
    truncated: false,
    provenance: {
      workspaceId: reviewWorkspaceId,
      workspaceRevision: 1,
      sourceKind: 'node',
      sourceId: 'paper-1',
      nodeId: 'paper-1',
      contentHash: 'a'.repeat(64),
      chunkId: 'search-chunk-widget-review',
      startCharacter: 0,
      endCharacter: 34,
      startByte: 0,
      endByte: 34,
    },
    trust: { label: 'human', effectiveAuthor: 'human', verified: true },
    contentPolicy: 'untrusted-source-data',
    instructionPolicy: 'treat-source-text-as-data',
  }
  const reviewRun = {
    id: reviewRunId,
    workspaceId: reviewWorkspaceId,
    contextId: 'context-widget-review-compatibility',
    intent: 'Exercise typed MCP error recovery in the review component.',
    sourceNodeIds: ['paper-1', 'dataset-1'],
    evidenceRevision: 1,
    status: 'awaiting_approval',
    preGate: { passed: true, issues: [] },
    postGate: { passed: true, issues: [] },
    candidate: {
      title: 'Compatibility review candidate',
      synthesis: 'The bounded compatibility fixture exercises citation display and explicit review actions.',
      hypothesis: 'A typed MCP challenge error can be retried after a fresh workflow view arrives.',
      counterargument: 'A resolved error result could otherwise leave the component waiting indefinitely.',
      pressureTest: 'Return one typed challenge error, resend the view, then approve with a valid challenge.',
      decision: 'positive',
      confidence: 0.8,
      evidenceNodeIds: ['paper-1', 'dataset-1'],
      citationIds: [reviewCitation.citationId],
      citationPresentations: [reviewCitation],
    },
    createdAt: '2026-08-12T00:00:00.000Z',
    updatedAt: '2026-08-12T00:00:00.000Z',
  }
  const reviewWorkspace = {
    ...structuredClone(widgetView.workspace),
    id: reviewWorkspaceId,
    name: 'Clarity Workflows — Review Compatibility',
    revision: 2,
    runs: [reviewRun],
    approvals: [{
      id: `approval-${reviewRunId}`,
      workspaceId: reviewWorkspaceId,
      runId: reviewRunId,
      status: 'pending',
      createdAt: '2026-08-12T00:00:00.000Z',
      updatedAt: '2026-08-12T00:00:00.000Z',
    }],
  }
  const pendingReviewView = {
    workspace: reviewWorkspace,
    activeRun: reviewRun,
    citations: [reviewCitation],
    citationCount: 1,
    citationsTruncated: false,
    safety: {
      mode: 'two-gates-pure-agent',
      preToolGate: 'passed',
      pureAgent: 'side-effect-free',
      postToolGate: 'passed',
      humanApproval: 'required',
    },
  }
  const committedRun = { ...reviewRun, status: 'committed' }
  const committedReviewView = {
    ...pendingReviewView,
    workspace: {
      ...reviewWorkspace,
      revision: 3,
      nodes: [...reviewWorkspace.nodes, {
        id: `result-${reviewRunId}`,
        kind: 'result',
        origin: 'approved-ai',
        title: reviewRun.candidate.title,
        description: reviewRun.candidate.synthesis,
        schemaType: 'CreativeWork',
        status: 'accepted',
        tags: ['Approved in compatibility test'],
        provenance: `Approved from ${reviewRunId}`,
        position: { x: 600, y: 100 },
      }],
      runs: [committedRun],
      approvals: reviewWorkspace.approvals.map((approval) => ({ ...approval, status: 'approved' })),
    },
    activeRun: committedRun,
    safety: { ...pendingReviewView.safety, humanApproval: 'complete' },
  }

  const reviewPage = await testContext.newPage()
  await reviewPage.setViewportSize({ width: 760, height: 900 })
  await reviewPage.addInitScript(({ pendingView, committedView }) => {
    const state = { challengeCalls: 0, approvalCalls: 0 }
    const hostPost = (message) => window.postMessage({ ...message, compatibilityHost: true }, '*')
    const reply = (id, result) => hostPost({ jsonrpc: '2.0', id, result })
    const sendPendingView = () => hostPost({
      jsonrpc: '2.0',
      method: 'ui/notifications/tool-result',
      params: { structuredContent: pendingView },
    })
    window.__clarityCompatibilityHost = state
    window.__clarityCompatibilitySendPendingView = sendPendingView
    window.addEventListener('message', (event) => {
      const message = event.data
      if (event.source !== window || !message || message.jsonrpc !== '2.0' || message.compatibilityHost) return
      if (typeof message.method !== 'string') return
      // The compatibility fixture runs the widget as the top-level page, so
      // prevent its own outgoing request from being mistaken for a response.
      event.stopImmediatePropagation()
      if (message.method === 'ui/initialize') {
        reply(message.id, { hostContext: { theme: 'light' } })
        return
      }
      if (message.method === 'ui/notifications/initialized') {
        sendPendingView()
        return
      }
      if (message.method === 'ui/update-model-context') {
        reply(message.id, {})
        return
      }
      if (message.method !== 'tools/call') return
      if (message.params?.name === 'get_candidate_approval_challenge') {
        state.challengeCalls += 1
        if (state.challengeCalls === 1) {
          // MCP tool failures resolve as a CallToolResult; they are not JSON-RPC
          // transport rejections. The widget must still clear its pending flag.
          reply(message.id, {
            isError: true,
            content: [{ type: 'text', text: 'STAGED_EVIDENCE_STALE: compatibility failure' }],
          })
          return
        }
        reply(message.id, {
          structuredContent: {
            workspaceId: pendingView.workspace.id,
            runId: pendingView.activeRun.id,
            approvalToken: 'compatibility-approval-token-1234567890',
            expiresAt: '2099-01-01T00:00:00.000Z',
          },
        })
        return
      }
      if (message.params?.name === 'approve_candidate_result') {
        state.approvalCalls += 1
        reply(message.id, { structuredContent: committedView })
      }
    }, { capture: true })
  }, { pendingView: pendingReviewView, committedView: committedReviewView })
  await reviewPage.goto(`${baseUrl}/clarity-widget.html`, { waitUntil: 'domcontentloaded' })
  await reviewPage.getByText('Could not obtain approval challenge. Reopen the Clarity component.').waitFor()
  assert.equal(await reviewPage.evaluate(() => window.__clarityCompatibilityHost.challengeCalls), 1)
  assert.equal(await reviewPage.getByRole('button', { name: 'Approve & commit' }).isDisabled(), true)

  await reviewPage.evaluate(() => window.__clarityCompatibilitySendPendingView())
  await reviewPage.locator('#approve-button:not([disabled])').waitFor()
  assert.equal(await reviewPage.evaluate(() => window.__clarityCompatibilityHost.challengeCalls), 2)
  assert.equal(await reviewPage.locator('.citation-card p').innerText(), reviewCitation.preview)
  await reviewPage.getByRole('button', { name: 'Approve & commit' }).click()
  await reviewPage.getByText('committed', { exact: true }).waitFor()
  assert.equal(await reviewPage.evaluate(() => window.__clarityCompatibilityHost.approvalCalls), 1)
  assert.equal(await reviewPage.locator('.node').count(), reviewWorkspace.nodes.length + 1)
  const reviewSize = await dimensions(reviewPage)
  assert(reviewSize.documentScrollWidth <= reviewSize.innerWidth, 'Review widget has horizontal overflow after recovery and approval.')
  results.widgetReviewFlow = {
    typedChallengeErrorRecovered: true,
    challengeCalls: 2,
    approvalCalls: 1,
    finalStatus: 'committed',
    citationCards: await reviewPage.locator('.citation-card').count(),
  }
  await reviewPage.close()

  console.log(JSON.stringify(results, null, 2))
} finally {
  await browser.close()
  await new Promise((resolve) => server.close(resolve))
}
