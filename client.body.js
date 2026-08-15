/**
 * Plan Graph — dynamic Cordis plugin, CLIENT half (plngr-2 / pkg-20).
 *
 * THIS IS THE EXPORTED SOURCE OF A DYNAMIC PLUGIN.
 * The live plugin is loaded through the harness's dynamic-plugin registry
 * (cordis_define code.client + cordis_run), NOT from this file. This file is a
 * faithful export of the running pkg-20 client code so another agent can edit
 * it; to apply changes, the edited file must be submitted as a new Package via
 * cordis_define (plugin.kind: existing, pluginId: plngr-2) and activated with
 * cordis_run mode: "update".
 *
 * The whole file body is the plain-JavaScript function body that returns a
 * Cordis Plugin ({ apply(ctx) { ... } }). No imports / TS / JSX allowed.
 *
 * --- Where the UI renders ---
 * The plugin registers one entry in the 'conversation.view' slot:
 *   id 'plan-graph', order 20, label "Plan 图" / "Plan Graph".
 * It appears as a tab in the session header ring of the Web GUI at
 * http://127.0.0.1:3080 and its body is the PlanGraphView component
 * (registered component receives the slot standard props: useSession,
 * sessionId, ...). The client half uses only: ctx.get('locale'/'slots'),
 * ctx.provide('chatNodeVisibility', ...), styles.insert(PG_CSS),
 * React.createElement, and guarded localStorage for two toggles.
 *
 * pkg-20 (current): removed the +/- zoom buttons (wheel zoom stays); added the
 * 【并入对话界面/返回tab页】 toggle. "并入对话界面" opens the real right
 * details column (ctx.layout.openDetails) and the graph renders there; the
 * center conversation column reflows automatically and the width is
 * drag-adjustable (native ui-layout grid). The plan-graph tab shows a
 * merged-screen while embedded. "返回tab页" closes the column and restores the
 * tab. The details occupant is registered ONLY while some session is embedded,
 * so the shipped tool-details panel keeps full fidelity otherwise. The chat
 * store's selection is mirrored from its persisted localStorage key so the
 * non-embedded details panel can still show tool details.
 *
 * --- Edit map (beautification entry points) ---
 * - NodeCard / PlanGraphView / GraphCanvas / DetailPanel: UI structure
 * - PG_CSS: all styles (theme tokens --dsw-alias-* + semantic colors)
 * - ZH_DICT / EN_DICT: i18n keys
 * - STATUS_COLORS / TYPE_GLYPHS: palette + badge letters
 * - projectSnapshot / buildTurnGraph / layoutGraph / layoutTurnGraph: data
 *   projection and layout (pure functions)
 */

const STATUS_COLORS = {
  active: '#3b82f6', waiting: '#f59e0b', completed: '#10b981',
  failed: '#ef4444', blocked: '#f97316', superseded: '#94a3b8', idle: '#64748b', input: '#3b82f6',
}

const TYPE_GLYPHS = {
  inspect: 'IN', run: 'RUN', wait_output: 'WAIT', verify: 'VER',
  assistant: 'AI', user: 'US', command: 'CMD', history: 'HIS', turn: 'T', unknown: '?',
}

const INSPECT_TOOLS = ['read', 'glob', 'grep', 'rg', 'web_search', 'web_fetch', 'search', 'list', 'glance', 'skill']
const VERIFY_TOOLS = ['verify', 'check', 'test', 'lint']
const WAIT_TOOLS = ['terminal', 'workflow-run', 'workflow']

function classifyTool(name) {
  if (!name) return 'unknown'
  if (INSPECT_TOOLS.indexOf(name) >= 0) return 'inspect'
  if (VERIFY_TOOLS.indexOf(name) >= 0) return 'verify'
  if (WAIT_TOOLS.indexOf(name) >= 0) return 'wait_output'
  return 'run'
}

function formatMs(ms) {
  if (ms == null) return '—'
  if (ms < 1000) return Math.round(ms) + ' ms'
  return (ms / 1000).toFixed(1) + ' s'
}

function formatSystemTime(ms) {
  if (ms == null || !Number.isFinite(ms)) return ''
  const d = new Date(ms)
  const h = String(d.getHours()).padStart(2, '0')
  const m = String(d.getMinutes()).padStart(2, '0')
  const s = String(d.getSeconds()).padStart(2, '0')
  return h + ':' + m + ':' + s
}

function seqOf(n) {
  return n.seq != null ? n.seq : (n.time != null ? n.time : 0)
}

function contentText(content) {
  if (!content) return ''
  const parts = []
  for (const b of content) {
    if (b && b.type === 'text' && typeof b.text === 'string' && b.text !== '') parts.push(b.text)
  }
  return parts.join('\n').slice(0, 2000)
}

function projectToolBlock(block) {
  const running = block.kind !== 'tool-result'
  const name = running ? block.name : (block.call ? block.call.name : null)
  const argsRaw = running ? block.argsRaw : (block.call ? block.call.argsRaw : null)
  const time = block.time
  const callTime = running ? block.time : (block.callTime != null ? block.callTime : block.time)
  const isError = running ? false : !!block.isError
  return {
    id: 'tool-' + block.callId,
    kind: 'tool',
    type: name ? classifyTool(name) : 'unknown',
    status: running ? 'active' : (isError ? 'failed' : 'completed'),
    title: name || block.callId,
    summary: argsRaw ? String(argsRaw).split('\n')[0].slice(0, 80) : '',
    args: argsRaw ? String(argsRaw).slice(0, 400) : '',
    output: running ? '' : contentText(block.content),
    toolName: name || '',
    callId: block.callId,
    seq: running ? null : block.seq,
    time,
    callTime,
    durationMs: running ? null : (time - callTime),
    isError,
    error: running ? null : (block.error || null),
    hasMeta: running ? false : (block.meta !== undefined && block.meta !== null),
    subCallCount: (block.subCalls || []).length,
    reasoning: '',
    parentId: null,
    turn: block.turn != null ? block.turn : null,
  }
}

function projectToolRecord(callId, name, argsRaw, result, running) {
  const settled = result !== undefined
  const inFlight = running !== undefined
  const status = settled
    ? (result.isError ? 'failed' : 'completed')
    : inFlight ? 'active' : 'blocked'
  const time = settled ? result.time : (running ? running.time : null)
  const callTime = settled
    ? (result.callTime != null ? result.callTime : null)
    : (running ? running.time : null)
  const subs = settled ? (result.subCalls || []) : (running ? (running.subCalls || []) : [])
  return {
    id: 'tool-' + callId,
    kind: 'tool',
    type: name ? classifyTool(name) : 'unknown',
    status,
    title: name || callId,
    summary: argsRaw ? String(argsRaw).split('\n')[0].slice(0, 80) : '',
    args: argsRaw ? String(argsRaw).slice(0, 400) : '',
    output: settled ? contentText(result.content) : '',
    toolName: name || '',
    callId,
    seq: settled ? result.seq : null,
    time,
    callTime,
    durationMs: settled && callTime != null ? (time - callTime) : null,
    isError: settled ? !!result.isError : false,
    error: settled ? (result.error || null) : null,
    hasMeta: settled ? (result.meta !== undefined && result.meta !== null) : false,
    subCallCount: subs.length,
    reasoning: '',
    parentId: null,
    turn: running ? (running.turn != null ? running.turn : null) : null,
  }
}

