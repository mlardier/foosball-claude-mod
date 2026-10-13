import { atom, read, update } from 'claude-code'
import type { EngineInterface, JsonValue, Register } from 'claude-code'

import type { FoosballCommand, FoosballNet, FoosballPlayer, FoosballProfile } from '../types'
import { H, RANKS, W, parseNetCmds } from './game'

const PANE = 'foosball'
const STORE_KEY = 'profile'

const EMPTY: FoosballProfile = { rank: 0, wins: 0, losses: 0, streak: 0, bestStreak: 0, fastestKmh: 0, trophies: [] }
const OFF_NET: FoosballNet = {
  view: 'cpu',
  status: 'off',
  error: '',
  me: null,
  peer: null,
  role: null,
  addresses: [],
  lobby: [],
  board: [],
  myPlace: 0,
}

const profile = atom({ plugin: 'foosball', key: 'profile' } as const, EMPTY)
const control = atom({ plugin: 'foosball', key: 'control' } as const, { seq: 0, cmd: 'none' })
const net = atom({ plugin: 'foosball', key: 'net' } as const, OFF_NET)

type Result = {
  type: 'over'
  mode: '1p' | '2p'
  rank: number
  you: number
  cpu: number
  fastestKmh: number
  goals: string[]
  maxDeficit: number
}

const TROPHIES: { id: string; name: string; earned: (r: Result, won: boolean) => boolean }[] = [
  { id: 'first-win', name: 'First Blood (win a game)', earned: (_, won) => won },
  { id: 'snake', name: 'Snake Charmer (score a snake shot)', earned: r => r.goals.includes('SNAKE SHOT') },
  { id: 'bank', name: 'Bank Robber (score off the wall)', earned: r => r.goals.includes('BANK SHOT') },
  { id: 'onetouch', name: 'One-Touch Wonder (volley one in)', earned: r => r.goals.includes('ONE-TOUCH') },
  { id: 'downtown', name: 'Downtown (score from the back)', earned: r => r.goals.includes('FROM DOWNTOWN') },
  { id: 'rocket', name: 'Rocket (shot of 85+ km/h)', earned: r => r.fastestKmh >= 85 },
  { id: 'shutout', name: 'Clean Sheet (win 5–0)', earned: (r, won) => won && r.cpu === 0 },
  { id: 'comeback', name: 'Comeback Kid (win from 3 down)', earned: (r, won) => won && r.maxDeficit >= 3 },
  { id: 'legend', name: 'Champion (beat the Legend)', earned: (r, won) => won && r.rank === RANKS.length - 1 },
]

const CONTROLS: { hotkey: string; label: string; cmd: FoosballCommand }[] = [
  { hotkey: 'w', label: '↑', cmd: 'up' },
  { hotkey: 's', label: '↓', cmd: 'down' },
  { hotkey: 'd', label: 'shoot', cmd: 'shoot' },
  { hotkey: 'p', label: 'pause', cmd: 'pause' },
  { hotkey: 'r', label: 'new', cmd: 'restart' },
  { hotkey: 'm', label: '1P/2P', cmd: 'mode' },
]

const HELP = [
  '/foosball            open the table',
  '/foosball office     office lobby and leaderboard',
  '/foosball host       open a table colleagues can join',
  '/foosball join IP:PORT   join a table by address',
  '/foosball name NICK  set your league name',
  '/foosball leave      leave the online match',
  '/foosball cpu        back to the CPU ladder',
].join('\n')

type Dollar = EngineInterface
type Bridge = { sock: string | null; ready: Promise<string | null> }

let bridge: Bridge | null = null
let pollTimer: { cancel: () => void } | null = null
let isPaneOpen = false
let hostInbox: { inSeq: number; cmds: string[] } = { inSeq: 0, cmds: [] }
let guestSnap: JsonValue = null
let isOnlineReported = false

const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

const isResult = (v: unknown): v is Result => obj(v)?.type === 'over'

