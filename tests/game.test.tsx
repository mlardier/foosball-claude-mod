import { expect, test } from 'claude-code/testing'

import { GOAL_PAUSE, H, HOLD_MAX, RODS, TARGET, W, command, menOf, newGame, parseNetCmds, parseSnap, step } from '../hooks/game'
import type { Command, Game } from '../hooks/game'

const run = (g: Game, ticks: number) => {
  let next = g
  for (let i = 0; i < ticks; i++) next = step(next)
  return next
}

const started = (seed = 1) => command(newGame(seed), 'shoot')

test('kick-off hands you the ball on your midfield', async () => {
  const g = started()
  expect(g.phase).toBe('play')
  expect(g.hold).toMatchObject({ side: 'you', rod: 3 })
})

test('a held ball follows the man and a still shot is straight', async () => {
  const g = command(started(), 'down')
  expect(g.by).toBe((menOf(g, 3)[2] ?? 0))
  const shot = command(run(g, 6), 'shoot')
  expect(shot.hold).toBeNull()
  expect(shot.vx).toBeGreaterThan(1)
  expect(Math.abs(shot.vy)).toBeLessThan(0.1)
  expect(shot.touch?.kind).toBe('pass')
})

test('shooting while moving bends the ball: a snake shot', async () => {
  const atAttack: Game = { ...started(), hold: { side: 'you', rod: 5, man: 1, ticks: 0 } }
  const moved = command(step(atAttack), 'up')
  const shot = command(moved, 'shoot')
  expect(shot.touch?.kind).toBe('snake')
  expect(shot.vy).toBeLessThan(-0.4)
})

test('holding too long loses the ball', async () => {
  const g = run(started(), HOLD_MAX + 2)
  expect(g.hold === null || g.hold.side === 'cpu').toBe(true)
})

test('a ball into the CPU goal scores, flashes, then the CPU kicks off', async () => {
  const g: Game = { ...started(), hold: null, bx: W - 2, by: 8, vx: 1.6, vy: 0, offsets: RODS.map(r => r.min) }
  const scored = step(g)
  expect(scored.you).toBe(1)
  expect(scored.phase).toBe('goal')
  expect(scored.quip).not.toBe('')
  const resumed = run(scored, GOAL_PAUSE)
  expect(resumed.phase).toBe('play')
  expect(resumed.hold?.side).toBe('cpu')
})

test('the game ends at the target and a shot starts a rematch', async () => {
  const g: Game = { ...started(), you: TARGET - 1, hold: null, bx: W - 2, by: 8, vx: 1.6, vy: 0, offsets: RODS.map(r => r.min) }
  const over = run(g, GOAL_PAUSE + 1)
  expect(over.phase).toBe('over')
  const rematch = command(over, 'shoot')
  expect(rematch.phase).toBe('play')
  expect(rematch.you).toBe(0)
})

test('random play keeps everything on the table and games finish at every rank', async () => {
  const cmds: Command[] = ['up', 'down', 'shoot', 'up', 'down']
  for (let rank = 0; rank < 5; rank++) {
    let g = command(newGame(rank + 11, rank), 'shoot')
    let finished = 0
    for (let i = 0; i < 40000 && finished < 2; i++) {
      if (i % 3 === 0) g = command(g, cmds[(i * 7) % cmds.length] ?? 'up')
      g = step(g)
      if (g.phase === 'over') {
        finished += 1
        g = command(g, 'shoot')
      }
      expect(g.by).toBeGreaterThanOrEqual(0)
      expect(g.by).toBeLessThanOrEqual(H - 1)
      expect(g.bx).toBeGreaterThanOrEqual(-1)
      expect(g.bx).toBeLessThanOrEqual(W)
    }
    expect(finished).toBe(2)
  }
})

test('2-player mode lets red move and shoot', async () => {
  const g = command(command(newGame(5), 'mode'), 'shoot')
  expect(g.mode).toBe('2p')
  const redHas: Game = { ...g, hold: { side: 'cpu', rod: 4, man: 2, ticks: 0 } }
  const shot = command(redHas, 'shoot', 'cpu')
  expect(shot.vx).toBeLessThan(0)
})

test('the pane draws the table and number keys drive it', async $ => {
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({
      plugin: 'foosball',
      surface,
      component: 'Pane',
      requestId: 'foosball',
      props: {
        title: 'Foosball',
        isFocused: true,
        bodyColumns: 140,
        placement: 'dock',
        scroll: { offset: 0, bodyRows: 46 },
        view: {},
      },
    })
    expect(await ui.find({ type: 'Text', text: /ROOKIE/, in: 'table' })).toBeDefined()
    await ui.press({ key: 'shoot' })
    await ui.advance(200)
    expect(await ui.find({ type: 'Text', text: /Ball is yours/, in: 'table' })).toBeDefined()
    await ui.key({ key: 'p', in: 'table' })
    expect(await ui.find({ type: 'Text', text: /Paused/, in: 'table' })).toBeDefined()
    await ui.unmount()
  }
})

test('a snapshot from the network is rebuilt within bounds', async () => {
  const g = run(command(newGame(9, 0, 'online'), 'shoot'), 30)
  const copy = parseSnap(JSON.parse(JSON.stringify(g)))
  expect(copy?.you).toBe(g.you)
  expect(copy?.offsets).toEqual(g.offsets)
  expect(copy?.hold?.side).toBe(g.hold?.side)

  const hostile = parseSnap({ phase: 'boom', you: 99, by: -50, offsets: ['x', 1e9], hold: { side: 'you', rod: 42, man: 9 }, quip: 'x'.repeat(500), goals: 'nope' })
  expect(hostile?.phase).toBe('ready')
  expect(hostile?.you).toBe(TARGET)
  expect(hostile?.by).toBe(0)
  expect(hostile?.hold?.rod).toBe(RODS.length - 1)
  expect(hostile?.quip.length).toBeLessThanOrEqual(60)
  expect(hostile?.goals).toEqual([])
  expect(parseSnap('not a game')).toBeNull()
  expect(parseNetCmds(['up', 'rm -rf', 'shoot', 7])).toEqual(['up', 'shoot'])
})

test('online mode has no CPU: the red side only moves on commands', async () => {
  let g = command(newGame(4, 0, 'online'), 'shoot')
  g = { ...g, hold: { side: 'cpu', rod: 4, man: 2, ticks: 0 } }
  const before = g.offsets[4]
  g = run(g, 20)
  expect(g.offsets[4]).toBe(before)
  expect(command(g, 'mode').mode).toBe('online')
})