function projectAssistant(n) {
  const textParts = []
  const reasoningParts = []
  for (const b of (n.blocks || [])) {
    if (b.kind === 'text' && b.text !== '') textParts.push(b.text)
    if (b.kind === 'reasoning' && b.text !== '') reasoningParts.push(b.text)
  }
  const text = textParts.join('\n\n')
  const reasoning = reasoningParts.join('\n\n').slice(0, 2000)
  return {
    id: 'assistant-' + n.seq,
    kind: 'assistant',
    type: 'assistant',
    status: n.interrupted ? 'superseded' : 'completed',
    title: 'Assistant',
    summary: text ? text.split('\n')[0].slice(0, 80) : (reasoning ? '[thinking]' : ''),
    args: '', output: text.slice(0, 2000), toolName: '', callId: '',
    seq: n.seq, time: n.time, callTime: null, durationMs: null,
    isError: false, error: null, hasMeta: false, subCallCount: 0,
    reasoning, parentId: null, turn: n.turn != null ? n.turn : null,
  }
}

function projectPartial(p) {
  const textParts = []
  const reasoningParts = []
  for (const b of (p.blocks || [])) {
    if (b.kind === 'text' && b.text !== '') textParts.push(b.text)
    if (b.kind === 'reasoning' && b.text !== '') reasoningParts.push(b.text)
  }
  const text = textParts.join('\n\n')
  const reasoning = reasoningParts.join('\n\n').slice(0, 2000)
  return {
    id: 'assistant-partial',
    kind: 'assistant',
    type: 'assistant',
    status: 'active',
    title: 'Assistant',
    summary: text ? text.split('\n')[0].slice(0, 80) : (reasoning ? '[thinking]' : ''),
    args: '', output: text.slice(0, 2000), toolName: '', callId: '',
    seq: null, time: null, callTime: null, durationMs: null,
    isError: false, error: null, hasMeta: false, subCallCount: 0,
    reasoning, parentId: null, turn: p.turn != null ? p.turn : null,
  }
}

function baseNode(kind, type, status, title, seq, time, summary, turn) {
  return {
    id: kind + '-' + seq, kind, type, status, title,
    summary: summary || '', args: '', output: '', toolName: '', callId: '',
    seq, time, callTime: null, durationMs: null,
    isError: false, error: null, hasMeta: false, subCallCount: 0,
    reasoning: '', parentId: null, turn: turn != null ? turn : null,
  }
}

function projectInput(n, kind, type, status, title) {
  const node = baseNode(kind, type, status, title, n.seq, n.time, '', n.turn)
  node.output = contentText(n.content)
  return node
}

function projectSimple(n, kind, type, status, title) {
  return baseNode(kind, type, status, title, n.seq, n.time, '', n.turn)
}

function projectCommand(n) {
  const running = n.outcome === null
  const failed = !running && n.outcome.kind === 'error'
  return Object.assign(baseNode('cmd', 'command', running ? 'active' : (failed ? 'failed' : 'completed'), n.name || 'Command', n.seq, n.time, n.args ? String(n.args).slice(0, 80) : '', n.turn), {
    args: n.args ? String(n.args).slice(0, 400) : '',
  })
}

function expandSubCalls(block, parentId, parentTurn, list, edges, hideTools) {
  const subs = block.subCalls || []
  let prev = null
  for (const sub of subs) {
    if (hideTools) continue
    const child = projectToolBlock(sub)
    child.parentId = parentId
    if (parentTurn != null) child.turn = parentTurn
    list.push(child)
    edges.push({ from: parentId, to: child.id, kind: 'subcall' })
    if (prev) edges.push({ from: prev, to: child.id, kind: 'normal' })
    prev = child.id
    expandSubCalls(sub, child.id, parentTurn, list, edges, hideTools)
  }
}

function assignTurns(list, snapshot) {
  const callTurn = new Map()
  for (const n of (snapshot.nodes || [])) {
    if (n.kind !== 'assistant') continue
    for (const b of (n.blocks || [])) if (b.kind === 'tool-call') callTurn.set(b.callId, n.turn)
  }
  for (const rc of (snapshot.runningCalls || [])) callTurn.set(rc.callId, rc.turn)
  const len = list.length
  const following = new Array(len).fill(null)
  let next = null
  for (let i = len - 1; i >= 0; i--) {
    const node = list[i]
    if (node.kind === 'assistant' && node.turn != null) next = node.turn
    following[i] = next
  }
  let lastAssistant = null
  for (let i = 0; i < len; i++) {
    const node = list[i]
    if (node.turn == null) {
      if (node.kind === 'tool') node.turn = callTurn.get(node.callId) ?? null
      if (node.turn == null) node.turn = following[i] ?? (lastAssistant != null ? lastAssistant + 1 : 1)
    }
    if (node.kind === 'assistant' && node.turn != null) lastAssistant = node.turn
  }
  // subcall children group with their parent's turn (trajectory: same step)
  for (const node of list) {
    if (!node.parentId || node.turn == null) continue
    const parent = list.find((n) => n.id === node.parentId)
    if (parent && parent.turn != null) node.turn = parent.turn
  }
}

function projectSnapshot(snapshot, hideTools) {
  if (!snapshot) return { nodes: [], edges: [] }
  const nodes = snapshot.nodes || []
  const resultByCall = new Map()
  for (const n of nodes) if (n.kind === 'tool-result') resultByCall.set(n.callId, n)
  const runningById = new Map()
  for (const rc of (snapshot.runningCalls || [])) runningById.set(rc.callId, rc)
  const list = []
  const edges = []
  const topIds = []
  const pushTop = (node) => { list.push(node); topIds.push(node.id) }
  const seenIds = new Set()

  const emitTool = (callId, name, argsRaw, block, turn) => {
    if (hideTools) return
    if (callId == null || seenIds.has(callId)) return
    seenIds.add(callId)
    const result = resultByCall.get(callId)
    const running = runningById.get(callId)
    const root = projectToolRecord(callId, name, argsRaw, result, running)
    if (turn != null) root.turn = turn
    pushTop(root)
    const subs = block ? (block.subCalls || []) : []
    if (subs.length) expandSubCalls(block, root.id, root.turn, list, edges, hideTools)
  }

  for (const n of nodes) {
    if (n.kind === 'assistant') {
      pushTop(projectAssistant(n))
      for (const b of (n.blocks || [])) {
        if (b.kind !== 'tool-call') continue
        emitTool(b.callId, b.name, b.argsRaw, resultByCall.get(b.callId) || runningById.get(b.callId), n.turn)
      }
    } else if (n.kind === 'user') {
      pushTop(projectInput(n, 'user', 'user', 'input', 'User'))
    } else if (n.kind === 'steering') {
      pushTop(projectInput(n, 'user', 'user', 'input', 'Steering'))
    } else if (n.kind === 'context') {
      pushTop(projectInput(n, 'context', 'unknown', 'completed', 'Context'))
    } else if (n.kind === 'command') {
      pushTop(projectCommand(n))
    } else if (n.kind === 'compaction') {
      pushTop(baseNode('hist', 'history', 'completed', 'Compaction', n.seq, n.time, n.summary || '', n.turn))
    } else if (n.kind === 'model-retry') {
      // dropped: trajectory folds retries into the owning assistant request
      continue
    } else if (n.kind === 'turn-error') {
      pushTop(Object.assign(baseNode('err', 'unknown', 'failed', 'Turn Error', n.seq, n.time, n.message || '', n.turn), { isError: true }))
    } else if (n.kind === 'turn-max-tokens') {
      pushTop(projectSimple(n, 'max', 'unknown', 'blocked', 'Turn Max Tokens'))
    } else if (n.kind === 'tool-result') {
      // standalone: the owning assistant is outside the window, or the call
      // was never emitted by an in-window assistant
      emitTool(n.callId, n.call ? n.call.name : null, n.call ? n.call.argsRaw : '', n, null)
    } else {
      pushTop(projectSimple(n, 'unknown', 'unknown', 'idle', 'Unknown'))
    }
  }

  // in-flight partial assistant (streaming): appended after finalized nodes,
  // exactly like trajectory's appendTrajectoryPartialLayout
  if (snapshot.partial) {
    const p = snapshot.partial
    pushTop(projectPartial(p))
    for (const b of (p.blocks || [])) {
      if (b.kind !== 'tool-call') continue
      emitTool(b.callId, b.name, b.argsRaw, resultByCall.get(b.callId) || runningById.get(b.callId), p.turn)
    }
  }

  // running calls not already emitted through assistant/partial blocks
  for (const rc of ((snapshot.runningCalls || []).slice().sort((a, b) => a.time - b.time))) {
    if (seenIds.has(rc.callId)) continue
    emitTool(rc.callId, rc.name, rc.argsRaw, rc, rc.turn)
  }

  for (let i = 1; i < topIds.length; i++) {
    edges.push({ from: topIds[i - 1], to: topIds[i], kind: 'normal' })
  }
  assignTurns(list, snapshot)
  return { nodes: list, edges }
}

