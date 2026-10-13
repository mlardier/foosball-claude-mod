import type { ClientModule, ClientSurface, JsonValue } from 'claude-code'

import type { FoosballCommand } from '../types'
import {
  GOAL_BOTTOM,
  GOAL_PAUSE,
  GOAL_TOP,
  H,
  HOLD_MAX,
  RODS,
  RANKS,
  TARGET,
  TICK_MS,
  W,
  activeRod,
  aimAt,
  command,
  menOf,
  newGame,
  parseNetCmds,
  parseSnap,
  rankAt,
  rodAt,
  step,
  withRank,
} from './game'
import type { Command, Game, NetCmd, Side } from './game'

export type NetProps = { role: 'host' | 'guest'; blue: string; red: string; inSeq: number; cmds: string[]; snap: JsonValue }
export type TableProps = { seq: number; cmd: FoosballCommand; rank: number; net: NetProps | null; scale: Scale }
type Role = NetProps['role'] | null
type TableState = { game: Game; seq: number; rank: number; role: Role; inSeq: number; pending: NetCmd[]; sy: number }

type Style =
  | 'field'
  | 'mark'
  | 'rod'
  | 'rodYou'
  | 'rodCpu'
  | 'you'
  | 'youActive'
  | 'youKick'
  | 'youKickEdge'
  | 'cpu'
  | 'cpuActive'
  | 'cpuKick'
  | 'cpuKickEdge'
  | 'ball'
  | 'ballHeld'
  | 'trail'
  | 'wall'
  | 'goal'
  | 'bigYou'
  | 'bigCpu'
  | 'bigFlash'
  | 'plain'

const GREEN = '#1b5e20'
const STYLES: Record<Style, { color?: string; backgroundColor?: string; bold?: boolean }> = {
  field: { color: '#2e7d32', backgroundColor: GREEN },
  mark: { color: '#4caf50', backgroundColor: GREEN },
  rod: { color: '#78909c', backgroundColor: GREEN },
  rodYou: { color: '#bbdefb', backgroundColor: GREEN, bold: true },
  rodCpu: { color: '#ffcdd2', backgroundColor: GREEN, bold: true },
  you: { color: '#1e88e5', backgroundColor: GREEN },
  youActive: { color: '#82b1ff', backgroundColor: GREEN, bold: true },
  youKick: { color: '#ffffff', backgroundColor: '#1565c0', bold: true },
  youKickEdge: { color: '#1565c0', backgroundColor: GREEN },
  cpu: { color: '#c62828', backgroundColor: GREEN },
  cpuActive: { color: '#ff8a80', backgroundColor: GREEN, bold: true },
  cpuKick: { color: '#ffffff', backgroundColor: '#c62828', bold: true },
  cpuKickEdge: { color: '#c62828', backgroundColor: GREEN },
  ball: { color: '#ffffff', backgroundColor: GREEN, bold: true },
  ballHeld: { color: '#ffeb3b', backgroundColor: GREEN, bold: true },
  trail: { color: '#c5e1a5', backgroundColor: GREEN },
  wall: { color: '#d7ccc8', backgroundColor: '#4e342e' },
  goal: { color: '#fafafa', backgroundColor: '#000000', bold: true },
  bigYou: { color: '#82b1ff', backgroundColor: '#0d47a1', bold: true },
  bigCpu: { color: '#ff8a80', backgroundColor: '#b71c1c', bold: true },
  bigFlash: { color: '#ffffff', backgroundColor: '#f9a825', bold: true },
  plain: {},
}

const FONT: Record<string, readonly string[]> = {
  G: [' ███ ', '█    ', '█ ██ ', '█  █ ', ' ███ '],
  O: [' ██ ', '█  █', '█  █', '█  █', ' ██ '],
  A: [' ██ ', '█  █', '████', '█  █', '█  █'],
  L: ['█   ', '█   ', '█   ', '█   ', '████'],
  '!': ['█', '█', '█', ' ', '█'],
}

type Action = { cmd: Command; side: Side }

