import { expect, test } from 'claude-code/testing'

import { W, command, menOf, newGame, rodAt } from '../hooks/game'
import { grid } from '../hooks/table'

const find = (rows: { ch: string }[][], ch: string) => {
  for (let r = 0; r < rows.length; r++) {
    const c = rows[r]?.findIndex(cell => cell.ch === ch) ?? -1
    if (c !== -1) return { row: r, col: c }
  }
  return null
}

for (const s of [1, 2]) {
  test(`kick-off ball sits on the centre line and the mid men's row at scale ${s}`, async () => {
    const rows = grid(newGame(1), { x: s, y: s })
    const ball = find(rows, '●')
    expect(ball).not.toBeNull()
    expect(rows[ball?.row ?? 0]?.[(ball?.col ?? 0)]?.style).toBe('ball')
    const lineCol = rows[1]?.findIndex(cell => cell.ch === '┊')
    expect(ball?.col).toBe(lineCol)
    const midRod = rodAt(3)
    const manCol = 1 + midRod.x * s + Math.floor(s / 2)
    expect(rows[ball?.row ?? 0]?.[manCol]?.ch).toBe('█')
  })

  test(`a held ball touches its man's foot at scale ${s}`, async () => {
    const g = command(newGame(1), 'shoot')
    const rows = grid(g, { x: s, y: s })
    const ball = find(rows, '●')
    const rod = rodAt(3)
    const centre = 1 + rod.x * s + Math.floor(s / 2)
    expect(ball?.col).toBe(centre + Math.ceil(s / 2))
    const manRow = 1 + (menOf(g, 3)[2] ?? 0) * s + Math.floor(s / 2)
    expect(ball?.row).toBe(manRow)
  })
}

test('the table is as wide as the scaled field plus its walls', async () => {
  const rows = grid(newGame(1), { x: 2, y: 2 })
  expect(rows[0]?.length).toBe(W * 2 + 2)
})