function buildTurnGraph(projected, expandedTurns) {
  const { nodes, edges } = projected
  const groups = new Map()
  for (const n of nodes) {
    const t = n.turn ?? 0
    if (!groups.has(t)) groups.set(t, [])
    groups.get(t).push(n)
  }
  const turnNumbers = [...groups.keys()].sort((a, b) => {
    const sa = Math.min(...groups.get(a).map(seqOf))
    const sb = Math.min(...groups.get(b).map(seqOf))
    return sa - sb || a - b
  })
  let ordered = turnNumbers
  if (ordered.indexOf(0) >= 0) {
    if (ordered.length > 1) {
      const target = ordered.find((t) => t !== 0)
      groups.get(target).unshift(...groups.get(0))
      groups.delete(0)
      ordered = ordered.filter((t) => t !== 0)
    } else {
      groups.set(1, groups.get(0))
      groups.delete(0)
      ordered = [1]
    }
  }
  const sortMembers = (t) => groups.get(t).slice().sort((a, b) => seqOf(a) - seqOf(b))
  const clusters = new Map()
  const outNodes = []
  for (const t of ordered) {
    const members = sortMembers(t)
    let failed = 0, active = 0
    for (const m of members) {
      if (m.status === 'failed') failed++
      if (m.status === 'active' || m.status === 'waiting') active++
    }
    const cluster = {
      id: 'turn-' + t, kind: 'turn', type: 'turn',
      status: failed > 0 ? 'failed' : (active > 0 ? 'active' : 'completed'),
      title: '', summary: '', args: '', output: '', toolName: '', callId: '',
      seq: members.length ? seqOf(members[0]) : null, time: members.length ? members[0].time : null,
      callTime: null, durationMs: null, isError: failed > 0, error: null, hasMeta: false,
      subCallCount: 0, reasoning: '', parentId: null, turn: t,
      turnNumber: t, memberCount: members.length, failedCount: failed, activeCount: active,
      memberIds: members.map((m) => m.id),
      w: 190, h: 54, x: 0, y: 0,
    }
    clusters.set(t, cluster)
    outNodes.push(cluster)
  }
  const outEdges = []
  for (let i = 0; i < ordered.length; i++) {
    const turn = ordered[i]
    const cluster = clusters.get(turn)
    if (i > 0) {
      outEdges.push({ from: clusters.get(ordered[i - 1]).id, to: cluster.id, kind: 'normal' })
    }
    const expanded = expandedTurns.has(cluster.id)
    const members = sortMembers(turn)
    if (expanded && members.length) {
      const mset = new Set(members.map((m) => m.id))
      outNodes.push(...members)
      outEdges.push({ from: cluster.id, to: members[0].id, kind: 'normal' })
      for (let j = 1; j < members.length; j++) {
        outEdges.push({ from: members[j - 1].id, to: members[j].id, kind: 'normal' })
      }
      for (const e of edges) {
        if (e.kind === 'subcall' && mset.has(e.from) && mset.has(e.to)) outEdges.push(e)
      }
    }
  }
  return { nodes: outNodes, edges: outEdges }
}

function layoutTurnGraph(graph) {
  const LEFT = 40, TOP = 40, GAP = 50, HGAP = 40
  const CW = 190, CH = 54, MW = 210, MH = 76
  const byId = new Map(graph.nodes.map((n) => [n.id, n]))
  let y = TOP
  let maxX = 0
  for (const n of graph.nodes) {
    if (n.type !== 'turn') continue
    const members = (n.memberIds || []).map((id) => byId.get(id)).filter(Boolean)
    const bandH = members.length ? MH : CH
    n.x = LEFT
    n.y = y + Math.round((bandH - CH) / 2)
    let x = LEFT + CW + HGAP
    for (const m of members) {
      m.w = MW; m.h = MH
      m.x = x
      m.y = y
      x += MW + 20
    }
    maxX = Math.max(maxX, x - 20)
    y += bandH + GAP
  }
  return { nodes: graph.nodes, edges: graph.edges, width: maxX + LEFT, height: y }
}

function layoutGraph(graph) {
  const nodes = graph.nodes
  if (!nodes.length) return { nodes, edges: graph.edges, width: 0, height: 0 }
  const edges = graph.edges
  const adj = new Map()
  for (const n of nodes) adj.set(n.id, [])
  for (const e of edges) {
    const a = adj.get(e.from)
    if (a) a.push(e.to)
  }
  const depth = new Map()
  const queue = [nodes[0].id]
  depth.set(nodes[0].id, 0)
  while (queue.length) {
    const id = queue.shift()
    const d = depth.get(id)
    for (const to of (adj.get(id) || [])) {
      if (!depth.has(to)) { depth.set(to, d + 1); queue.push(to) }
    }
  }
  for (const n of nodes) if (!depth.has(n.id)) depth.set(n.id, 0)
  const layers = new Map()
  for (const n of nodes) {
    const d = depth.get(n.id)
    if (!layers.has(d)) layers.set(d, [])
    layers.get(d).push(n)
  }
  const W = 210, H = 76, GX = 40, GY = 40
  let maxX = 0, maxY = 0
  for (const entry of layers) {
    const d = entry[0]
    const layer = entry[1]
    layer.forEach((n, i) => {
      n.w = W; n.h = H
      n.x = GX + i * (W + 30)
      n.y = GY + d * (H + 50)
      maxX = Math.max(maxX, n.x + W)
      maxY = Math.max(maxY, n.y + H)
    })
  }
  return { nodes, edges, width: maxX + GX, height: maxY + GY }
}

function edgePath(e, byId) {
  const a = byId.get(e.from)
  const b = byId.get(e.to)
  if (!a || !b) return null
  const aw = a.w || 210, ah = a.h || 76
  const bw = b.w || 210, bh = b.h || 76
  const axc = a.x + aw / 2, ayc = a.y + ah / 2
  const bxc = b.x + bw / 2, byc = b.y + bh / 2
  const dx = bxc - axc
  const dy = byc - ayc
  if (Math.abs(dy) >= Math.abs(dx)) {
    const sx = axc, sy = a.y + ah
    const tx = bxc, ty = b.y
    const my = (sy + ty) / 2
    return 'M ' + sx + ' ' + sy + ' C ' + sx + ' ' + my + ', ' + tx + ' ' + my + ', ' + tx + ' ' + ty
  }
  const sx = a.x + aw, sy = ayc
  const tx = b.x, ty = byc
  const mx = (sx + tx) / 2
  return 'M ' + sx + ' ' + sy + ' C ' + mx + ' ' + sy + ', ' + mx + ' ' + ty + ', ' + tx + ' ' + ty
}

function turnSummary(node, t) {
  const parts = []
  parts.push(t('turn.members').replace('{n}', String(node.memberCount || 0)))
  if (node.failedCount) parts.push(t('turn.failed').replace('{n}', String(node.failedCount)))
  if (node.activeCount) parts.push(t('turn.active').replace('{n}', String(node.activeCount)))
  return parts.join(' · ')
}