function toPlayer(v: unknown): FoosballPlayer | null {
  const o = obj(v)
  if (o === null || typeof o.id !== 'string' || typeof o.name !== 'string') return null
  const n = (x: unknown) => (typeof x === 'number' && Number.isFinite(x) ? x : 0)
  return { id: o.id, name: o.name.slice(0, 21), rating: n(o.rating), wins: n(o.wins), losses: n(o.losses), ver: n(o.ver) }
}

function toNet(reply: Record<string, unknown>, view: FoosballNet['view']): FoosballNet {
  const statuses: FoosballNet['status'][] = ['idle', 'hosting', 'connecting', 'playing']
  const list = (v: unknown) => (Array.isArray(v) ? v.slice(0, 50) : [])
  const role = reply.role === 'host' || reply.role === 'guest' ? reply.role : null
  return {
    view,
    status: statuses.find(s => s === reply.status) ?? 'idle',
    error: typeof reply.error === 'string' ? reply.error.slice(0, 200) : '',
    me: toPlayer(reply.me),
    peer: toPlayer(reply.peer),
    role,
    addresses: list(reply.addresses).filter((a): a is string => typeof a === 'string'),
    lobby: list(reply.lobby).flatMap(entry => {
      const player = toPlayer(entry)
      const table = obj(obj(entry)?.table)
      if (player === null) return []
      const isTable = table !== null && typeof table.address === 'string' && typeof table.port === 'number'
      return [{ ...player, table: isTable ? { address: String(table.address), port: Number(table.port) } : null }]
    }),
    board: list(reply.board).flatMap(entry => {
      const player = toPlayer(entry)
      const o = obj(entry)
      return player === null ? [] : [{ ...player, place: Number(o?.place ?? 0), online: o?.online === true }]
    }),
    myPlace: typeof reply.myPlace === 'number' ? reply.myPlace : 0,
  }
}

const setNet = ($: Dollar, change: (n: FoosballNet) => FoosballNet) => update($, net, change)

async function absorb($: Dollar, reply: Record<string, unknown>): Promise<void> {
  const cmds: string[] = []
  for (const m of Array.isArray(reply.in) ? reply.in : []) {
    const msg = obj(m)
    if (msg?.t === 'joined') {
      hostInbox = { inSeq: 0, cmds: [] }
      guestSnap = null
      isOnlineReported = false
      $.ui.toast(`Foosball: ${toPlayer(msg.peer)?.name ?? 'Someone'} is in. Game on!`)
    } else if (msg?.t === 'left') {
      guestSnap = null
      $.ui.toast('Foosball: your opponent left the table')
    } else if (msg?.t === 'game') {
      const d = obj(msg.d)
      if (d?.k === 'cmds') cmds.push(...parseNetCmds(d.c))
      else if (d?.k === 'snap') guestSnap = (d.g ?? null) as JsonValue
    }
  }
  if (cmds.length > 0) hostInbox = { inSeq: hostInbox.inSeq + 1, cmds: cmds.slice(0, 20) }

  const current = await read($, net)
  const next = toNet(reply, current.view)
  if (JSON.stringify(next) !== JSON.stringify(current)) await setNet($, () => next)
}

async function exchange($: Dollar, body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  const sock = bridge?.sock
  if (!sock) return null
  try {
    const res = await $.http.fetch('http://foosball/x', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      socketPath: sock,
    })
    const reply = res.ok ? obj(JSON.parse(res.text)) : null
    if (reply !== null) await absorb($, reply)
    return reply
  } catch {
    return null
  }
}

function readySock(line: string): string | null {
  try {
    const m = obj(JSON.parse(line))
    return m?.t === 'ready' && typeof m.sock === 'string' ? m.sock : null
  } catch {
    return null
  }
}

