import { apiRequest } from '../../lib/api'
import { isApiError } from '../../lib/errors'
import type { Bin, Cell, TileResponse } from '../../lib/types'
import { BIN_CHAR } from '../../lib/types'
import { backoff, isAbortError, sleep } from '../../lib/util'

/**
 * Caché de bloques (tiles) de un archivo.
 * - Un bloque se pide solo cuando hace falta (visible o necesario para completar un grupo).
 * - Nunca hay dos requests en vuelo para el mismo bloque (mapa `inflight`).
 * - Se cancelan las requests de bloques que salieron de la vista antes de responder.
 * - 429: nadie pide nada hasta que pase Retry-After (pausa global).
 * - 503 / red: reintento con espera creciente.
 * - Índices de bloque desde 0.
 */

export interface TileData {
  tileRow: number
  tileCol: number
  originRow: number
  originCol: number
  rows: number
  cols: number
  digits: Uint8Array
  tremor: Uint8Array
  bins: Uint8Array // códigos de carácter: '.', 'W', 'F', 'D', 'M'
  version: number
}

export interface CellInfo {
  digit: number
  tremor: number
  bin: string // '.' o W/F/D/M
}

interface Inflight {
  controller: AbortController
  promise: Promise<TileData>
  pins: number
  visible: boolean
}

const DOT = '.'.charCodeAt(0)
const MAX_CONCURRENT = 4

function decodeBase64(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i)
  return out
}

function parseTile(t: TileResponse): TileData {
  const n = t.rows * t.cols
  const digits = new Uint8Array(n)
  for (let i = 0; i < n; i++) digits[i] = t.values.charCodeAt(i) - 48
  const bins = new Uint8Array(n)
  for (let i = 0; i < n; i++) bins[i] = t.bins.charCodeAt(i) || DOT
  return {
    tileRow: t.tileRow,
    tileCol: t.tileCol,
    originRow: t.originRow,
    originCol: t.originCol,
    rows: t.rows,
    cols: t.cols,
    digits,
    tremor: decodeBase64(t.tremor),
    bins,
    version: t.version,
  }
}

export const tileKey = (tr: number, tc: number) => `${tr}:${tc}`

export class TileStore {
  readonly fileId: number
  readonly rows: number
  readonly cols: number
  readonly tileSize: number
  readonly tileRows: number
  readonly tileCols: number

  private tiles = new Map<string, TileData>()
  private inflight = new Map<string, Inflight>()
  private queue: { key: string; run: () => void }[] = []
  private running = 0
  private pausedUntil = 0
  private listeners = new Set<() => void>()
  private version = 0
  requested = 0
  private lastVisible = new Set<string>()
  /** Mensaje para la UI cuando estamos esperando por un 429. */
  waitingUntil = 0

  constructor(fileId: number, rows: number, cols: number, tileSize: number) {
    this.fileId = fileId
    this.rows = rows
    this.cols = cols
    this.tileSize = tileSize
    this.tileRows = Math.ceil(rows / tileSize)
    this.tileCols = Math.ceil(cols / tileSize)
  }

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getVersion = () => this.version

  private notify() {
    this.version++
    this.listeners.forEach((l) => l())
  }

  getTile(tr: number, tc: number): TileData | undefined {
    return this.tiles.get(tileKey(tr, tc))
  }

  tileOf(r: number, c: number): [number, number] {
    return [Math.floor(r / this.tileSize), Math.floor(c / this.tileSize)]
  }

  getCell(r: number, c: number): CellInfo | null {
    if (r < 0 || c < 0 || r >= this.rows || c >= this.cols) return null
    const [tr, tc] = this.tileOf(r, c)
    const t = this.tiles.get(tileKey(tr, tc))
    if (!t) return null
    const i = (r - t.originRow) * t.cols + (c - t.originCol)
    const digit = t.digits[i]
    const tremor = t.tremor[i]
    const bin = t.bins[i]
    if (digit === undefined || tremor === undefined || bin === undefined) return null
    return { digit, tremor, bin: String.fromCharCode(bin) }
  }