function nodeTitle(node, t) {
  if (node.type === 'turn') return t('turn.title').replace('{n}', String(node.turnNumber))
  if (node.kind === 'context') return t('node.context')
  return node.title
}

function NodeCard(props) {
  const node = props.node
  const t = props.t
  const isTurn = node.type === 'turn'
  const isContext = node.kind === 'context'
  let accent = STATUS_COLORS[node.status] || STATUS_COLORS.idle
  if (node.type === 'assistant') accent = '#8b5cf6'
  else if (node.type === 'user') accent = '#3b82f6'
  else if (node.kind === 'tool') accent = '#64748b'
  else if (isContext) accent = '#10b981'
  const cls = ['pg-node']
  if (isTurn) cls.push('pg-node-turn')
  if (node.type === 'assistant') cls.push('pg-node-assistant')
  else if (node.type === 'user') cls.push('pg-node-user')
  else if (node.kind === 'tool') {
    cls.push('pg-node-tool')
  } else if (isContext) {
    cls.push('pg-node-context')
  }
  if (props.selected) cls.push('pg-node-selected')
  const glyph = isContext ? 'CTX' : (TYPE_GLYPHS[node.type] || '?')
  const title = nodeTitle(node, t)
  const summary = isTurn ? turnSummary(node, t) : (node.summary || '—')
  const footer = isTurn
    ? t('type.turn') + ' · ' + String(node.memberCount || 0)
    : isContext
      ? t('type.context') + ' · ' + (node.seq != null ? '#' + node.seq : node.kind)
      : t('type.' + node.type) + ' · ' + (node.seq != null ? '#' + node.seq : (node.callId ? node.callId.slice(0, 8) : node.kind))
  const timeLabel = formatSystemTime(node.time)
  const children = [
    React.createElement('div', { className: 'pg-node-head' },
      React.createElement('span', { className: 'pg-node-glyph' }, glyph),
      React.createElement('span', { className: 'pg-node-title' }, title),
      React.createElement('span', { className: 'pg-node-status' },
        React.createElement('span', { className: 'pg-node-status-dot' }),
        t('status.' + node.status)),
    ),
    React.createElement('div', { className: 'pg-node-summary' }, summary),
    React.createElement('div', { className: 'pg-node-foot' },
      React.createElement('span', { className: 'pg-node-foot-label' }, footer),
      timeLabel ? React.createElement('span', { className: 'pg-node-time' }, timeLabel) : null,
    ),
  ]
  const common = {
    xmlns: 'http://www.w3.org/1999/xhtml',
    className: cls.join(' '),
    style: { '--pg-color': accent },
    onClick: (e) => { e.stopPropagation(); props.onSelect(node.id) },
  }
  return React.createElement('div', common, ...children)
}

const GraphCanvas = React.forwardRef(function GraphCanvas(props, ref) {
  const graph = props.graph
  const byId = new Map()
  for (const n of graph.nodes) byId.set(n.id, n)
  React.useEffect(() => {
    const el = ref.current
    if (!el) return
    const handler = (e) => {
      e.preventDefault()
      e.stopPropagation()
      const rect = el.getBoundingClientRect()
      const cx = e.clientX - rect.left
      const cy = e.clientY - rect.top
      const factor = e.deltaY < 0 ? 1.1 : 0.9
      props.onView((v) => {
        const scale = Math.min(3, Math.max(0.2, v.scale * factor))
        // keep the graph point under the cursor fixed while zooming
        const wx = (cx - v.x) / v.scale
        const wy = (cy - v.y) / v.scale
        return { scale, x: cx - wx * scale, y: cy - wy * scale }
      })
    }
    el.addEventListener('wheel', handler, { passive: false })
    return () => el.removeEventListener('wheel', handler)
  }, [])
  const dragRef = React.useRef(null)
  const onMouseDown = (e) => { dragRef.current = { x: e.clientX, y: e.clientY, vx: props.view.x, vy: props.view.y } }
  const onMouseMove = (e) => {
    const d = dragRef.current
    if (!d) return
    props.onView({ x: d.vx + (e.clientX - d.x), y: d.vy + (e.clientY - d.y), scale: props.view.scale })
  }
  const onMouseUp = () => { dragRef.current = null }
  const gridSize = 24 * props.view.scale
  const gridStyle = {
    backgroundSize: gridSize + 'px ' + gridSize + 'px',
    backgroundPosition: props.view.x + 'px ' + props.view.y + 'px',
  }
  return React.createElement('div', { ref, className: 'pg-canvas', style: gridStyle, onMouseDown, onMouseMove, onMouseUp, onMouseLeave: onMouseUp },
    React.createElement('svg', { width: '100%', height: '100%', className: 'pg-svg' },
      React.createElement('defs', null,
        React.createElement('marker', { id: 'pg-arrow', markerWidth: '8', markerHeight: '8', refX: '7', refY: '4', orient: 'auto' },
          React.createElement('path', { d: 'M0,0 L8,4 L0,8 z', fill: '#64748b' }))),
      React.createElement('g', { transform: 'translate(' + props.view.x + ',' + props.view.y + ') scale(' + props.view.scale + ')' },
        graph.edges.map((e) => {
          const d = edgePath(e, byId)
          if (!d) return null
          return React.createElement('path', {
            key: e.from + '>' + e.to,
            d,
            className: 'pg-edge' + (e.kind === 'subcall' ? ' pg-edge-subcall' : ''),
            markerEnd: 'url(#pg-arrow)',
          })
        }),
        graph.nodes.map((n) => React.createElement('foreignObject', {
          key: n.id, x: n.x, y: n.y, width: n.w || 210, height: n.h || 76,
        },
          React.createElement(NodeCard, { node: n, selected: n.id === props.selectedId, t: props.t, onSelect: props.onSelect }),
        )),
      ),
    ),
  )
})

function DetailPanel(props) {
  const node = props.node
  const t = props.t
  if (!node) return null
  const isTool = node.kind === 'tool'
  const isAssistant = node.kind === 'assistant'
  const isUserLike = node.kind === 'user' || node.kind === 'context'
  const typeLabel = node.kind === 'context' ? t('type.context') : t('type.' + node.type)
  const error = node.status === 'failed' || node.status === 'blocked'
  const rows = [[t('detail.status'), t('status.' + node.status), error]]
  if (isTool && node.durationMs != null) {
    rows.push([t('detail.duration'), formatMs(node.durationMs), false])
  }
  const sections = []
  if (isTool) {
    sections.push([t('detail.payload'), node.args || '—'])
    sections.push([t('detail.result'), node.error
      ? ((node.error.name || '') + (node.error.code ? ' (' + node.error.code + ')' : ''))
      : (node.output || '—')])
  } else if (isAssistant) {
    if (node.reasoning) sections.push([t('detail.thinking'), node.reasoning])
    sections.push([t('detail.output'), node.output || (node.summary || '—')])
  } else if (isUserLike) {
    sections.push([t('detail.content'), node.output || '—'])
  }
  return React.createElement('aside', { className: 'pg-detail' },
    React.createElement('h3', null,
      React.createElement('span', null, typeLabel),
      React.createElement('span', { className: 'pg-detail-title' }, nodeTitle(node, t)),
      React.createElement('button', { className: 'pg-close', onClick: props.onClose }, '×')),
    React.createElement('dl', { className: 'pg-kv' },
      rows.map((row) => React.createElement(React.Fragment, { key: row[0] },
        React.createElement('dt', null, row[0]),
        React.createElement('dd', { className: row[2] ? 'pg-error' : undefined }, row[1])))),
    sections.map((section) => React.createElement('div', { className: 'pg-block', key: section[0] },
      React.createElement('h4', null, section[0]),
      React.createElement('pre', { className: 'pg-pre' }, section[1]))),
  )
}