function keyAction(key: string, mode: Game['mode']): Action | undefined {
  const you = (cmd: Command): Action => ({ cmd, side: 'you' })
  const cpu = (cmd: Command): Action => ({ cmd, side: 'cpu' })
  switch (key) {
    case 'w':
      return you('up')
    case 's':
      return you('down')
    case 'd':
    case ' ':
    case 'space':
      return you('shoot')
    case 'up':
      return mode === '2p' ? cpu('up') : you('up')
    case 'down':
      return mode === '2p' ? cpu('down') : you('down')
    case 'left':
    case 'return':
      return mode === '2p' ? cpu('shoot') : you('shoot')
    case 'right':
      return you('shoot')
    case 'p':
      return you('pause')
    case 'r':
      return you('restart')
    case 'm':
      return you('mode')
    default:
      return undefined
  }
}

type Cell = { ch: string; style: Style }

export type Scale = { x: number; y: number }

const THIN = new Set(['│', '┃', '┊', '·'])
const QUADRANTS = ' ▘▝▀▖▌▞▛▗▚▐▜▄▙▟█'

/** Lays out the table as terminal cells, each table unit drawn as `scale.x` × `scale.y` cells. */
export function grid(g: Game, scale: Scale): Cell[][] {
  const inner: Cell[][] = Array.from({ length: H }, () =>
    Array.from({ length: W }, (): Cell => ({ ch: ' ', style: 'field' })),
  )
  const put = (x: number, y: number, cell: Cell) => {
    const row = inner[y]
    if (row !== undefined && x >= 0 && x < W) row[x] = cell
  }

  for (let y = 0; y < H; y++) put((W - 1) / 2, y, { ch: '┊', style: 'mark' })
  for (let y = GOAL_TOP - 1; y <= GOAL_BOTTOM + 1; y++) {
    put(2, y, { ch: y === GOAL_TOP - 1 || y === GOAL_BOTTOM + 1 ? '·' : ' ', style: 'mark' })
    put(W - 3, y, { ch: y === GOAL_TOP - 1 || y === GOAL_BOTTOM + 1 ? '·' : ' ', style: 'mark' })
  }

  const isPlaying = g.phase === 'play' || g.phase === 'paused'
  const active = { you: activeRod(g, 'you'), cpu: activeRod(g, 'cpu') }
  const isActiveRod = (i: number) => {
    const rod = rodAt(i)
    return isPlaying && active[rod.side] === i && (rod.side === 'you' || g.mode !== '1p')
  }
  RODS.forEach((rod, i) => {
    const isActive = isActiveRod(i)
    const rodStyle: Style = isActive ? (rod.side === 'you' ? 'rodYou' : 'rodCpu') : 'rod'
    for (let y = 0; y < H; y++) put(rod.x, y, { ch: isActive ? '┃' : '│', style: rodStyle })
  })

  const sx = scale.x
  const sy = scale.y
  const mx = Math.floor(sx / 2)
  const my = Math.floor(sy / 2)
  const big: Cell[][] = inner.flatMap(row =>
    Array.from({ length: sy }, (_, dy) =>
      row.flatMap(cell =>
        Array.from({ length: sx }, (_, dx): Cell =>
          THIN.has(cell.ch) && (dx !== mx || (cell.ch === '·' && dy !== my)) ? { ch: ' ', style: cell.style } : cell,
        ),
      ),
    ),
  )
  const at = (col: number, row: number, cell: Cell) => {
    const line = big[row]
    if (line !== undefined && col >= 0 && col < W * sx) line[col] = cell
  }
  const colOf = (x: number) => Math.round(x * sx + mx)
  const rowOf = (y: number) => Math.round(y * sy + my)

  const drawMan = (x: number, y: number, body: Style, kick: { arrow: string; fill: Style; edge: Style } | null) => {
    const cx = x * sx + mx
    const cy = y * sy + my
    const left = 2 * cx + 1 - sx
    const right = 2 * cx + 1 + sx
    const top = 2 * cy + 1 - sy
    const bottom = 2 * cy + 1 + sy
    const has = (hc: number, hr: number) => (hc >= left && hc < right && hr >= top && hr < bottom ? 1 : 0)
    for (let row = Math.floor(top / 2); row < Math.ceil(bottom / 2); row++) {
      for (let col = Math.floor(left / 2); col < Math.ceil(right / 2); col++) {
        const q =
          has(2 * col, 2 * row) |
          (has(2 * col + 1, 2 * row) << 1) |
          (has(2 * col, 2 * row + 1) << 2) |
          (has(2 * col + 1, 2 * row + 1) << 3)
        if (q === 0) continue
        if (kick === null) at(col, row, { ch: QUADRANTS[q] ?? '█', style: body })
        else if (q === 15) at(col, row, { ch: col === cx && row === cy ? kick.arrow : ' ', style: kick.fill })
        else at(col, row, { ch: QUADRANTS[q] ?? '█', style: kick.edge })
      }
    }
  }

  RODS.forEach((rod, i) => {
    const isYou = rod.side === 'you'
    const isActive = isActiveRod(i)
    const isKick = (isYou ? g.youKick : g.cpuKick) > 0 && active[rod.side] === i
    const kick = isKick
      ? isYou
        ? { arrow: '▶', fill: 'youKick' as const, edge: 'youKickEdge' as const }
        : { arrow: '◀', fill: 'cpuKick' as const, edge: 'cpuKickEdge' as const }
      : null
    const body: Style = isYou ? (isActive ? 'youActive' : 'you') : isActive ? 'cpuActive' : 'cpu'
    for (const y of menOf(g, i)) drawMan(rod.x, y, body, kick)
  })

  if (g.phase === 'goal') {
    const word = 'GOAL!'.split('')
    const width = word.reduce((sum, ch) => sum + (FONT[ch]?.[0]?.length ?? 0) + 1, -1)
    const flash = Math.floor(g.wait / 4) % 2 === 0
    const style: Style = flash ? 'bigFlash' : g.scorer === 'you' ? 'bigYou' : 'bigCpu'
    let x0 = Math.floor((W - width) / 2)
    for (const ch of word) {
      const rows = FONT[ch] ?? []
      rows.forEach((line, dy) => {
        line.split('').forEach((px, dx) => {
          if (px === ' ') return
          for (let r = 0; r < sy; r++) {
            for (let c = 0; c < sx; c++) at((x0 + dx) * sx + c, (GOAL_TOP + dy) * sy + r, { ch: '█', style })
          }
        })
      })
      x0 += (rows[0]?.length ?? 0) + 1
    }
  }

  if (g.phase !== 'goal' && g.phase !== 'over') {
    for (let i = 0; i + 1 < g.trail.length; i += 2) {
      at(colOf(g.trail[i] ?? -9), rowOf(g.trail[i + 1] ?? -9), { ch: '•', style: 'trail' })
    }
    const held = g.hold
    if (held === null) {
      at(colOf(g.bx), rowOf(g.by), { ch: '●', style: 'ball' })
    } else {
      const rod = rodAt(held.rod)
      const toe = (rod.side === 'you' ? 1 : -1) * Math.ceil(sx / 2)
      at(rod.x * sx + mx + toe, rowOf(g.by), { ch: '●', style: 'ballHeld' })
    }
  }

  const edge = (left: string, fill: string, right: string): Cell[] => [
    { ch: left, style: 'wall' },
    ...Array.from({ length: W * sx }, (): Cell => ({ ch: fill, style: 'wall' })),
    { ch: right, style: 'wall' },
  ]
  const side = (row: number): Cell => {
    const y = (row - my) / sy
    return y >= GOAL_TOP - 0.5 && y <= GOAL_BOTTOM + 0.5 ? { ch: ' ', style: 'goal' } : { ch: '║', style: 'wall' }
  }

  return [edge('╔', '═', '╗'), ...big.map((row, y) => [side(y), ...row, side(y)]), edge('╚', '═', '╝')]
}

