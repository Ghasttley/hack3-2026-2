import type { Bin, Cell, Rules } from '../../lib/types'
import type { TileStore } from './tiles'

export interface Group {
  cells: Cell[]
  size: number
  /** Caja según las reglas, o null si es ruido. */
  bin: Bin | null
  noise: boolean
  /** El grupo ya está refinado (sus celdas tienen caja). */
  refined: boolean
  /** true si se cortó la búsqueda por superar maxGroupSize. */
  truncated: boolean
  key: string
}

const N4: [number, number][] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
]
const N8: [number, number][] = [...N4, [-1, -1], [-1, 1], [1, -1], [1, 1]]

export function isScary(tremor: number, rules: Rules): boolean {
  return tremor >= rules.tremorThreshold
}

/** Caja según las reglas del archivo (se leen de /files/{id}/rules, nunca se hardcodean). */
export function binFor(digits: number[], rules: Rules): Bin {
  const idx =
    rules.binning.strategy === 'DIGIT_SUM_MOD'
      ? digits.reduce((a, d) => a + d, 0) % 4
      : Math.max(...digits) % 4
  const bin = rules.binning.order[idx]
  if (!bin) throw new Error('Orden de cajas inválido')
  return bin
}

/**
 * Grupo = conjunto MÁXIMO de celdas conectadas que dan miedo (BFS con conectividad 4 u 8).
 * Si el grupo cruza bloques que no están cargados, los pide (fijados) y sigue.
 * Si supera maxGroupSize, ya es ruido: se corta la búsqueda.
 */
export async function findGroup(store: TileStore, rules: Rules, start: Cell, signal: AbortSignal): Promise<Group | null> {
  const first = await cellAt(store, start.r, start.c)
  if (!first || !isScary(first.tremor, rules)) return null

  const dirs = rules.connectivity === 8 ? N8 : N4
  const seen = new Set<number>()
  const id = (r: number, c: number) => r * store.cols + c
  const queue: Cell[] = [start]
  const cells: Cell[] = []
  const digits: number[] = []
  let refined = false
  let truncated = false
  seen.add(id(start.r, start.c))
  const pinned: [number, number][] = []

  try {
    while (queue.length > 0) {
      if (signal.aborted) throw new DOMException('Abortado', 'AbortError')
      const cur = queue.shift()
      if (!cur) break
      let info = store.getCell(cur.r, cur.c)
      if (!info) {
        const [tr, tc] = store.tileOf(cur.r, cur.c)
        pinned.push([tr, tc])
        await store.ensure(tr, tc, { pin: true })
        info = store.getCell(cur.r, cur.c)
      }
      if (!info || !isScary(info.tremor, rules)) continue
      cells.push(cur)
      digits.push(info.digit)
      if (info.bin !== '.') refined = true
      if (cells.length > rules.maxGroupSize) {
        truncated = true
        break
      }
      for (const [dr, dc] of dirs) {
        const r = cur.r + dr
        const c = cur.c + dc
        if (r < 0 || c < 0 || r >= store.rows || c >= store.cols) continue
        const k = id(r, c)
        if (seen.has(k)) continue
        seen.add(k)
        queue.push({ r, c })
      }
    }
  } finally {
    for (const [tr, tc] of pinned) store.unpin(tr, tc)
  }

  const size = cells.length
  const noise = truncated || size < rules.minGroupSize || size > rules.maxGroupSize
  cells.sort((a, b) => a.r - b.r || a.c - b.c)
  return {
    cells,
    size,
    bin: noise ? null : binFor(digits, rules),
    noise,
    refined,
    truncated,
    key: cells.map((x) => `${x.r},${x.c}`).join(';'),
  }
}

async function cellAt(store: TileStore, r: number, c: number) {
  const info = store.getCell(r, c)
  if (info) return info
  const [tr, tc] = store.tileOf(r, c)
  await store.ensure(tr, tc, { pin: true })
  store.unpin(tr, tc)
  return store.getCell(r, c)
}