function VerticalScrollbar(props) {
  const trackRef = React.useRef(null)
  const dragRef = React.useRef(null)
  const trackHeight = Math.max(0, props.viewportHeight - 16)
  const scrollable = props.maxScroll > 0 && trackHeight > 0
  const thumbHeight = scrollable
    ? Math.max(28, Math.min(trackHeight, trackHeight * props.viewportHeight / props.contentHeight))
    : trackHeight
  const travel = Math.max(0, trackHeight - thumbHeight)
  const thumbTop = scrollable ? (props.scroll / props.maxScroll) * travel : 0
  const scrollFromThumbTop = (top) => {
    if (!scrollable || travel <= 0) return
    props.onScroll(Math.max(0, Math.min(props.maxScroll, top / travel * props.maxScroll)))
  }
  const onTrackPointerDown = (e) => {
    if (!scrollable || !trackRef.current) return
    e.stopPropagation()
    const rect = trackRef.current.getBoundingClientRect()
    scrollFromThumbTop(e.clientY - rect.top - thumbHeight / 2)
  }
  const onThumbPointerDown = (e) => {
    if (!scrollable) return
    e.stopPropagation()
    e.currentTarget.setPointerCapture(e.pointerId)
    dragRef.current = { pointerId: e.pointerId, y: e.clientY, top: thumbTop }
  }
  const onThumbPointerMove = (e) => {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return
    e.stopPropagation()
    scrollFromThumbTop(drag.top + e.clientY - drag.y)
  }
  const onThumbPointerUp = (e) => {
    if (!dragRef.current || dragRef.current.pointerId !== e.pointerId) return
    e.stopPropagation()
    dragRef.current = null
    e.currentTarget.releasePointerCapture(e.pointerId)
  }
  return React.createElement('div', {
    ref: trackRef,
    className: 'pg-scrollbar' + (scrollable ? '' : ' pg-scrollbar-disabled'),
    role: 'scrollbar',
    'aria-label': props.label,
    'aria-orientation': 'vertical',
    'aria-valuemin': 0,
    'aria-valuemax': Math.round(props.maxScroll),
    'aria-valuenow': Math.round(props.scroll),
    onPointerDown: onTrackPointerDown,
  }, React.createElement('div', {
    className: 'pg-scrollbar-thumb',
    style: { height: thumbHeight + 'px', transform: 'translateY(' + thumbTop + 'px)' },
    onPointerDown: onThumbPointerDown,
    onPointerMove: onThumbPointerMove,
    onPointerUp: onThumbPointerUp,
    onPointerCancel: onThumbPointerUp,
  }))
}

function PlanGraphView(props) {
  const useSession = props.useSession
  const toggleStore = props.toggleStore
  const turnStore = props.turnStore
  const t = props.t
  const embedded = !!props.embedded
  const sidebar = !!props.sidebar
  const onEmbedToggle = props.onEmbedToggle
  const snapshot = useSession((s) => s)
  const [hideTools, setHideTools] = React.useState(() => toggleStore.get())
  const [groupByTurn, setGroupByTurn] = React.useState(() => turnStore.get())
  const [expandedTurns, setExpandedTurns] = React.useState(() => new Set())
  const [selectedId, setSelectedId] = React.useState(null)
  const [view, setView] = React.useState({ x: 24, y: 24, scale: 1 })
  const [viewportHeight, setViewportHeight] = React.useState(700)
  const canvasRef = React.useRef(null)
  React.useEffect(() => toggleStore.subscribe(() => setHideTools(toggleStore.get())), [])
  React.useEffect(() => turnStore.subscribe(() => setGroupByTurn(turnStore.get())), [])
  const graph = React.useMemo(() => {
    const projected = projectSnapshot(snapshot, hideTools)
    if (!groupByTurn) return layoutGraph(projected)
    return layoutTurnGraph(buildTurnGraph(projected, expandedTurns))
  }, [snapshot, hideTools, groupByTurn, expandedTurns])
  React.useEffect(() => {
    const el = canvasRef.current
    if (!el) return
    const update = () => setViewportHeight(el.clientHeight || 700)
    update()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(update)
    observer.observe(el)
    return () => observer.disconnect()
  }, [graph])
  const selected = selectedId ? (graph.nodes.find((n) => n.id === selectedId) || null) : null
  const locateLatest = () => {
    const el = canvasRef.current
    if (!el || !graph.nodes.length) return
    let latest = graph.nodes[0]
    for (let i = 1; i < graph.nodes.length; i++) {
      const candidate = graph.nodes[i]
      if (seqOf(candidate) >= seqOf(latest)) latest = candidate
    }
    const cw = el.clientWidth || 1200
    const ch = el.clientHeight || 700
    setView((current) => ({
      scale: current.scale,
      x: cw / 2 - (latest.x + (latest.w || 210) / 2) * current.scale,
      y: ch / 2 - (latest.y + (latest.h || 76) / 2) * current.scale,
    }))
  }
  const applyGroupByTurn = (v) => {
    turnStore.set(v)
    if (!v) setExpandedTurns(new Set())
  }
  const handleNodeClick = (id) => {
    const node = graph.nodes.find((n) => n.id === id)
    if (node && node.type === 'turn') {
      setExpandedTurns((prev) => {
        const next = new Set(prev)
        if (next.has(id)) next.delete(id)
        else next.add(id)
        return next
      })
    } else {
      setSelectedId(id)
    }
  }
  const turnCount = groupByTurn ? graph.nodes.filter((n) => n.type === 'turn').length : 0
  const contentHeight = graph.height * view.scale
  const maxScrollY = Math.max(0, contentHeight - viewportHeight)
  const scrollY = Math.min(maxScrollY, Math.max(0, -view.y))
  const canvasArea = graph.nodes.length === 0
    ? React.createElement('div', { className: 'pg-empty' },
        React.createElement('div', null, t('empty.title')),
        React.createElement('div', null, t('empty.hint')))
    : React.createElement('div', { className: 'pg-canvas-wrap' },
        React.createElement(GraphCanvas, { ref: canvasRef, graph, view, onView: setView, selectedId, onSelect: handleNodeClick, t }),
        React.createElement(VerticalScrollbar, {
          viewportHeight,
          contentHeight,
          maxScroll: maxScrollY,
          scroll: scrollY,
          onScroll: (next) => setView((v) => ({ ...v, y: -next })),
          label: t('toolbar.scroll'),
        }),
      )
  const embedLabel = embedded ? t('embed.return') : t('embed.merge')
  return React.createElement('div', { className: 'pg-root' + (sidebar ? ' pg-root-embedded' : '') },
    React.createElement('div', { className: 'pg-toolbar' },
      React.createElement('span', { className: 'pg-title' }, t('view.planGraph')),
      React.createElement('button', { className: 'pg-btn' + (hideTools ? ' pg-btn-on' : ''), title: t('toolbar.hideTools'), onClick: () => toggleStore.set(!hideTools) },
        (hideTools ? '✓ ' : '') + t('toolbar.hideTools')),
      React.createElement('button', { className: 'pg-btn' + (groupByTurn ? ' pg-btn-on' : ''), title: t('toolbar.groupTurns'), onClick: () => applyGroupByTurn(!groupByTurn) },
        (groupByTurn ? '✓ ' : '') + t('toolbar.groupTurns')),
      React.createElement('button', { className: 'pg-btn', onClick: locateLatest }, t('toolbar.latest')),
      React.createElement('button', { className: 'pg-btn pg-btn-embed' + (embedded ? ' pg-btn-on' : ''), title: embedLabel, onClick: () => onEmbedToggle(!embedded) }, embedLabel),
      React.createElement('span', { className: 'pg-count' },
        groupByTurn
          ? t('toolbar.turns').replace('{n}', String(turnCount))
          : String(graph.nodes.length) + ' ' + t('toolbar.nodes')),
    ),
    React.createElement('div', { className: 'pg-body' },
      canvasArea,
      React.createElement(DetailPanel, { node: selected, t, onClose: () => setSelectedId(null) }),
    ),
  )
}