function runs(row: Cell[]): { text: string; style: Style }[] {
  const out: { text: string; style: Style }[] = []
  for (const cell of row) {
    const last = out[out.length - 1]
    if (last?.style === cell.style) last.text += cell.ch
    else out.push({ text: cell.ch, style: cell.style })
  }
  return out
}

const isNetCmd = (cmd: string): cmd is NetCmd => cmd === 'up' || cmd === 'down' || cmd === 'shoot'
const randomSeed = () => Math.floor(Math.random() * 4294967296)

function footer(g: Game, net: NetProps | null): string {
  if (g.quipTicks > 0 && g.quip !== '') return g.label && g.phase === 'goal' ? `${g.label}! ${g.quip}` : g.quip
  const mine: Side = net?.role === 'guest' ? 'cpu' : 'you'
  if (net !== null) {
    const rival = net.role === 'host' ? net.red : net.blue
    switch (g.phase) {
      case 'ready':
        return `Online vs ${rival} · you are ${mine === 'you' ? 'Blue (left)' : 'Red (right)'} · d to kick off`
      case 'over':
        return `${g.you > g.cpu ? net.blue : net.red} wins ${Math.max(g.you, g.cpu)}–${Math.min(g.you, g.cpu)} · d for a rematch`
      case 'play':
        return g.hold?.side === mine ? 'Ball is yours: line it up, move + shoot to snake it' : ''
      default:
        return g.phase === 'paused' ? 'Paused · d to resume' : g.label ?? 'GOAL'
    }
  }
  const opponent = g.mode === '2p' ? 'Red' : rankAt(g.rank).name
  switch (g.phase) {
    case 'ready':
      return g.mode === '2p'
        ? '2 players: Blue w/s + d · Red ↑/↓ + ← · first to 5 · d to start'
        : `vs ${opponent} · trap, aim, shoot · d to kick off · m for 2 players`
    case 'paused':
      return 'Paused · d to resume'
    case 'goal':
      return g.label ?? 'GOAL'
    case 'over': {
      if (g.mode === '2p') {
        return `${g.you > g.cpu ? 'Blue' : 'Red'} wins ${Math.max(g.you, g.cpu)}–${Math.min(g.you, g.cpu)}! d for a rematch`
      }
      if (g.you < g.cpu) return `${opponent} wins ${g.cpu}–${g.you}. Run it back? d`
      const next = RANKS[g.rank + 1]
      return next
        ? `You win ${g.you}–${g.cpu}! Promoted: next up ${next.name} · d`
        : `You beat the Legend ${g.you}–${g.cpu}. Champion. · d`
    }
    case 'play':
      if (g.hold?.side === 'you') return 'Ball is yours: line it up, move + shoot to snake it'
      return g.mode === '2p' ? '' : 'Shoot just before the ball arrives for a one-touch volley'
  }
}