async function startBridge($: Dollar): Promise<string | null> {
  if (bridge !== null) return bridge.ready
  await setNet($, n => ({ ...n, status: 'starting', error: '' }))
  let resolve: (sock: string | null) => void = () => {}
  const current: Bridge = { sock: null, ready: new Promise(r => (resolve = r)) }
  bridge = current

  void (async () => {
    let buf = ''
    try {
      for await (const chunk of $.process.spawn({ argv: ['node', `${$.plugin.root}/bridge/bridge.mjs`] })) {
        if (chunk.stream === 'stderr') {
          $.ui.log(`foosball bridge: ${chunk.text.trim()}`, { to: 'debug' })
          continue
        }
        buf += chunk.text
        for (let i = buf.indexOf('\n'); i >= 0; i = buf.indexOf('\n')) {
          const sock = readySock(buf.slice(0, i))
          buf = buf.slice(i + 1)
          if (sock !== null) {
            current.sock = sock
            resolve(sock)
          }
        }
      }
    } catch (err) {
      $.ui.log(`foosball: the office bridge stopped (${err instanceof Error ? err.message : String(err)}); is node on PATH?`)
    }
    resolve(null)
    if (bridge === current) {
      bridge = null
      pollTimer?.cancel()
      pollTimer = null
      await setNet($, n => ({ ...OFF_NET, view: n.view }))
    }
  })()

  const sock = await Promise.race([current.ready, $.clock.sleep(5000).then(() => null)])
  if (sock === null) {
    await setNet($, n => ({ ...n, status: 'off', error: 'The office bridge did not start: needs node on PATH.' }))
    return null
  }
  pollTimer ??= $.clock.every(1000, () => {
    void (async () => {
      const n = await read($, net)
      if (n.role === null && (isPaneOpen || n.status === 'hosting' || n.status === 'connecting')) await exchange($, {})
    })().catch(() => {})
  })
  await exchange($, {})
  return sock
}

async function stopBridge($: Dollar): Promise<void> {
  await exchange($, { op: 'quit' })
}

async function openOffice($: Dollar): Promise<boolean> {
  await setNet($, n => ({ ...n, view: 'office' }))
  return (await startBridge($)) !== null
}

function netProps(n: FoosballNet) {
  if (n.role === null || n.me === null || n.peer === null) return null
  const isHost = n.role === 'host'
  return {
    role: n.role,
    blue: isHost ? n.me.name : n.peer.name,
    red: isHost ? n.peer.name : n.me.name,
    inSeq: hostInbox.inSeq,
    cmds: hostInbox.cmds,
    snap: guestSnap,
  }
}

let lastScale = { x: 1, y: 1 }

function fit(bodyColumns: number, bodyRows: number, extraRows: number) {
  const y = [2, 1].find(sy => H * sy + 4 + extraRows <= bodyRows) ?? 1
  const x = [4, 3, 2, 1].find(sx => sx <= 2 * y && W * sx + 3 <= bodyColumns) ?? 1
  lastScale = { x, y }
  return { scale: lastScale, width: W * x + 3, height: H * y + 4 }
}

async function tableProps($: Dollar) {
  const c = await read($, control)
  const p = await read($, profile)
  return { seq: c.seq, cmd: c.cmd, rank: p.rank, net: netProps(await read($, net)), scale: lastScale }
}

async function reportOnline($: Dollar, n: FoosballNet, snap: unknown): Promise<void> {
  const g = obj(snap)
  if (g === null || n.peer === null) return
  if (g.phase !== 'over') {
    isOnlineReported = false
    return
  }
  if (isOnlineReported) return
  isOnlineReported = true
  const blue = Number(g.you)
  const red = Number(g.cpu)
  const won = n.role === 'host' ? blue > red : red > blue
  const before = n.me?.rating ?? 0
  await exchange($, { op: 'result', won, opponent: n.peer })
  const after = (await read($, net)).me?.rating ?? before
  const delta = after - before
  $.ui.toast(`Foosball: ${won ? 'you beat' : 'you lost to'} ${n.peer.name} · rating ${after} (${delta >= 0 ? '+' : ''}${delta})`)
}

