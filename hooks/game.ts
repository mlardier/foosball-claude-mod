export const W = 61
export const H = 17
export const GOAL_TOP = 5
export const GOAL_BOTTOM = 11
export const TARGET = 5
export const TICK_MS = 50
export const HOLD_MAX = 100
export const GOAL_PAUSE = 40

const TRAP_SPEED = 1.2
const ASSIST = 0.22
const MIN_VX = 0.25
const KMH = 48
const MOVING_TICKS = 4
const GOAL_C = (GOAL_TOP + GOAL_BOTTOM) / 2
const MID_Y = (H - 1) / 2

export type Side = 'you' | 'cpu'
export type Role = 'keeper' | 'defense' | 'mid' | 'attack'
export type Mode = '1p' | '2p' | 'online'
export type Phase = 'ready' | 'play' | 'paused' | 'goal' | 'over'
export type Command = 'up' | 'down' | 'shoot' | 'pause' | 'restart' | 'mode'
export type NetCmd = 'up' | 'down' | 'shoot'
export type ShotKind = 'shot' | 'snake' | 'pass' | 'clear' | 'onetouch' | 'block' | 'timeout'
export type GoalLabel = 'GOAL' | 'SNAKE SHOT' | 'BANK SHOT' | 'ONE-TOUCH' | 'FROM DOWNTOWN' | 'OWN GOAL'

export type Rod = { side: Side; role: Role; x: number; men: number; gap: number; min: number; max: number }

export const RODS: readonly Rod[] = [
  { side: 'you', role: 'keeper', x: 4, men: 1, gap: 0, min: 4, max: 12 },
  { side: 'you', role: 'defense', x: 11, men: 2, gap: 8, min: 0, max: 8 },
  { side: 'cpu', role: 'attack', x: 21, men: 3, gap: 6, min: 0, max: 4 },
  { side: 'you', role: 'mid', x: 25, men: 5, gap: 3, min: 0, max: 4 },
  { side: 'cpu', role: 'mid', x: 35, men: 5, gap: 3, min: 0, max: 4 },
  { side: 'you', role: 'attack', x: 39, men: 3, gap: 6, min: 0, max: 4 },
  { side: 'cpu', role: 'defense', x: 49, men: 2, gap: 8, min: 0, max: 8 },
  { side: 'cpu', role: 'keeper', x: 56, men: 1, gap: 0, min: 4, max: 12 },
]

const ROD_IDS: Record<Side, readonly number[]> = { you: [0, 1, 3, 5], cpu: [2, 4, 6, 7] }
const MID_ROD: Record<Side, number> = { you: 3, cpu: 4 }
const DIR: Record<Side, number> = { you: 1, cpu: -1 }

export type Rank = {
  name: string
  speed: number
  err: number
  react: readonly [number, number]
  power: number
  kick: number
  bank: number
  snake: number
  blind: number
}

const ROOKIE: Rank = {
  name: 'Rookie',
  speed: 0.2,
  err: 2.8,
  react: [26, 46],
  power: 1.4,
  kick: 0.05,
  bank: 0,
  snake: 0.25,
  blind: 9,
}

export const RANKS: readonly Rank[] = [
  ROOKIE,
  { name: 'Pub Regular', speed: 0.29, err: 1.9, react: [20, 36], power: 1.5, kick: 0.12, bank: 0.05, snake: 0.35, blind: 7 },
  { name: 'Club Player', speed: 0.38, err: 1.4, react: [14, 28], power: 1.6, kick: 0.18, bank: 0.1, snake: 0.45, blind: 6 },
  { name: 'Pro', speed: 0.46, err: 1.0, react: [10, 22], power: 1.7, kick: 0.25, bank: 0.18, snake: 0.55, blind: 5 },
  { name: 'Legend', speed: 0.5, err: 0.75, react: [8, 18], power: 1.8, kick: 0.3, bank: 0.25, snake: 0.65, blind: 5 },
]