function prettyJson(raw) {
  try { return JSON.stringify(JSON.parse(raw), null, 2) } catch (e) { return raw }
}

function toolMaterial(snapshot, callId) {
  if (!snapshot) return null
  for (const n of (snapshot.nodes || [])) {
    if (n.kind === 'tool-result' && n.callId === callId) {
      return {
        settled: true,
        name: n.call ? n.call.name : null,
        argsRaw: n.call ? n.call.argsRaw : null,
        isError: !!n.isError,
        error: n.error || null,
        output: contentText(n.content),
      }
    }
  }
  for (const rc of (snapshot.runningCalls || [])) {
    if (rc.callId === callId) {
      return { settled: false, name: rc.name, argsRaw: rc.argsRaw, isError: false, error: null, output: '' }
    }
  }
  return null
}

/** Replica of the shipped details-panel body for one selected tool call. */
function ToolDetailsView(props) {
  const t = props.t
  const callId = props.selection ? props.selection.callId : null
  const material = callId ? toolMaterial(props.snapshot, callId) : null
  const title = material && material.name
    ? material.name
    : (props.selection && props.selection.toolName ? props.selection.toolName : callId)
  const body = material === null
    ? React.createElement('div', { className: 'pg-detail-empty' }, t('detail.notInWindow'))
    : React.createElement(React.Fragment, null,
        material.argsRaw ? React.createElement('div', { className: 'pg-block' },
          React.createElement('h4', null, t('detail.payload')),
          React.createElement('pre', { className: 'pg-pre' }, prettyJson(material.argsRaw))) : null,
        React.createElement('div', { className: 'pg-block' },
          React.createElement('h4', null, t('detail.output')),
          !material.settled
            ? React.createElement('pre', { className: 'pg-pre' }, t('detail.toolRunning'))
            : material.isError
              ? React.createElement('pre', { className: 'pg-pre pg-error' },
                  (material.error && (material.error.name || ''))
                  + (material.error && material.error.code ? ' (' + material.error.code + ')' : ''))
              : React.createElement('pre', { className: 'pg-pre' }, material.output || '—')))
  return React.createElement('aside', { className: 'pg-detail pg-detail-column' },
    React.createElement('h3', null,
      React.createElement('span', null, title || ''),
      React.createElement('button', { className: 'pg-close', 'aria-label': t('detail.close'), onClick: props.onClose }, '×')),
    body,
  )
}

/** Shipped-equivalent empty state for the right details column. */
function DetailsEmpty(props) {
  const t = props.t
  return React.createElement('aside', { className: 'pg-detail pg-detail-column' },
    React.createElement('h3', null,
      React.createElement('span', null, t('detail.title')),
      React.createElement('button', { className: 'pg-close', 'aria-label': t('detail.close'), onClick: props.onClose }, '×')),
    React.createElement('div', { className: 'pg-detail-empty' }, t('detail.selectHint')),
  )
}

/** Tab body while the graph is merged into the conversation sidebar. */
function MergedScreen(props) {
  const t = props.t
  return React.createElement('div', { className: 'pg-merged' },
    React.createElement('h2', null, t('embed.mergedTitle')),
    React.createElement('p', null, t('embed.mergedHint')),
    React.createElement('button', { className: 'pg-btn', onClick: props.onReturn }, t('embed.return')),
  )
}

/** The 'plan-graph' conversation.view occupant: full graph, or merged-screen while embedded. */
function PlanGraphTab(props) {
  const { sessionId, useSession, toggleStore, turnStore, embedStore, t, layout } = props
  const [embedded, setEmbedded] = React.useState(() => embedStore.isEmbedded(sessionId))
  React.useEffect(() => embedStore.subscribe(() => setEmbedded(embedStore.isEmbedded(sessionId))), [sessionId])
  if (embedded) {
    return React.createElement(MergedScreen, {
      t,
      onReturn: () => {
        embedStore.setEmbedded(sessionId, false)
        if (layout) layout.closeDetails()
      },
    })
  }
  return React.createElement(PlanGraphView, {
    useSession, toggleStore, turnStore, t,
    embedded: false,
    onEmbedToggle: () => {
      embedStore.setEmbedded(sessionId, true)
      if (layout) layout.openDetails()
    },
  })
}

/** The right details column occupant: plan graph while embedded, otherwise tool details / empty. */
function PlanGraphDetails(props) {
  const { sessionId, useSession, toggleStore, turnStore, embedStore, t, layout, interval } = props
  const snapshot = useSession((s) => s)
  const [embedded, setEmbedded] = React.useState(() => embedStore.isEmbedded(sessionId))
  const [selection, setSelection] = React.useState(null)
  React.useEffect(() => embedStore.subscribe(() => setEmbedded(embedStore.isEmbedded(sessionId))), [sessionId])
  React.useEffect(() => {
    if (!sessionId || !interval) return undefined
    // The chat store is private to ui-conversation; its state is mirrored to
    // localStorage on every change (sync persist), so a light poll keeps the
    // selected tool call current without touching the live store.
    const read = () => {
      let sel = null
      try {
        if (typeof localStorage !== 'undefined') {
          const raw = localStorage.getItem('dsh.conversation.chat.' + sessionId)
          if (raw) {
            const state = JSON.parse(raw)
            if (state && state.selection && state.selection.callId) sel = state.selection
          }
        }
      } catch (e) {}
      setSelection((prev) => {
        const pk = prev && prev.callId ? prev.callId : null
        const nk = sel && sel.callId ? sel.callId : null
        return pk === nk ? prev : sel
      })
    }
    read()
    return interval(read, 300)
  }, [sessionId])
  if (sessionId === undefined) return null
  if (embedded) {
    return React.createElement(PlanGraphView, {
      useSession, toggleStore, turnStore, t,
      embedded: true,
      sidebar: true,
      onEmbedToggle: () => {
        embedStore.setEmbedded(sessionId, false)
        if (layout) layout.closeDetails()
      },
    })
  }
  if (selection) {
    return React.createElement(ToolDetailsView, {
      snapshot, selection, t,
      onClose: () => { if (layout) layout.closeDetails() },
    })
  }
  return React.createElement(DetailsEmpty, {
    t,
    onClose: () => { if (layout) layout.closeDetails() },
  })
}