  /** Asegura un bloque. `pin` = lo necesita un grupo: no se cancela al salir de la vista. */
  ensure(tr: number, tc: number, opts: { pin?: boolean; visible?: boolean } = {}): Promise<TileData> {
    const key = tileKey(tr, tc)
    const cached = this.tiles.get(key)
    if (cached) return Promise.resolve(cached)
    const existing = this.inflight.get(key)
    if (existing) {
      if (opts.pin) existing.pins++
      if (opts.visible) existing.visible = true
      return existing.promise
    }
    const controller = new AbortController()
    const entry: Inflight = {
      controller,
      pins: opts.pin ? 1 : 0,
      visible: !!opts.visible,
      promise: Promise.resolve() as unknown as Promise<TileData>,
    }
    entry.promise = new Promise<TileData>((resolve, reject) => {
      this.queue.push({
        key,
        run: () => {
          this.fetchTile(tr, tc, controller.signal)
            .then((t) => {
              this.tiles.set(key, t)
              this.notify()
              resolve(t)
            })
            .catch(reject)
            .finally(() => {
              this.inflight.delete(key)
              this.running--
              this.pump()
            })
        },
      })
      controller.signal.addEventListener('abort', () => {
        const idx = this.queue.findIndex((q) => q.key === key)
        if (idx >= 0) {
          this.queue.splice(idx, 1)
          this.inflight.delete(key)
          reject(new DOMException('Abortado', 'AbortError'))
        }
      })
    })
    entry.promise.catch(() => undefined)
    this.inflight.set(key, entry)
    this.pump()
    return entry.promise
  }

  unpin(tr: number, tc: number) {
    const e = this.inflight.get(tileKey(tr, tc))
    if (e && e.pins > 0) e.pins--
  }

  private pump() {
    while (this.running < MAX_CONCURRENT && this.queue.length > 0) {
      const job = this.queue.shift()
      if (!job) break
      this.running++
      job.run()
    }
  }

  private async fetchTile(tr: number, tc: number, signal: AbortSignal): Promise<TileData> {
    for (let attempt = 0; ; attempt++) {
      const wait = this.pausedUntil - Date.now()
      if (wait > 0) await sleep(wait, signal)
      try {
        this.requested++
        const { data } = await apiRequest<TileResponse>(`/files/${this.fileId}/tiles/${tr}/${tc}`, { signal, retries: 0 })
        return parseTile(data)
      } catch (e) {
        if (isAbortError(e) || !isApiError(e)) throw e
        if (e.status === 429) {
          // Respeta Retry-After: pausa global, ningún bloque se pide hasta entonces.
          this.pausedUntil = Date.now() + (e.retryAfterMs ?? 2000)
          this.waitingUntil = this.pausedUntil
          this.notify()
          continue
        }
        if ((e.status === 503 || e.isNetwork) && attempt < 6) {
          await sleep(e.retryAfterMs ?? backoff(attempt), signal)
          continue
        }
        throw e
      }
    }
  }

  /** Bloques visibles: pide los que faltan y cancela los que ya no se ven (salvo los fijados por un grupo). */
  setVisible(keys: Set<string>) {
    this.lastVisible = keys
    for (const [key, entry] of this.inflight) {
      entry.visible = keys.has(key)
      if (!entry.visible && entry.pins === 0) entry.controller.abort()
    }
    for (const key of keys) {
      if (this.tiles.has(key) || this.inflight.has(key)) continue
      const [tr, tc] = key.split(':').map(Number) as [number, number]
      this.ensure(tr, tc, { visible: true }).catch(() => undefined)
    }
  }

  /** Vuelve a pedir bloques (409 ALREADY_REFINED, stream.reset…). */
  invalidate(keys: Iterable<string>) {
    let changed = false
    for (const key of keys) {
      if (this.tiles.delete(key)) changed = true
    }
    if (changed) this.notify()
    this.setVisible(this.lastVisible)
  }

  invalidateAll() {
    this.tiles.clear()
    this.notify()
    this.setVisible(this.lastVisible)
  }

  tilesForCells(cells: Cell[]): Set<string> {
    const out = new Set<string>()
    for (const { r, c } of cells) {
      const [tr, tc] = this.tileOf(r, c)
      out.add(tileKey(tr, tc))
    }
    return out
  }

  /** Marca las celdas con su caja sin volver a pedir la grilla. */
  applyRefinement(cells: Cell[], bin: Bin) {
    const ch = BIN_CHAR[bin].charCodeAt(0)
    let changed = false
    for (const { r, c } of cells) {
      const [tr, tc] = this.tileOf(r, c)
      const t = this.tiles.get(tileKey(tr, tc))
      if (!t) continue
      const i = (r - t.originRow) * t.cols + (c - t.originCol)
      if (t.bins[i] !== ch) {
        t.bins[i] = ch
        changed = true
      }
    }
    if (changed) this.notify()
  }

  dispose() {
    for (const e of this.inflight.values()) e.controller.abort()
    this.queue = []
  }
}