export type Hold = { side: Side; rod: number; man: number; ticks: number }
export type Touch = { side: Side; kind: ShotKind; rod: number; bounces: number }
export type Plan = { wait: number; motion: number; moveTicks: number }

export type Game = {
  phase: Phase
  mode: Mode
  rank: number
  tick: number
  you: number
  cpu: number
  bx: number
  by: number
  vx: number
  vy: number
  offsets: number[]
  youKick: number
  cpuKick: number
  youMotion: number
  cpuMotion: number
  youMotionAge: number
  cpuMotionAge: number
  hold: Hold | null
  touch: Touch | null
  plan: Plan | null
  err: number
  cpuBlind: number
  wait: number
  seed: number
  trail: number[]
  shotKmh: number
  fastestKmh: number
  scorer: Side | null
  label: GoalLabel | null
  quip: string
  quipTicks: number
  goals: GoalLabel[]
  maxDeficit: number
}

const QUIPS: Record<GoalLabel | 'save' | 'timeout' | 'steal', readonly string[]> = {
  GOAL: ['Top bins!', 'Clinical.', 'Right in the corner.', 'The keeper never moved.', 'Back of the net!'],
  'SNAKE SHOT': ['Sssssnake!', 'Wristy!', 'That bent like a banana.', 'Pure snake venom.'],
  'BANK SHOT': ['Off the wall and in!', 'Geometry class pays off.', 'Billiards, anyone?'],
  'ONE-TOUCH': ['First time! Unreal.', "Didn't even stop it.", 'Volley!'],
  'FROM DOWNTOWN': ['From the back?!', 'Long-range missile!', 'Cheeky, cheeky.'],
  'OWN GOAL': ['Oh no. Own goal.', 'Wrong net!', 'That one will haunt someone.'],
  save: ['What a save!', 'Denied!', 'Not today.', 'Wall.'],
  timeout: ['Too slow: 5-second rule!'],
  steal: ['Picked off!', 'Intercepted!', 'Stolen!'],
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

export function rodAt(i: number): Rod {
  const rod = RODS[i]
  if (rod === undefined) throw new Error(`no rod ${i}`)
  return rod
}

export const rankAt = (i: number): Rank => RANKS[clamp(i, 0, RANKS.length - 1)] ?? ROOKIE

function rand(g: Game): number {
  g.seed = (Math.imul(g.seed, 1664525) + 1013904223) >>> 0
  return g.seed / 4294967296
}

function say(g: Game, key: keyof typeof QUIPS, ticks: number): void {
  const list = QUIPS[key]
  g.quip = list[Math.floor(rand(g) * list.length)] ?? ''
  g.quipTicks = ticks
}

export function menY(rod: Rod, offset: number): number[] {
  const o = Math.round(clamp(offset, rod.min, rod.max))
  return Array.from({ length: rod.men }, (_, i) => o + i * rod.gap)
}

const offsetOf = (g: Game, i: number) => g.offsets[i] ?? 0
export const menOf = (g: Game, i: number) => menY(rodAt(i), offsetOf(g, i))
export const kmh = (vx: number, vy: number) => Math.round(Math.hypot(vx, vy) * KMH)

export function isMoving(g: Game, side: Side): number {
  const age = side === 'you' ? g.youMotionAge : g.cpuMotionAge
  return age <= MOVING_TICKS ? (side === 'you' ? g.youMotion : g.cpuMotion) : 0
}

function bestOffset(rod: Rod, y: number, current: number): number {
  let best = current
  let bestErr = Infinity
  for (let i = 0; i < rod.men; i++) {
    const cand = clamp(y - i * rod.gap, rod.min, rod.max)
    const err = Math.abs(y - (cand + i * rod.gap)) + Math.abs(cand - current) * 0.01
    if (err < bestErr) {
      bestErr = err
      best = cand
    }
  }
  return best
}

function moveToward(g: Game, i: number, target: number, speed: number): void {
  const cur = offsetOf(g, i)
  g.offsets[i] = cur + clamp(target - cur, -speed, speed)
}

function setMotion(g: Game, side: Side, motion: number): void {
  if (side === 'you') {
    g.youMotion = motion
    g.youMotionAge = 0
  } else {
    g.cpuMotion = motion
    g.cpuMotionAge = 0
  }
}

export function activeRod(g: Game, side: Side): number {
  if (g.hold?.side === side) return g.hold.rod
  const ids = ROD_IDS[side]
  if (side === 'you') {
    const behind = ids.filter(i => rodAt(i).x <= g.bx + 0.5)
    return behind[behind.length - 1] ?? 0
  }
  return ids.find(i => rodAt(i).x >= g.bx - 0.5) ?? 7
}

function predictY(g: Game, x: number): number {
  if (g.vx === 0) return g.by
  const t = (x - g.bx) / g.vx
  if (t < 0) return g.by
  const period = 2 * (H - 1)
  const m = (((g.by + g.vy * t) % period) + period) % period
  return m > H - 1 ? period - m : m
}

function placeHeld(g: Game): void {
  if (g.hold === null) return
  const rod = rodAt(g.hold.rod)
  g.bx = rod.x + DIR[rod.side]
  g.by = menOf(g, g.hold.rod)[g.hold.man] ?? g.by
}

function holdBall(g: Game, side: Side, rod: number, man: number): void {
  g.hold = { side, rod, man, ticks: 0 }
  g.plan = null
  g.vx = 0
  g.vy = 0
  g.trail = []
  placeHeld(g)
}

function kickoff(g: Game, side: Side): void {
  g.phase = 'play'
  g.touch = null
  holdBall(g, side, MID_ROD[side], 2)
}

function powerOf(g: Game, side: Side, role: Role): number {
  if (role === 'mid') return 1.05
  if (role !== 'attack') return 1.45
  return side === 'cpu' && g.mode === '1p' ? rankAt(g.rank).power : 1.85
}

function recordShot(g: Game, side: Side): void {
  g.shotKmh = kmh(g.vx, g.vy)
  if (side === 'you' || g.mode !== '1p') g.fastestKmh = Math.max(g.fastestKmh, g.shotKmh)
}

function shoot(g: Game, side: Side, aimedVy?: number): void {
  if (g.hold?.side !== side) return
  const r = g.hold.rod
  const rod = rodAt(r)
  const dir = DIR[side]
  const moving = isMoving(g, side)
  g.vx = dir * powerOf(g, side, rod.role)
  g.vy = clamp(aimedVy ?? moving * 0.6 + (rand(g) - 0.5) * 0.1, -0.9, 0.9)
  g.bx = rod.x + dir * 1.2
  g.hold = null
  g.plan = null
  const kind: ShotKind =
    rod.role === 'mid' ? 'pass' : rod.role === 'attack' ? (moving !== 0 ? 'snake' : 'shot') : 'clear'
  g.touch = { side, kind, rod: r, bounces: 0 }
  recordShot(g, side)
  blindCpu(g, side)
}

function blindCpu(g: Game, side: Side): void {
  if (side === 'you') g.cpuBlind = rankAt(g.rank).blind
}

function contact(g: Game, r: number, man: number): void {
  const rod = rodAt(r)
  const side = rod.side
  const dir = DIR[side]
  const speed = Math.hypot(g.vx, g.vy)
  const manY = menOf(g, r)[man] ?? g.by
  const isKick = (side === 'you' ? g.youKick : g.cpuKick) > 0
  const isStolen = g.touch !== null && g.touch.side !== side
  g.err = (rand(g) - 0.5) * 2 * rankAt(g.rank).err

  if (isKick) {
    g.vx = dir * 1.6
    g.vy = clamp(isMoving(g, side) * 0.5 + (g.by - manY) * 0.3, -0.9, 0.9)
    g.bx = rod.x + dir * 0.7
    g.touch = { side, kind: 'onetouch', rod: r, bounces: 0 }
    recordShot(g, side)
    blindCpu(g, side)
    if (side === 'you') g.youKick = 0
    else g.cpuKick = 0
    return
  }
  if (speed < TRAP_SPEED) {
    if (isStolen && g.touch?.kind === 'pass') say(g, 'steal', 30)
    holdBall(g, side, r, man)
    return
  }
  if (rod.role === 'keeper' && isStolen) say(g, 'save', 35)
  g.vx = dir * speed * 0.45
  g.vy = clamp((g.by - manY) * 0.4 + g.vy * 0.3, -0.9, 0.9)
  g.bx = rod.x + dir * 0.7
  g.touch = { side, kind: 'block', rod: r, bounces: 0 }
  blindCpu(g, side)
}

function goalLabel(g: Game, scorer: Side): GoalLabel {
  const t = g.touch
  if (t === null) return 'GOAL'
  if (t.side !== scorer) return 'OWN GOAL'
  if (t.kind === 'onetouch') return 'ONE-TOUCH'
  if (t.kind === 'snake') return 'SNAKE SHOT'
  if (t.bounces > 0) return 'BANK SHOT'
  const role = rodAt(t.rod).role
  if (role === 'keeper' || role === 'defense') return 'FROM DOWNTOWN'
  return 'GOAL'
}

function score(g: Game, scorer: Side): void {
  const label = goalLabel(g, scorer)
  if (scorer === 'you') {
    g.you += 1
    g.goals.push(label)
  } else {
    g.cpu += 1
  }
  g.maxDeficit = Math.max(g.maxDeficit, g.cpu - g.you)
  g.label = label
  g.scorer = scorer
  g.phase = 'goal'
  g.wait = GOAL_PAUSE
  g.hold = null
  g.vx = 0
  g.vy = 0
  g.trail = []
  say(g, label, 70)
}

function cpuAimVy(g: Game): number {
  const hold = g.hold
  if (hold === null) return 0
  const rod = rodAt(hold.rod)
  if (rod.role === 'mid') return (rand(g) - 0.5) * 0.6
  const t = Math.max(1, g.bx / powerOf(g, 'cpu', rod.role))
  let ty = GOAL_C + (rand(g) - 0.5) * 3.5 + g.err
  if (rand(g) < rankAt(g.rank).bank) ty = g.by < MID_Y ? -ty : 2 * (H - 1) - ty
  return (ty - g.by) / t
}

function cpuThink(g: Game): void {
  const rank = rankAt(g.rank)
  const hold = g.hold

  if (hold?.side === 'cpu') {
    if (g.plan === null) {
      const [lo, hi] = rank.react
      const isSnake = rodAt(hold.rod).role === 'attack' && rand(g) < rank.snake
      g.plan = {
        wait: Math.round(lo + rand(g) * (hi - lo)),
        motion: isSnake ? (rand(g) < 0.5 ? -1 : 1) : 0,
        moveTicks: isSnake ? 2 + Math.floor(rand(g) * 4) : 0,
      }
    }
    const plan = g.plan
    if (plan.wait > 0) {
      plan.wait -= 1
    } else if (plan.moveTicks > 0) {
      const rod = rodAt(hold.rod)
      const before = offsetOf(g, hold.rod)
      g.offsets[hold.rod] = clamp(before + plan.motion * 0.5, rod.min, rod.max)
      if (g.offsets[hold.rod] === before) {
        plan.moveTicks = 0
      } else {
        setMotion(g, 'cpu', plan.motion)
        plan.moveTicks -= 1
      }
    } else {
      shoot(g, 'cpu', cpuAimVy(g))
    }
    return
  }

  const active = activeRod(g, 'cpu')
  const rod = rodAt(active)
  const target = g.vx > 0 && g.cpuBlind === 0 ? predictY(g, rod.x) + g.err : g.by
  moveToward(g, active, bestOffset(rod, target, offsetOf(g, active)), rank.speed)

  const ahead = rod.x - g.bx
  if (g.cpuKick === 0 && g.vx > 0.3 && ahead > 0 && ahead < 3) {
    const isNear = menOf(g, active).some(y => Math.abs(predictY(g, rod.x) - y) < 1.2)
    if (isNear && rand(g) < rank.kick) g.cpuKick = 4
  }
}

function assist(g: Game): void {
  for (const side of ['you', 'cpu'] as const) {
    const active = activeRod(g, side)
    const speed = side === 'cpu' && g.mode === '1p' ? rankAt(g.rank).speed * 0.6 : ASSIST
    for (const i of ROD_IDS[side]) {
      if (i === active || g.hold?.rod === i) continue
      moveToward(g, i, bestOffset(rodAt(i), g.by, offsetOf(g, i)), speed)
    }
  }
}

function clone(g: Game): Game {
  return {
    ...g,
    offsets: [...g.offsets],
    trail: [...g.trail],
    goals: [...g.goals],
    hold: g.hold && { ...g.hold },
    touch: g.touch && { ...g.touch },
    plan: g.plan && { ...g.plan },
  }
}

export function newGame(seed: number, rank = 0, mode: Mode = '1p'): Game {
  return {
    phase: 'ready',
    mode,
    rank: clamp(rank, 0, RANKS.length - 1),
    tick: 0,
    you: 0,
    cpu: 0,
    bx: (W - 1) / 2,
    by: MID_Y,
    vx: 0,
    vy: 0,
    offsets: RODS.map(rod => (rod.min + rod.max) / 2),
    youKick: 0,
    cpuKick: 0,
    youMotion: 0,
    cpuMotion: 0,
    youMotionAge: 99,
    cpuMotionAge: 99,
    hold: null,
    touch: null,
    plan: null,
    err: 0,
    cpuBlind: 0,
    wait: 0,
    seed: seed >>> 0,
    trail: [],
    shotKmh: 0,
    fastestKmh: 0,
    scorer: null,
    label: null,
    quip: '',
    quipTicks: 0,
    goals: [],
    maxDeficit: 0,
  }
}

function humanMove(g: Game, side: Side, delta: number): void {
  if (g.phase !== 'play') return
  const r = activeRod(g, side)
  const rod = rodAt(r)
  const cur = Math.round(offsetOf(g, r))
  const next = clamp(cur + delta, rod.min, rod.max)
  g.offsets[r] = next
  if (next !== cur) setMotion(g, side, Math.sign(delta))
  if (g.hold?.rod === r) placeHeld(g)
}

export function command(prev: Game, cmd: Command, side: Side = 'you'): Game {
  const g = clone(prev)
  switch (cmd) {
    case 'up':
      humanMove(g, side, -1)
      break
    case 'down':
      humanMove(g, side, 1)
      break
    case 'shoot':
      if (g.phase === 'ready') {
        kickoff(g, 'you')
      } else if (g.phase === 'over') {
        const next = newGame(g.seed, g.rank, g.mode)
        kickoff(next, 'you')
        return next
      } else if (g.phase === 'paused') {
        g.phase = 'play'
      } else if (g.phase === 'play') {
        if (g.hold?.side === side) shoot(g, side)
        else if (side === 'you' && g.youKick === 0) g.youKick = 4
        else if (side === 'cpu' && g.cpuKick === 0) g.cpuKick = 4
      }
      break
    case 'pause':
      if (g.phase === 'play') g.phase = 'paused'
      else if (g.phase === 'paused') g.phase = 'play'
      break
    case 'restart':
      return newGame(g.seed, g.rank, g.mode)
    case 'mode':
      if (g.mode !== 'online' && g.phase !== 'play' && g.phase !== 'goal') {
        return newGame(g.seed, g.rank, g.mode === '1p' ? '2p' : '1p')
      }
      break
  }
  return g
}

export function aimAt(prev: Game, y: number): Game {
  if (prev.phase !== 'play') return prev
  const g = clone(prev)
  const r = activeRod(g, 'you')
  const rod = rodAt(r)
  const cur = Math.round(offsetOf(g, r))
  const target = g.hold?.rod === r ? clamp(y - g.hold.man * rod.gap, rod.min, rod.max) : bestOffset(rod, y, cur)
  g.offsets[r] = Math.round(target)
  if (g.offsets[r] !== cur) setMotion(g, 'you', Math.sign(target - cur))
  if (g.hold?.rod === r) placeHeld(g)
  return g
}

export function withRank(prev: Game, rank: number): Game {
  return prev.rank === rank ? prev : { ...prev, rank: clamp(rank, 0, RANKS.length - 1) }
}

export function step(prev: Game): Game {
  const g = clone(prev)
  g.quipTicks = Math.max(0, g.quipTicks - 1)

  if (g.phase === 'goal') {
    g.wait -= 1
    if (g.wait > 0) return g
    if (g.you >= TARGET || g.cpu >= TARGET) {
      g.phase = 'over'
      return g
    }
    kickoff(g, g.scorer === 'you' ? 'cpu' : 'you')
    return g
  }
  if (g.phase !== 'play') return g

  g.tick += 1
  g.youKick = Math.max(0, g.youKick - 1)
  g.cpuKick = Math.max(0, g.cpuKick - 1)
  g.cpuBlind = Math.max(0, g.cpuBlind - 1)
  g.youMotionAge += 1
  g.cpuMotionAge += 1

  if (g.mode === '1p') cpuThink(g)
  assist(g)

  if (g.hold !== null) {
    g.hold.ticks += 1
    placeHeld(g)
    if (g.hold.ticks > HOLD_MAX) {
      const side = g.hold.side
      g.touch = { side, kind: 'timeout', rod: g.hold.rod, bounces: 0 }
      g.hold = null
      g.vx = DIR[side] * 0.5
      g.vy = (rand(g) - 0.5) * 0.3
      g.bx += DIR[side] * 0.2
      say(g, 'timeout', 40)
    }
    return g
  }

  const subs = Math.max(1, Math.ceil(Math.max(Math.abs(g.vx), Math.abs(g.vy)) / 0.5))
  for (let s = 0; s < subs && g.hold === null; s++) {
    const px = g.bx
    g.bx += g.vx / subs
    g.by += g.vy / subs

    if (g.by < 0 || g.by > H - 1) {
      g.by = g.by < 0 ? -g.by : 2 * (H - 1) - g.by
      g.vy = -g.vy
      if (g.touch !== null) g.touch.bounces += 1
    }

    if (g.bx < 0 || g.bx > W - 1) {
      if (g.by >= GOAL_TOP - 0.5 && g.by <= GOAL_BOTTOM + 0.5) {
        score(g, g.bx < 0 ? 'cpu' : 'you')
        return g
      }
      g.bx = g.bx < 0 ? -g.bx : 2 * (W - 1) - g.bx
      g.vx = -g.vx
    }

    for (let r = 0; r < RODS.length; r++) {
      const rod = rodAt(r)
      if (Math.min(px, g.bx) > rod.x + 0.5 || Math.max(px, g.bx) < rod.x - 0.5) continue
      const man = menOf(g, r).findIndex(y => Math.abs(g.by - y) < 0.8)
      if (man === -1) continue
      contact(g, r, man)
      break
    }
  }

  if (g.hold === null) {
    g.vx *= 0.992
    g.vy *= 0.992
    if (Math.abs(g.vx) < MIN_VX) g.vx = g.vx < 0 ? -MIN_VX : MIN_VX
    g.trail = Math.hypot(g.vx, g.vy) > 1.1 ? [...g.trail, g.bx, g.by].slice(-8) : g.trail.slice(2)
  }
  return g
}

const PHASES: readonly Phase[] = ['ready', 'play', 'paused', 'goal', 'over']
const LABELS: readonly GoalLabel[] = ['GOAL', 'SNAKE SHOT', 'BANK SHOT', 'ONE-TOUCH', 'FROM DOWNTOWN', 'OWN GOAL']
const KINDS: readonly ShotKind[] = ['shot', 'snake', 'pass', 'clear', 'onetouch', 'block', 'timeout']
const NET_CMDS: readonly NetCmd[] = ['up', 'down', 'shoot']

const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? clamp(v, lo, hi) : fallback
const int = (v: unknown, lo: number, hi: number, fallback: number) => Math.round(num(v, lo, hi, fallback))
const oneOf = <T extends string>(v: unknown, list: readonly T[], fallback: T): T =>
  list.find(item => item === v) ?? fallback
const side = (v: unknown): Side | null => (v === 'you' || v === 'cpu' ? v : null)
const obj = (v: unknown): Record<string, unknown> | null =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : null

/** Rebuilds a game state received from another machine, keeping only well-formed, in-range fields. */
export function parseSnap(value: unknown): Game | null {
  const v = obj(value)
  if (v === null) return null
  const g = newGame(0, 0, 'online')
  const hold = obj(v.hold)
  const touch = obj(v.touch)
  const holdRod = int(hold?.rod, 0, RODS.length - 1, 0)
  const holdSide = side(hold?.side)
  return {
    ...g,
    phase: oneOf(v.phase, PHASES, 'ready'),
    tick: int(v.tick, 0, 1e9, 0),
    you: int(v.you, 0, TARGET, 0),
    cpu: int(v.cpu, 0, TARGET, 0),
    bx: num(v.bx, -2, W + 1, g.bx),
    by: num(v.by, 0, H - 1, g.by),
    vx: num(v.vx, -3, 3, 0),
    vy: num(v.vy, -3, 3, 0),
    offsets: RODS.map((rod, i) => num(Array.isArray(v.offsets) ? v.offsets[i] : undefined, rod.min, rod.max, g.offsets[i] ?? rod.min)),
    youKick: int(v.youKick, 0, 10, 0),
    cpuKick: int(v.cpuKick, 0, 10, 0),
    hold: holdSide ? { side: holdSide, rod: holdRod, man: int(hold?.man, 0, rodAt(holdRod).men - 1, 0), ticks: int(hold?.ticks, 0, HOLD_MAX + 1, 0) } : null,
    touch: touch && side(touch.side)
      ? { side: side(touch.side) ?? 'you', kind: oneOf(touch.kind, KINDS, 'shot'), rod: int(touch.rod, 0, RODS.length - 1, 0), bounces: int(touch.bounces, 0, 99, 0) }
      : null,
    wait: int(v.wait, 0, GOAL_PAUSE, 0),
    trail: Array.isArray(v.trail) ? v.trail.slice(0, 8).map(n => num(n, -2, W + 1, 0)) : [],
    shotKmh: int(v.shotKmh, 0, 999, 0),
    fastestKmh: int(v.fastestKmh, 0, 999, 0),
    scorer: side(v.scorer),
    label: LABELS.find(l => l === v.label) ?? null,
    quip: typeof v.quip === 'string' ? v.quip.replace(/[^\p{L}\p{N}\p{P}\p{Zs}]/gu, '').slice(0, 60) : '',
    quipTicks: int(v.quipTicks, 0, 100, 0),
    goals: Array.isArray(v.goals) ? v.goals.slice(0, TARGET).map(l => oneOf(l, LABELS, 'GOAL')) : [],
  }
}

export const parseNetCmds = (value: unknown): NetCmd[] =>
  Array.isArray(value) ? value.slice(0, 20).flatMap(c => NET_CMDS.filter(n => n === c)) : []
