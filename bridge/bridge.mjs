// Foosball office bridge: UDP discovery, one TCP opponent, and a Unix-socket HTTP API the mod polls.
// Started by the mod with `node bridge.mjs`; prints one `ready` line on stdout, exits when its parent drops it.
import crypto from 'node:crypto'
import dgram from 'node:dgram'
import fs from 'node:fs'
import http from 'node:http'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'

const VERSION = 1
const APP = 'claude-foosball'
const DISCOVERY_PORT = Number(process.env.FOOSBALL_DISCOVERY_PORT ?? 47474)
const BEACON_MS = 1500
const SEEN_MS = 6000
const HANDSHAKE_MS = 5000
const IDLE_EXIT_MS = 10 * 60 * 1000
const MAX_LINE = 64 * 1024
const MAX_BOARD = 200
const MAX_INBOX = 400
const ELO_K = 32

const dir = process.env.FOOSBALL_HOME ?? path.join(os.homedir(), '.claude', 'foosball')
fs.mkdirSync(dir, { recursive: true, mode: 0o700 })
const profilePath = path.join(dir, 'profile.json')
const boardPath = path.join(dir, 'board.json')

const readJson = (file, fallback) => {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}
const writeJson = (file, value) => {
  const tmp = `${file}.${process.pid}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

const cleanName = value =>
  String(value ?? '')
    .replace(/[^\p{L}\p{N} ._-]/gu, '')
    .trim()
    .slice(0, 16)

const isRecord = r =>
  r !== null &&
  typeof r === 'object' &&
  typeof r.id === 'string' &&
  /^[a-f0-9]{16}$/.test(r.id) &&
  Number.isFinite(r.rating) &&
  r.rating > 0 &&
  r.rating < 4000 &&
  Number.isInteger(r.wins) &&
  r.wins >= 0 &&
  Number.isInteger(r.losses) &&
  r.losses >= 0 &&
  Number.isInteger(r.ver) &&
  r.ver >= 0 &&
  cleanName(r.name).length > 0

const toRecord = r => ({
  id: r.id,
  name: cleanName(r.name),
  rating: Math.round(r.rating),
  wins: r.wins,
  losses: r.losses,
  ver: r.ver,
})

let me = readJson(profilePath, null)
if (!isRecord(me)) {
  me = {
    id: crypto.randomBytes(8).toString('hex'),
    name: cleanName(process.env.FOOSBALL_NAME ?? os.userInfo().username) || 'player',
    rating: 1500,
    wins: 0,
    losses: 0,
    ver: 0,
  }
  writeJson(profilePath, me)
}
me = toRecord(me)

const board = new Map()
for (const r of readJson(boardPath, [])) if (isRecord(r)) board.set(r.id, toRecord(r))
board.set(me.id, me)
let isBoardDirty = false

function merge(r) {
  if (!isRecord(r) || r.id === me.id) return
  const cur = board.get(r.id)
  if (cur !== undefined && cur.ver >= r.ver) return
  board.set(r.id, toRecord(r))
  isBoardDirty = true
  if (board.size > MAX_BOARD) {
    const weakest = [...board.values()].filter(x => x.id !== me.id).sort((a, b) => a.wins + a.losses - (b.wins + b.losses))[0]
    if (weakest) board.delete(weakest.id)
  }
}

function saveMe() {
  me.ver += 1
  board.set(me.id, me)
  writeJson(profilePath, me)
  isBoardDirty = true
}

setInterval(() => {
  if (!isBoardDirty) return
  isBoardDirty = false
  writeJson(boardPath, [...board.values()])
}, 5000).unref()

const seen = new Map()
let server = null
let hostPort = 0
let peer = null
let status = 'idle'
let lastError = ''
let inbox = []
let lastPoll = Date.now()

const push = msg => {
  inbox.push(msg)
  if (inbox.length > MAX_INBOX) inbox = inbox.filter(m => m.t !== 'game').concat(inbox.filter(m => m.t === 'game').slice(-50))
}

function lanAddresses() {
  const out = []
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      const ip = a.address.split('.').map(Number)
      const mask = a.netmask.split('.').map(Number)
      out.push({ address: a.address, broadcast: ip.map((b, i) => (b | (~(mask[i] ?? 0) & 255)) >>> 0).join('.') })
    }
  }
  return out
}

function onBeacon(buf, rinfo) {
  if (buf.length > 4096) return
  let m
  try {
    m = JSON.parse(buf.toString('utf8'))
  } catch {
    return
  }
  if (m?.app !== APP || m.v !== VERSION || !isRecord(m.rec) || m.rec.id === me.id) return
  merge(m.rec)
  const port = Number.isInteger(m.port) && m.port > 0 && m.port < 65536 ? m.port : 0
  seen.set(m.rec.id, { at: Date.now(), rec: toRecord(m.rec), table: port ? { address: rinfo.address, port } : null })
}

let udp = null
function openDiscovery(reusePort) {
  const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true, reusePort })
  socket.on('message', onBeacon)
  socket.on('error', err => {
    socket.close()
    if (udp === socket) udp = null
    if (reusePort && err.code === 'ENOTSUP') return openDiscovery(false)
    lastError = `discovery off (${err.code ?? err.message}); join by address instead`
  })
  socket.bind(DISCOVERY_PORT, () => {
    socket.setBroadcast(true)
    udp = socket
  })
}
openDiscovery(process.platform !== 'win32')

setInterval(() => {
  if (udp === null) return
  const msg = Buffer.from(JSON.stringify({ app: APP, v: VERSION, rec: me, port: server && !peer ? hostPort : 0 }))
  const targets = new Set(['255.255.255.255', ...lanAddresses().map(a => a.broadcast)])
  if (process.env.FOOSBALL_LOOPBACK === '1') targets.add('127.0.0.1')
  for (const target of targets) udp.send(msg, DISCOVERY_PORT, target, () => {})
}, BEACON_MS).unref()

function send(line) {
  if (peer?.socket.writable) peer.socket.write(`${JSON.stringify(line)}\n`)
}

function dropPeer(reason) {
  if (peer === null) return
  const was = peer
  peer = null
  status = server ? 'hosting' : 'idle'
  if (was.record === null && was.role === 'guest' && lastError === '') lastError = `The host closed the connection (${reason}).`
  was.socket.end()
  setTimeout(() => was.socket.destroy(), 200).unref()
  if (was.record) push({ t: 'left', reason })
}

function stopHosting() {
  server?.close()
  server = null
  hostPort = 0
}

function attach(socket, role) {
  socket.setNoDelay(true)
  socket.setEncoding('utf8')
  peer = { socket, role, record: null }
  const handshake = setTimeout(() => {
    if (peer?.socket === socket && peer.record === null) {
      lastError = 'opponent did not answer'
      dropPeer('handshake timeout')
    }
  }, HANDSHAKE_MS)
  let buf = ''
  socket.on('data', chunk => {
    buf += chunk
    if (buf.length > MAX_LINE * 4) return dropPeer('flood')
    let i
    while ((i = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, i)
      buf = buf.slice(i + 1)
      if (line.length > MAX_LINE) return dropPeer('line too long')
      onPeerLine(socket, line)
    }
  })
  socket.on('error', err => {
    lastError = err.code ?? err.message
  })
  socket.on('close', () => {
    clearTimeout(handshake)
    if (peer?.socket === socket) dropPeer('closed')
  })
}

function onPeerLine(socket, line) {
  if (peer?.socket !== socket) return
  let m
  try {
    m = JSON.parse(line)
  } catch {
    return dropPeer('garbage')
  }
  if (m === null || typeof m !== 'object') return dropPeer('garbage')

  if (peer.record === null) {
    if (peer.role === 'guest' && m.t === 'reject') {
      lastError = `The host refused: ${String(m.reason ?? 'no reason').slice(0, 120)}`
      return dropPeer('rejected')
    }
    const expected = peer.role === 'host' ? 'hello' : 'welcome'
    if (m.t !== expected || m.v !== VERSION || !isRecord(m.rec)) return dropPeer('bad handshake')
    if (m.rec.id === me.id) {
      send({ t: 'reject', reason: 'that is your own table (same player profile on both ends)' })
      lastError = 'Someone with your own player profile tried to join; refused.'
      return dropPeer('self')
    }
    if (Array.isArray(m.board)) for (const r of m.board.slice(0, MAX_BOARD)) merge(r)
    merge(m.rec)
    peer.record = toRecord(m.rec)
    if (peer.role === 'host') {
      send({ t: 'welcome', v: VERSION, rec: me, board: [...board.values()] })
      stopHosting()
    }
    status = 'playing'
    push({ t: 'joined', role: peer.role, peer: peer.record })
    return
  }
  if (m.t === 'game') push({ t: 'game', d: m.d })
  else if (m.t === 'bye') dropPeer('left')
}

function host() {
  if (peer) return 'already in a match'
  if (server) return ''
  server = net.createServer({ noDelay: true }, socket => {
    if (peer) return socket.destroy()
    attach(socket, 'host')
  })
  server.maxConnections = 2
  server.on('error', err => {
    lastError = `host failed: ${err.code ?? err.message}`
    stopHosting()
    status = 'idle'
  })
  server.listen(Number(process.env.FOOSBALL_HOST_PORT ?? 0), '0.0.0.0', () => {
    hostPort = server?.address()?.port ?? 0
  })
  status = 'hosting'
  return ''
}

function join(address, port) {
  if (peer) return 'already in a match'
  if (!/^[a-zA-Z0-9.-]{1,253}$/.test(String(address)) || !Number.isInteger(port) || port <= 0 || port >= 65536) {
    return 'bad address'
  }
  stopHosting()
  status = 'connecting'
  const socket = net.connect({ host: address, port, timeout: 4000 })
  socket.once('timeout', () => {
    lastError = 'could not reach that table'
    socket.destroy()
    status = 'idle'
  })
  socket.once('connect', () => {
    socket.setTimeout(0)
    attach(socket, 'guest')
    send({ t: 'hello', v: VERSION, rec: me, board: [...board.values()] })
  })
  socket.once('error', err => {
    lastError =
      err.code === 'ECONNREFUSED'
        ? 'No table at that address: the host stopped hosting or the port changed (ask for the new address).'
        : `could not join: ${err.code ?? err.message}`
    if (peer === null) status = 'idle'
  })
  return ''
}

function leave() {
  send({ t: 'bye' })
  dropPeer('you left')
  stopHosting()
  status = 'idle'
}

function result(won, opponent) {
  if (!isRecord(opponent)) return 'bad opponent'
  const expected = 1 / (1 + 10 ** ((opponent.rating - me.rating) / 400))
  me.rating = Math.round(me.rating + ELO_K * ((won ? 1 : 0) - expected))
  if (won) me.wins += 1
  else me.losses += 1
  saveMe()
  return ''
}

function displayNames(records) {
  const byName = new Map()
  for (const r of records) {
    const key = r.name.toLowerCase()
    const ids = byName.get(key) ?? new Set()
    ids.add(r.id)
    byName.set(key, ids)
  }
  const out = new Map()
  for (const ids of byName.values()) [...ids].sort().forEach((id, i) => out.set(id, i))
  return r => (out.get(r.id) ? { ...r, name: `${r.name} (${out.get(r.id) + 1})` } : r)
}

function snapshot() {
  const now = Date.now()
  const online = new Set([me.id])
  const lobby = []
  for (const [id, s] of seen) {
    if (now - s.at > SEEN_MS) {
      seen.delete(id)
      continue
    }
    online.add(id)
    lobby.push({ ...s.rec, table: s.table })
  }
  const ranked = [...board.values()].sort((a, b) => b.rating - a.rating)
  const shown = displayNames([...board.values(), ...lobby, ...(peer?.record ? [peer.record] : [])])
  return {
    status,
    error: lastError,
    me: shown(me),
    peer: peer?.record ? shown(peer.record) : null,
    role: peer?.record ? peer.role : null,
    addresses: server && hostPort ? lanAddresses().map(a => `${a.address}:${hostPort}`) : [],
    lobby: lobby.map(shown).sort((a, b) => a.name.localeCompare(b.name)),
    board: ranked.slice(0, 15).map((r, i) => ({ ...shown(r), place: i + 1, online: online.has(r.id) })),
    myPlace: ranked.findIndex(r => r.id === me.id) + 1,
  }
}

function handle(body) {
  lastPoll = Date.now()
  let error = ''
  const op = body?.op
  if (op === 'host') error = host()
  else if (op === 'join') error = join(body.address, Number(body.port))
  else if (op === 'leave') leave()
  else if (op === 'quit') setTimeout(shutdown, 50)
  else if (op === 'name') {
    const name = cleanName(body.name)
    if (name) {
      me.name = name
      saveMe()
    } else error = 'bad name'
  } else if (op === 'result') error = result(body.won === true, body.opponent)
  if (error) lastError = error
  if (Array.isArray(body?.out) && peer?.record) for (const d of body.out.slice(0, 20)) send({ t: 'game', d })
  const out = { ...snapshot(), in: inbox }
  inbox = []
  if (!error && op) lastError = ''
  return out
}

const sock = path.join(os.tmpdir(), `foosball-${process.pid}.sock`)
const api = http.createServer((req, res) => {
  if (req.method !== 'POST' || req.url !== '/x') {
    res.writeHead(404).end()
    return
  }
  let raw = ''
  req.setEncoding('utf8')
  req.on('data', chunk => {
    raw += chunk
    if (raw.length > MAX_LINE * 2) req.destroy()
  })
  req.on('end', () => {
    let body = {}
    try {
      body = raw ? JSON.parse(raw) : {}
    } catch {
      res.writeHead(400).end()
      return
    }
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(handle(body)))
  })
})
api.listen(sock, () => {
  fs.chmodSync(sock, 0o600)
  process.stdout.write(`${JSON.stringify({ t: 'ready', sock, me })}\n`)
})

function shutdown() {
  try {
    send({ t: 'bye' })
    writeJson(boardPath, [...board.values()])
    fs.rmSync(sock, { force: true })
  } finally {
    process.exit(0)
  }
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
setInterval(() => {
  if (Date.now() - lastPoll > IDLE_EXIT_MS) shutdown()
}, 30000).unref()