async function recordLadder($: Dollar, r: Result): Promise<void> {
  if (r.mode === '2p') {
    $.ui.toast(`Foosball: ${r.you > r.cpu ? 'Blue' : 'Red'} wins ${Math.max(r.you, r.cpu)}–${Math.min(r.you, r.cpu)}`)
    return
  }
  const won = r.you > r.cpu
  const before = await read($, profile)
  const unlocked = TROPHIES.filter(t => !before.trophies.includes(t.id) && t.earned(r, won))
  const after = await update($, profile, p => {
    const streak = won ? p.streak + 1 : 0
    return {
      rank: won && r.rank === p.rank ? Math.min(p.rank + 1, RANKS.length - 1) : p.rank,
      wins: p.wins + (won ? 1 : 0),
      losses: p.losses + (won ? 0 : 1),
      streak,
      bestStreak: Math.max(p.bestStreak, streak),
      fastestKmh: Math.max(p.fastestKmh, r.fastestKmh),
      trophies: [...p.trophies, ...unlocked.map(t => t.id).filter(id => !p.trophies.includes(id))],
    }
  })
  await $.store.set(STORE_KEY, after)
  const promoted = after.rank > before.rank ? ` Promoted to ${RANKS[after.rank]?.name}!` : ''
  $.ui.toast(won ? `Foosball: you won ${r.you}–${r.cpu}.${promoted}` : `Foosball: lost ${r.you}–${r.cpu}. Streak reset.`)
  for (const t of unlocked) $.ui.toast(`★ Trophy unlocked: ${t.name}`)
}