const EN_DICT = {
  'view.planGraph': 'Plan Graph',
  'empty.title': 'No nodes yet',
  'empty.hint': 'This session has no tool calls or messages to visualize yet.',
  'toolbar.hideTools': 'Hide tool calls',
  'toolbar.groupTurns': 'Group by turn',
  'toolbar.latest': 'Locate latest',
  'toolbar.scroll': 'Scroll',
  'toolbar.nodes': 'nodes',
  'toolbar.turns': '{n} turns',
  'status.active': 'active', 'status.waiting': 'waiting', 'status.completed': 'completed',
  'status.failed': 'failed', 'status.blocked': 'blocked', 'status.superseded': 'superseded', 'status.idle': 'idle', 'status.input': 'input',
  'type.inspect': 'inspect', 'type.run': 'run', 'type.wait_output': 'wait', 'type.verify': 'verify',
  'type.assistant': 'assistant', 'type.user': 'user', 'type.command': 'command',
  'type.history': 'history', 'type.turn': 'turn', 'type.context': 'context', 'type.unknown': 'other',
  'detail.title': 'Node details', 'detail.type': 'Type', 'detail.status': 'Status', 'detail.tool': 'Tool',
  'detail.callId': 'Call ID', 'detail.duration': 'Duration', 'detail.error': 'Error', 'detail.payload': 'Payload',
  'detail.result': 'Result', 'detail.output': 'Output', 'detail.content': 'Content', 'detail.thinking': 'Thinking',
  'detail.turn': 'Turn',
  'turn.title': 'Turn {n}',
  'turn.members': '{n} nodes',
  'turn.failed': '{n} failed',
  'turn.active': '{n} running',
  'node.context': 'Context',
  'embed.merge': 'Merge into conversation',
  'embed.return': 'Back to tab',
  'embed.mergedTitle': 'Plan Graph merged into the conversation sidebar',
  'embed.mergedHint': 'Switch to the "Chat" tab above to see the graph in the right sidebar of the conversation page; drag the divider to resize it.',
  'detail.selectHint': 'Select a tool call in the conversation to view its details here.',
  'detail.notInWindow': 'This call is no longer in the current window.',
  'detail.toolRunning': 'Running…',
  'detail.close': 'Close details',
}

const ZH_DICT = {
  'view.planGraph': 'Plan 图',
  'empty.title': '暂无节点',
  'empty.hint': '本会话还没有可可视化的工具调用或消息。',
  'toolbar.hideTools': '隐藏工具调用',
  'toolbar.groupTurns': '按 Turn 折叠',
  'toolbar.latest': '定位至最新',
  'toolbar.scroll': '上下滚动',
  'toolbar.nodes': '个节点',
  'toolbar.turns': '{n} 轮',
  'status.active': '执行中', 'status.waiting': '等待中', 'status.completed': '已完成',
  'status.failed': '失败', 'status.blocked': '阻塞', 'status.superseded': '已取代', 'status.idle': '空闲', 'status.input': '输入',
  'type.inspect': '检查', 'type.run': '执行', 'type.wait_output': '等待', 'type.verify': '验证',
  'type.assistant': '助手', 'type.user': '用户', 'type.command': '命令',
  'type.history': '历史', 'type.turn': '轮次', 'type.context': '上下文', 'type.unknown': '其他',
  'detail.title': '节点详情', 'detail.type': '类型', 'detail.status': '状态', 'detail.tool': '工具',
  'detail.callId': '调用 ID', 'detail.duration': '耗时', 'detail.error': '错误', 'detail.payload': '参数',
  'detail.result': '结果', 'detail.output': '输出', 'detail.content': '内容', 'detail.thinking': '思考',
  'detail.turn': '轮次',
  'turn.title': '第 {n} 轮',
  'turn.members': '{n} 个节点',
  'turn.failed': '{n} 失败',
  'turn.active': '{n} 执行中',
  'node.context': '上下文注入',
  'embed.merge': '并入对话界面',
  'embed.return': '返回tab页',
  'embed.mergedTitle': 'Plan Graph 已并入对话页右侧栏',
  'embed.mergedHint': '在上方标签页切换到「对话」，即可在主对话界面的右侧查看本图；拖拽分隔条可调整宽度。',
  'detail.selectHint': '在对话中选择一个工具调用，可在此查看详情。',
  'detail.notInWindow': '该调用已不在当前窗口。',
  'detail.toolRunning': '运行中…',
  'detail.close': '关闭详情',
}

const PG_CSS = `
.pg-root { position: relative; display: flex; flex-direction: column; height: 100%; min-height: 0; color: var(--dsw-alias-label-primary); background: var(--dsw-alias-bg-base); font: 13px/1.4 system-ui, sans-serif; }
.pg-toolbar { display: flex; align-items: center; gap: 8px; padding: 6px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); flex: none; flex-wrap: wrap; }
.pg-title { font-weight: 600; font-size: 13px; }
.pg-btn { border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-2); color: var(--dsw-alias-label-primary); border-radius: 6px; padding: 3px 10px; cursor: pointer; font-size: 12px; }
.pg-btn:hover { border-color: var(--dsw-alias-brand-primary); }
.pg-btn-on { border-color: var(--dsw-alias-state-success-primary); color: var(--dsw-alias-state-success-primary); }
.pg-count { margin-left: auto; color: var(--dsw-alias-label-secondary); font-size: 12px; }
.pg-body { display: flex; flex: 1; min-height: 0; }
.pg-canvas-wrap { position: relative; flex: 1; min-width: 0; display: flex; }
.pg-canvas { flex: 1; min-width: 0; overflow: hidden; position: relative; cursor: grab; background-color: var(--dsw-alias-bg-base); background-image: linear-gradient(var(--dsw-alias-border-l1) 1px, transparent 1px), linear-gradient(90deg, var(--dsw-alias-border-l1) 1px, transparent 1px); }
.pg-canvas:active { cursor: grabbing; }
.pg-svg { display: block; }
.pg-scrollbar { position: absolute; right: 5px; top: 8px; bottom: 8px; width: 10px; border-radius: 5px; background: color-mix(in srgb, var(--dsw-alias-label-secondary) 10%, transparent); z-index: 2; cursor: pointer; touch-action: none; }
.pg-scrollbar-thumb { position: absolute; top: 0; left: 1px; width: 8px; min-height: 28px; border-radius: 4px; background: color-mix(in srgb, var(--dsw-alias-label-secondary) 58%, transparent); box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--dsw-alias-bg-base) 35%, transparent); cursor: grab; transition: background 120ms ease; }
.pg-scrollbar-thumb:hover { background: color-mix(in srgb, var(--dsw-alias-label-secondary) 76%, transparent); }
.pg-scrollbar-thumb:active { cursor: grabbing; background: var(--dsw-alias-brand-primary); }
.pg-scrollbar-disabled { opacity: 0.35; cursor: default; }
.pg-scrollbar-disabled .pg-scrollbar-thumb { cursor: default; }
.pg-empty { margin: auto; color: var(--dsw-alias-label-secondary); text-align: center; padding: 24px; }
.pg-node { box-sizing: border-box; width: 210px; height: 76px; border: 1px solid var(--dsw-alias-border-l2); border-left: 3px solid var(--pg-color); border-radius: 7px; background: var(--dsw-alias-bg-layer-1); padding: 7px 9px 6px; display: flex; flex-direction: column; gap: 3px; cursor: pointer; overflow: hidden; box-shadow: 0 1px 2px rgba(15, 23, 42, 0.08); transition: border-color 120ms ease, box-shadow 120ms ease, transform 120ms ease; }
.pg-node:hover { border-color: var(--pg-color); box-shadow: 0 3px 10px rgba(15, 23, 42, 0.14); transform: translateY(-1px); }
.pg-node-selected { border-color: var(--pg-color); box-shadow: 0 0 0 2px color-mix(in srgb, var(--pg-color) 28%, transparent), 0 3px 10px rgba(15, 23, 42, 0.14); }
.pg-node-turn { width: 190px; height: 54px; padding: 6px 9px; background: var(--dsw-alias-bg-layer-2); }
.pg-node-assistant { background: color-mix(in srgb, #8b5cf6 5%, var(--dsw-alias-bg-layer-1)); }
.pg-node-user { background: color-mix(in srgb, #3b82f6 5%, var(--dsw-alias-bg-layer-1)); }
.pg-node-tool { background: color-mix(in srgb, #d6b56f 7%, var(--dsw-alias-bg-layer-1)); }
.pg-node-context { background: color-mix(in srgb, #10b981 5%, var(--dsw-alias-bg-layer-1)); }
.pg-node-head { display: flex; align-items: center; gap: 6px; min-width: 0; height: 18px; }
.pg-node-glyph { min-width: 20px; box-sizing: border-box; background: var(--pg-color); color: #fff; border-radius: 4px; font-size: 8px; line-height: 16px; font-weight: 700; padding: 0 4px; text-align: center; letter-spacing: 0; flex: none; }
.pg-node-title { font-weight: 650; font-size: 11px; line-height: 16px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; min-width: 0; }
.pg-node-status { margin-left: auto; display: inline-flex; align-items: center; gap: 4px; border-radius: 999px; background: color-mix(in srgb, var(--pg-color) 10%, transparent); padding: 1px 5px; font-size: 9px; line-height: 14px; color: var(--pg-color); white-space: nowrap; flex: none; }
.pg-node-status-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; flex: none; }
.pg-node-summary { min-height: 26px; font-size: 10px; line-height: 13px; color: var(--dsw-alias-label-secondary); overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
.pg-node-turn .pg-node-summary { min-height: 13px; -webkit-line-clamp: 1; }
.pg-node-foot { margin-top: auto; padding-top: 3px; border-top: 1px solid var(--dsw-alias-border-l1); font-size: 9px; line-height: 12px; color: var(--dsw-alias-label-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; display: flex; align-items: center; gap: 5px; }
.pg-node-foot-label { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.pg-node-time { flex: none; font-size: 9px; color: var(--dsw-alias-label-secondary); font-variant-numeric: tabular-nums; opacity: 0.85; }
.pg-edge { fill: none; stroke: #94a3b8; stroke-width: 1.25; opacity: 0.72; }
.pg-edge-subcall { stroke: #3b82f6; stroke-dasharray: 5 4; }
.pg-detail { width: 300px; flex: none; border-left: 1px solid var(--dsw-alias-border-l1); background: var(--dsw-alias-bg-layer-1); overflow: auto; padding: 10px 12px; }
.pg-detail h3 { margin: 0 0 8px; font-size: 13px; display: flex; align-items: center; gap: 6px; }
.pg-detail-title { font-weight: 500; color: var(--dsw-alias-label-secondary); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; flex: 1; }
.pg-close { margin-left: auto; border: none; background: none; color: var(--dsw-alias-label-secondary); cursor: pointer; font-size: 14px; padding: 0 4px; }
.pg-kv { display: grid; grid-template-columns: 92px 1fr; gap: 4px 8px; font-size: 12px; margin: 0; }
.pg-kv dt { color: var(--dsw-alias-label-secondary); }
.pg-kv dd { margin: 0; word-break: break-word; }
.pg-error { color: var(--dsw-alias-state-error-primary); }
.pg-block { margin-top: 10px; }
.pg-block h4 { margin: 0 0 4px; font-size: 12px; color: var(--dsw-alias-label-secondary); }
.pg-pre { background: var(--dsw-alias-bg-base); border: 1px solid var(--dsw-alias-border-l1); border-radius: 6px; padding: 8px; font: 11px/1.5 ui-monospace, monospace; white-space: pre-wrap; word-break: break-word; max-height: 40vh; overflow: auto; margin: 0; }
.pg-root-embedded .pg-body { flex-direction: column; }
.pg-root-embedded .pg-detail { width: auto; max-height: 42%; min-height: 150px; border-left: none; border-top: 1px solid var(--dsw-alias-border-l1); }
.pg-detail-column { width: auto; border-left: none; height: 100%; box-sizing: border-box; }
.pg-detail-empty { color: var(--dsw-alias-label-secondary); font-size: 12px; text-align: center; padding: 28px 12px; }
.pg-merged { margin: auto; max-width: 460px; padding: 40px 28px; text-align: center; display: flex; flex-direction: column; align-items: center; gap: 14px; }
.pg-merged h2 { margin: 0; font-size: 15px; color: var(--dsw-alias-label-primary); }
.pg-merged p { margin: 0; font-size: 12px; line-height: 1.7; color: var(--dsw-alias-label-secondary); }
.pg-btn-embed { border-color: var(--dsw-alias-brand-primary); color: var(--dsw-alias-brand-primary); }
`