const Table: ClientModule<TableProps, TableState> = (rawProps, surface) => {
  const props: TableProps = { ...rawProps, net: rawProps.net ?? null, scale: rawProps.scale ?? { x: 1, y: 1 } }
  const { Box, Text } = surface.elements
  const s: ClientSurface<TableState> = surface

  if (s.state === undefined) {
    let isReported = false
    const apply = (next: Game) => {
      const prev = s.state
      if (prev === undefined) return
      const game = next.mode === '1p' && next.you === 0 && next.cpu === 0 ? withRank(next, prev.rank) : next
      if (prev.role === null && game.phase === 'over' && !isReported) {
        isReported = true
        s.post({
          type: 'over',
          mode: game.mode,
          rank: game.rank,
          you: game.you,
          cpu: game.cpu,
          fastestKmh: game.fastestKmh,
          goals: game.goals,
          maxDeficit: game.maxDeficit,
        })
      }
      if (game.phase !== 'over') isReported = false
      s.setState({ ...prev, game })
    }
    const queue = (prev: TableState, cmd: NetCmd) => s.setState({ ...prev, pending: [...prev.pending, cmd].slice(-20) })

    s.setState({
      game: newGame(randomSeed(), props.rank),
      seq: props.seq,
      rank: props.rank,
      role: null,
      inSeq: 0,
      pending: [],
      sy: props.scale.y,
    })
    s.every(TICK_MS, () => {
      const st = s.state
      if (st === undefined) return
      if (st.role === 'guest') {
        s.post({ type: 'net', cmds: st.pending })
        if (st.pending.length > 0) s.setState({ ...st, pending: [] })
        return
      }
      const next = step(st.game)
      if (st.role === 'host') {
        s.post({ type: 'net', snap: next })
        s.setState({ ...st, game: next })
        return
      }
      apply(next)
    })
    s.onKey(event => {
      const st = s.state
      if (st === undefined) return
      const action = keyAction(event.key, st.role === null ? st.game.mode : '1p')
      if (action === undefined) return
      if (st.role === 'guest') {
        if (isNetCmd(action.cmd)) queue(st, action.cmd)
        return
      }
      apply(command(st.game, action.cmd, action.side))
    })
    s.onPointer(event => {
      const st = s.state
      if (st === undefined) return
      const isClick = event.type === 'down' && event.button === 'left'
      if (st.role === 'guest') {
        if (isClick) queue(st, 'shoot')
        return
      }
      const y = Math.floor((event.y - 2) / st.sy)
      if (event.type === 'move' && y >= 0 && y < H) apply(aimAt(st.game, y))
      if (isClick) apply(command(aimAt(st.game, y), 'shoot'))
    })
  }

  const role: Role = props.net?.role ?? null
  let state = s.state ?? { game: newGame(0, props.rank), seq: props.seq, rank: props.rank, role: null, inSeq: 0, pending: [], sy: props.scale.y }
  let isChanged = false
  if (role !== state.role) {
    const game =
      role === 'host' ? newGame(randomSeed(), 0, 'online') : role === 'guest' ? newGame(0, 0, 'online') : newGame(randomSeed(), props.rank)
    state = { ...state, role, game, inSeq: props.net?.inSeq ?? 0, pending: [] }
    isChanged = true
  }
  if (role === 'host' && props.net !== null && props.net.inSeq !== state.inSeq) {
    let game = state.game
    for (const cmd of parseNetCmds(props.net.cmds)) game = command(game, cmd, 'cpu')
    state = { ...state, game, inSeq: props.net.inSeq }
    isChanged = true
  }
  if (props.seq !== state.seq) {
    if (role === 'guest') {
      if (isNetCmd(props.cmd)) state = { ...state, pending: [...state.pending, props.cmd] }
    } else if (props.cmd !== 'none') {
      state = { ...state, game: command(state.game, props.cmd) }
    }
    state = { ...state, seq: props.seq }
    isChanged = true
  }
  if (props.rank !== state.rank || props.scale.y !== state.sy) {
    state = { ...state, rank: props.rank, sy: props.scale.y }
    isChanged = true
  }
  if (isChanged) s.setState(state)

  const net = props.net
  const g = role === 'guest' ? (parseSnap(net?.snap) ?? state.game) : state.game
  const blue = net ? `${net.blue}${role === 'host' ? ' (you)' : ''}` : g.mode === '2p' ? 'BLUE' : 'YOU'
  const red = net ? `${net.red}${role === 'guest' ? ' (you)' : ''}` : g.mode === '2p' ? 'RED' : rankAt(g.rank).name.toUpperCase()
  const holdLeft = g.hold ? Math.ceil(((HOLD_MAX - g.hold.ticks) / HOLD_MAX) * 5) : 0
  const shake = g.phase === 'goal' && g.wait > GOAL_PAUSE - 12 && g.wait % 2 === 0 ? ' ' : ''

  return (
    <Box flexDirection="column">
      <Text>
        <Text color="#82b1ff" bold>
          {blue} {g.you}
        </Text>
        <Text bold> : </Text>
        <Text color="#ff8a80" bold>
          {g.cpu} {red}
        </Text>
        <Text dimColor> · first to {TARGET}</Text>
        {g.shotKmh > 0 && <Text color="#ffeb3b"> · ⚡{g.shotKmh} km/h</Text>}
        {g.hold && (
          <Text color={g.hold.side === 'you' ? '#82b1ff' : '#ff8a80'}>
            {' · ⏱ '}
            {'▰'.repeat(holdLeft)}
            {'▱'.repeat(5 - holdLeft)}
          </Text>
        )}
      </Text>
      {grid(g, props.scale).map(row => (
        <Text>
          {shake !== '' && <Text>{shake}</Text>}
          {runs(row).map(run => (
            <Text {...STYLES[run.style]}>{run.text}</Text>
          ))}
        </Text>
      ))}
      <Text
        bold={g.quipTicks > 0 || g.phase !== 'play'}
        color={g.quipTicks > 0 ? '#ffeb3b' : undefined}
        dimColor={g.quipTicks === 0 && g.phase === 'play'}
      >
        {footer(g, net)}
      </Text>
    </Box>
  )
}

export default Table