function toProfile(v: unknown): FoosballProfile | undefined {
  const p = obj(v) as Partial<FoosballProfile> | null
  if (p === null || typeof p.wins !== 'number' || typeof p.losses !== 'number') return undefined
  return { ...EMPTY, ...p, trophies: Array.isArray(p.trophies) ? p.trophies.filter(t => typeof t === 'string') : [] }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'foosball',
      description: 'Play table foosball: CPU ladder, or the office league over the local network',
      argumentHint: '[office|host|join IP:PORT|name NICK|leave|cpu]',
    })
    const saved = toProfile(await $.store.get(STORE_KEY)) ?? toProfile(await $.store.get('record'))
    if (saved !== undefined) await update($, profile, () => saved)

    return next(e)
  })

  on('command.run', { command: 'foosball' }, async ($, e) => {
    const [sub = '', ...rest] = e.args.trim().split(/\s+/)
    isPaneOpen = true
    const pane = { id: PANE, title: 'Foosball', focus: true, rows: 46, columns: 130 } as const
    await $.ui.open(pane)
    // focus is refused while the composer still holds the submitted /foosball
    $.clock.after(250, () => void $.ui.open(pane))

    switch (sub.toLowerCase()) {
      case '':
        return { text: 'Foosball table opened.' }
      case 'cpu':
        await setNet($, n => ({ ...n, view: 'cpu' }))
        return { text: 'Foosball: CPU ladder.' }
      case 'office':
      case 'lobby':
        return { text: (await openOffice($)) ? 'Foosball: office lobby open.' : 'Foosball: the office bridge did not start (needs node on PATH).' }
      case 'host': {
        if (!(await openOffice($))) return { text: 'Foosball: the office bridge did not start.' }
        await exchange($, { op: 'host' })
        await $.clock.sleep(300)
        const reply = await exchange($, {})
        const address = Array.isArray(reply?.addresses) ? reply.addresses[0] : undefined
        return { text: `Foosball: table open. Colleagues see it in /foosball office${address ? `, or join with /foosball join ${address}` : ''}.` }
      }
      case 'join': {
        const match = /^([a-zA-Z0-9.-]+):(\d{1,5})$/.exec(rest[0] ?? '')
        if (match === null) return { text: 'Foosball: use /foosball join IP:PORT (the host sees it on their screen).' }
        if (!(await openOffice($))) return { text: 'Foosball: the office bridge did not start.' }
        await exchange($, { op: 'join', address: match[1], port: Number(match[2]) })
        for (let i = 0; i < 12; i++) {
          await $.clock.sleep(250)
          const reply = await exchange($, {})
          const n = await read($, net)
          if (n.role !== null) return { text: `Foosball: joined ${n.peer?.name ?? rest[0]}. Game on!` }
          if (typeof reply?.error === 'string' && reply.error !== '') return { text: `Foosball: could not join. ${reply.error}` }
        }
        return { text: `Foosball: no answer from ${rest[0]} yet; check the address and that the host is still hosting.` }
      }
      case 'name': {
        const name = rest.join(' ').trim()
        if (!name || !(await openOffice($))) return { text: 'Foosball: use /foosball name NICK.' }
        await exchange($, { op: 'name', name })
        return { text: `Foosball: you are now "${(await read($, net)).me?.name ?? name}" in the office league.` }
      }
      case 'leave':
        await exchange($, { op: 'leave' })
        return { text: 'Foosball: left the match.' }
      default:
        return { text: HELP }
    }
  })

  on('ui.message', async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const data = obj(e.data)

    if (data?.type === 'net') {
      const n = await read($, net)
      if (n.role === null) return next(e)
      const cmds = parseNetCmds(data.cmds)
      const out = n.role === 'host' ? [{ k: 'snap', g: data.snap }] : cmds.length > 0 ? [{ k: 'cmds', c: cmds }] : []
      await exchange($, { out })
      const after = await read($, net)
      await reportOnline($, after, after.role === 'host' ? data.snap : guestSnap)
      return { props: await tableProps($) }
    }
    if (isResult(e.data)) await recordLadder($, e.data)

    return next(e)
  })

  on('ui.close', async ($, e, next) => {
    if (e.id === PANE) {
      isPaneOpen = false
      const n = await read($, net)
      if (n.role === null && n.status !== 'hosting') await stopBridge($)
    }
    return next(e)
  })

  on('ui.fault', async ($, e, next) => {
    $.ui.log(`foosball table failed (${e.phase}): ${e.reason}`)

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    if (e.surface !== 'terminal' && e.surface !== 'desktop') {
      const { Text } = $.ui.resolve(e)
      return <Text>Foosball needs the terminal or the desktop app.</Text>
    }

    const { Box, Text, Button, Client } = $.ui.resolve(e)
    const p = await read($, profile)
    const c = await read($, control)
    const n = await read($, net)
    const press = (cmd: FoosballCommand) => () => update($, control, prev => ({ seq: prev.seq + 1, cmd }))
    const keysHint = `Esc hands the keys back, /foosball takes them${e.viewport?.isFullscreen === true ? ' · click the table for ↑↓ + space' : ''}`
    const fallback = (
      <Box gap={2}>
        {CONTROLS.filter(ctl => n.role === null || ctl.cmd === 'up' || ctl.cmd === 'down' || ctl.cmd === 'shoot').map(ctl => (
          <Button key={ctl.cmd} hotkey={ctl.hotkey} plain label={ctl.label} onPress={press(ctl.cmd)} />
        ))}
      </Box>
    )

    if (n.role !== null) {
      const online = fit(e.props.bodyColumns, e.props.scroll.bodyRows, 3)
      return (
        <Box flexDirection="column">
          <Client
            key="table"
            module="./table.tsx"
            props={{ seq: c.seq, cmd: c.cmd, rank: p.rank, net: netProps(n), scale: online.scale }}
            width={online.width}
            height={online.height}
          />
          <Box gap={2}>
            <Text color="#ffeb3b" bold>
              ONLINE
            </Text>
            <Text>
              you {n.me?.rating ?? '?'} vs {n.peer?.name} {n.peer?.rating ?? '?'}
            </Text>
            <Button key="leave" hotkey="x" plain label="leave" onPress={() => exchange($, { op: 'leave' })} />
          </Box>
          {fallback}
          <Text dimColor>move while shooting = snake · {keysHint}</Text>
        </Box>
      )
    }

    if (n.view === 'office') {
      const tables = n.lobby.filter(l => l.table !== null).slice(0, 9)
      const others = n.lobby.filter(l => l.table === null)
      return (
        <Box flexDirection="column">
          <Text>
            <Text color="#ffeb3b" bold>
              OFFICE LEAGUE
            </Text>
            {n.me ? (
              <Text>
                {'  '}you: {n.me.name} · {n.me.rating} · #{n.myPlace} · {n.me.wins}W {n.me.losses}L
              </Text>
            ) : (
              <Text dimColor> {n.status === 'starting' ? 'starting…' : 'offline'}</Text>
            )}
          </Text>
          {n.error !== '' && <Text color="#ff8a80">{n.error}</Text>}
          <Box gap={2}>
            {n.status === 'hosting' ? (
              <Button key="cancel" hotkey="c" plain label="stop hosting" onPress={() => exchange($, { op: 'leave' })} />
            ) : (
              <Button key="host" hotkey="h" plain label="host a table" onPress={() => exchange($, { op: 'host' })} />
            )}
            <Button key="cpu" hotkey="b" plain label="back to CPU" onPress={() => setNet($, v => ({ ...v, view: 'cpu' }))} />
          </Box>
          {n.status === 'hosting' && (
            <Text color="#82b1ff">
              Waiting for a challenger… they see your table automatically
              {n.addresses[0] ? `, or: /foosball join ${n.addresses[0]}` : ''}
            </Text>
          )}
          {n.status === 'connecting' && <Text color="#82b1ff">Connecting…</Text>}
          <Text bold>Open tables</Text>
          {tables.length === 0 ? (
            <Text dimColor>None yet. Host one, or ask a colleague to run /foosball host.</Text>
          ) : (
            tables.map((t, i) => (
              <Button
                key={`join-${t.id}`}
                hotkey={String(i + 1)}
                plain
                label={`challenge ${t.name} (${t.rating})`}
                onPress={() => exchange($, { op: 'join', address: t.table?.address, port: t.table?.port })}
              />
            ))
          )}
          {others.length > 0 && <Text dimColor>Also online: {others.map(o => o.name).join(', ')}</Text>}
          <Text bold>Leaderboard</Text>
          {n.board.length <= 1 && <Text dimColor>Play someone to get on the board.</Text>}
          {n.board.slice(0, 10).map(r => (
            <Text color={r.id === n.me?.id ? '#ffeb3b' : undefined}>
              {String(r.place).padStart(2)}. {r.name.padEnd(21)} {String(r.rating).padStart(4)} {String(r.wins).padStart(3)}W{' '}
              {String(r.losses).padStart(3)}L {r.online ? '●' : ' '}
            </Text>
          ))}
          <Text dimColor>Same office network only · /foosball name NICK to rename · close the pane to go offline</Text>
        </Box>
      )
    }

    const solo = fit(e.props.bodyColumns, e.props.scroll.bodyRows, 4)
    return (
      <Box flexDirection="column">
        <Client
          key="table"
          module="./table.tsx"
          props={{ seq: c.seq, cmd: c.cmd, rank: p.rank, net: null, scale: solo.scale }}
          width={solo.width}
          height={solo.height}
        />
        <Text>
          {RANKS.map((rank, i) => (
            <Text
              color={i === p.rank ? '#ffeb3b' : i < p.rank ? '#81c784' : undefined}
              bold={i === p.rank}
              dimColor={i > p.rank}
            >
              {i === p.rank ? `[${rank.name}]` : rank.name}
              {i < RANKS.length - 1 ? ' › ' : ''}
            </Text>
          ))}
        </Text>
        <Text dimColor>
          {p.wins}W {p.losses}L · streak {p.streak} (best {p.bestStreak}) · fastest {p.fastestKmh} km/h · ★{' '}
          {p.trophies.length}/{TROPHIES.length}
        </Text>
        <Box gap={2}>
          {fallback}
          <Button key="office" hotkey="o" plain label="office league" onPress={() => openOffice($)} />
        </Box>
        <Text dimColor>move while shooting = snake · {keysHint}</Text>
      </Box>
    )
  })
}