function makeStore(storageKey) {
  let value = false
  const listeners = new Set()
  const readStored = () => {
    try {
      return typeof localStorage !== 'undefined' && localStorage.getItem(storageKey) === '1'
    } catch (e) { return false }
  }
  const writeStored = (v) => {
    try {
      if (typeof localStorage !== 'undefined') {
        if (v) localStorage.setItem(storageKey, '1')
        else localStorage.removeItem(storageKey)
      }
    } catch (e) {}
  }
  value = readStored()
  return {
    get: () => value,
    set: (v) => { value = !!v; writeStored(value); listeners.forEach((fn) => fn()) },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

/** Per-session embed state (sidebar-merged vs tab). In-memory only: the layout
 *  store does not persist panel geometry either, so a reload or session switch
 *  starts in tab mode consistently. */
function makeEmbedStore() {
  const set = new Set()
  const listeners = new Set()
  return {
    isEmbedded: (sid) => sid != null && set.has(sid),
    anyEmbedded: () => set.size > 0,
    setEmbedded: (sid, v) => {
      if (sid == null) return
      if (v) set.add(sid)
      else set.delete(sid)
      listeners.forEach((fn) => fn(sid))
    },
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn) },
  }
}

return {
  apply(ctx) {
    console.log('[plan-graph] apply')

    const toggleStore = makeStore('plan-graph.hide-tool-calls')
    const turnStore = makeStore('plan-graph.group-by-turn')
    const embedStore = makeEmbedStore()
    const layout = ctx.get('layout')
    const timer = ctx.get('timer')
    const interval = timer ? ((fn, ms) => timer.interval(fn, ms)) : null

    const locale = ctx.get('locale')
    if (locale) {
      ctx.effect(() => locale.register('plan-graph', 'zh', ZH_DICT), 'plan-graph: zh dict')
      ctx.effect(() => locale.register('plan-graph', 'en', EN_DICT), 'plan-graph: en dict')
    }
    const t = locale ? locale.bind('plan-graph') : ((key) => key)

    ctx.effect(() => ctx.provide('chatNodeVisibility', {
      isNodeVisible: (node) => {
        if (!toggleStore.get()) return true
        if (node == null) return true
        return node.kind !== 'tool-call'
      },
    }), 'plan-graph: chatNodeVisibility')

    const slots = ctx.get('slots')
    if (slots) {
      slots.inject('conversation.view', () => slots.register({
        name: 'conversation.view',
        id: 'plan-graph',
        order: 20,
        label: () => t('view.planGraph'),
      }, (props) => React.createElement(PlanGraphTab, {
        useSession: props ? props.useSession : undefined,
        sessionId: props ? props.sessionId : undefined,
        toggleStore,
        turnStore,
        embedStore,
        layout,
        t,
      })))

      // The right details column. Registered ONLY while some session is
      // embedded, so the shipped tool-details panel keeps full fidelity
      // whenever the graph is not merged into the conversation page. The
      // dynamic priority (lower than the shipped entry) wins the single slot.
      let detailsRegistration = null
      const syncDetails = () => {
        const want = embedStore.anyEmbedded()
        if (want && detailsRegistration === null) {
          detailsRegistration = slots.inject('details', () => slots.register({
            name: 'details',
            priority: -1,
          }, (props) => React.createElement(PlanGraphDetails, {
            useSession: props ? props.useSession : undefined,
            sessionId: props ? props.sessionId : undefined,
            toggleStore,
            turnStore,
            embedStore,
            layout,
            interval,
            t,
          })))
        } else if (!want && detailsRegistration !== null) {
          detailsRegistration()
          detailsRegistration = null
        }
      }
      ctx.effect(() => embedStore.subscribe(syncDetails), 'plan-graph: embed sync')
      syncDetails()
    }

    ctx.effect(() => styles.insert(PG_CSS), 'plan-graph: styles')
  },
}
