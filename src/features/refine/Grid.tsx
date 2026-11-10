import {
  memo,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type KeyboardEvent,
  type PointerEvent,
  type ReactNode,
} from 'react'
import type { Store } from '../../lib/store'
import type { Cell, Rules } from '../../lib/types'
import { clamp } from '../../lib/util'
import { isScary } from './groups'
import { tileKey, type TileStore } from './tiles'

export const CELL = 32
const MAX_VIEW_ROWS = 22
const MAX_VIEW_COLS = 38
const OVERSCAN = 2
/** Tope duro: nunca más de 2 500 celdas en el DOM. */
const MAX_CELLS = 2400

export interface Viewport {
  r0: number
  c0: number
  r1: number // exclusivo
  c1: number
}

export interface GridApi {
  goTo: (r: number, c: number) => void
}

interface Props {
  store: TileStore
  rules: Rules
  selected: Set<string>
  claimedByOthers: Map<string, string>
  initial: Cell
  viewport: Store<Viewport>
  apiRef: { current: GridApi | null }
  onActivate: (cell: Cell) => void
  onFocusCell: (cell: Cell) => void
  onBinKey: (index: number) => void
  onEscape: () => void
  onCellPointerDown: (e: PointerEvent, cell: Cell) => void
  overlay: ReactNode
  label: string
}

function cellFromTarget(target: EventTarget | null): Cell | null {
  if (!(target instanceof Element)) return null
  const el = target.closest<HTMLElement>('[data-r]')
  if (!el) return null
  const r = Number(el.dataset.r)
  const c = Number(el.dataset.c)
  return Number.isInteger(r) && Number.isInteger(c) ? { r, c } : null
}

/**
 * Grilla virtualizada con elementos del DOM (sin <canvas>, sin librerías de virtualización):
 * solo se renderiza la ventana visible + un margen; la celda con foco siempre está en el DOM.
 * Patrón ARIA grid con índices reales de fila y columna.
 */
export const Grid = memo(function Grid({
  store,
  rules,
  selected,
  claimedByOthers,
  initial,
  viewport,
  apiRef,
  onActivate,
  onFocusCell,
  onBinKey,
  onEscape,
  onCellPointerDown,
  overlay,
  label,
}: Props) {
  useSyncExternalStore(store.subscribe, store.getVersion)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [size, setSize] = useState({ w: MAX_VIEW_COLS * CELL, h: MAX_VIEW_ROWS * CELL })
  const [scroll, setScroll] = useState({ top: initial.r * CELL, left: initial.c * CELL })
  const [focus, setFocus] = useState<Cell>(initial)
  const hasFocus = useRef(false)
  const rafRef = useRef<number | null>(null)
  const { rows, cols } = store

  // Posición inicial desde la URL.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    el.scrollTop = initial.r * CELL
    el.scrollLeft = initial.c * CELL
    setScroll({ top: el.scrollTop, left: el.scrollLeft })
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const onScroll = useCallback(() => {
    if (rafRef.current !== null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const el = scrollRef.current
      if (!el) return
      const top = el.scrollTop
      const left = el.scrollLeft
      setScroll((s) =>
        Math.floor(s.top / CELL) === Math.floor(top / CELL) && Math.floor(s.left / CELL) === Math.floor(left / CELL)
          ? s
          : { top, left },
      )
    })
  }, [])

  // Ventana renderizada.
  const viewRows = Math.min(MAX_VIEW_ROWS + 1, Math.ceil(size.h / CELL) + 1)
  const viewCols = Math.min(MAX_VIEW_COLS + 1, Math.ceil(size.w / CELL) + 1)
  const firstRow = Math.floor(scroll.top / CELL)
  const firstCol = Math.floor(scroll.left / CELL)
  const r0 = clamp(firstRow - OVERSCAN, 0, rows)
  const c0 = clamp(firstCol - OVERSCAN, 0, cols)
  let r1 = Math.min(rows, firstRow + viewRows + OVERSCAN)
  let c1 = Math.min(cols, firstCol + viewCols + OVERSCAN)
  while ((r1 - r0) * (c1 - c0) > MAX_CELLS) {
    if (r1 - r0 > c1 - c0) r1--
    else c1--
  }

  // Publica la ventana (visible, sin margen) y pide los bloques que hacen falta.
  useEffect(() => {
    const vr0 = clamp(firstRow, 0, rows)
    const vc0 = clamp(firstCol, 0, cols)
    viewport.set({ r0: vr0, c0: vc0, r1: Math.min(rows, firstRow + viewRows), c1: Math.min(cols, firstCol + viewCols) })
    const keys = new Set<string>()
    const ts = store.tileSize
    for (let tr = Math.floor(r0 / ts); tr <= Math.floor((r1 - 1) / ts); tr++)
      for (let tc = Math.floor(c0 / ts); tc <= Math.floor((c1 - 1) / ts); tc++) keys.add(tileKey(tr, tc))
    store.setVisible(keys)
  }, [r0, c0, r1, c1, firstRow, firstCol, viewRows, viewCols, rows, cols, store, viewport])

  const scrollIntoView = useCallback(
    (r: number, c: number, mode: 'nearest' | 'start') => {
      const el = scrollRef.current
      if (!el) return
      if (mode === 'start') {
        el.scrollTop = r * CELL
        el.scrollLeft = c * CELL
        return
      }
      if (r * CELL < el.scrollTop) el.scrollTop = r * CELL
      else if ((r + 1) * CELL > el.scrollTop + el.clientHeight) el.scrollTop = (r + 1) * CELL - el.clientHeight
      if (c * CELL < el.scrollLeft) el.scrollLeft = c * CELL
      else if ((c + 1) * CELL > el.scrollLeft + el.clientWidth) el.scrollLeft = (c + 1) * CELL - el.clientWidth
    },
    [],
  )

  const moveFocus = useCallback(
    (r: number, c: number) => {
      const next = { r: clamp(r, 0, rows - 1), c: clamp(c, 0, cols - 1) }
      setFocus(next)
      scrollIntoView(next.r, next.c, 'nearest')
      onFocusCell(next)
    },
    [rows, cols, scrollIntoView, onFocusCell],
  )

  useEffect(() => {
    apiRef.current = {
      goTo: (r, c) => {
        const next = { r: clamp(r, 0, rows - 1), c: clamp(c, 0, cols - 1) }
        setFocus(next)
        scrollIntoView(Math.max(0, next.r - 3), Math.max(0, next.c - 3), 'start')
        hasFocus.current = true
      },
    }
  }, [apiRef, rows, cols, scrollIntoView])

  // Tras mover el foco, el elemento correspondiente recibe el foco del DOM.
  useEffect(() => {
    if (!hasFocus.current) return
    const el = scrollRef.current?.querySelector<HTMLElement>(`[data-r="${focus.r}"][data-c="${focus.c}"]`)
    if (el && document.activeElement !== el) el.focus({ preventScroll: true })
  }, [focus])

  function onKeyDown(e: KeyboardEvent) {
    const page = Math.max(1, viewRows - 1)
    const { r, c } = focus
    switch (e.key) {
      case 'ArrowUp':
        moveFocus(r - 1, c)
        break
      case 'ArrowDown':
        moveFocus(r + 1, c)
        break
      case 'ArrowLeft':
        moveFocus(r, c - 1)
        break
      case 'ArrowRight':
        moveFocus(r, c + 1)
        break
      case 'PageUp':
        moveFocus(r - page, c)
        break
      case 'PageDown':
        moveFocus(r + page, c)
        break
      case 'Home':
        if (e.ctrlKey) moveFocus(0, 0)
        else moveFocus(r, 0)
        break
      case 'End':
        if (e.ctrlKey) moveFocus(rows - 1, cols - 1)
        else moveFocus(r, cols - 1)
        break
      case 'Enter':
      case ' ':
        if (e.repeat) break
        onActivate(focus)
        break
      case 'Escape':
        onEscape()
        break
      case '1':
      case '2':
      case '3':
      case '4':
        if (e.repeat) break
        onBinKey(Number(e.key) - 1)
        break
      default:
        return
    }
    e.preventDefault()
  }

  const threshold = rules.tremorThreshold
  const renderCell = (r: number, c: number) => {
    const info = store.getCell(r, c)
    const key = `${r},${c}`
    const isFocus = focus.r === r && focus.c === c
    const style: CSSProperties & Record<string, string | number> = { left: c * CELL, top: 0, width: CELL, height: CELL }
    let cls = 'mdr-cell'
    let text = ''
    let aria = `Fila ${r + 1}, columna ${c + 1}: `
    if (!info) {
      cls += ' placeholder'
      aria += 'cargando'
    } else {
      text = String(info.digit)
      aria += text
      if (info.bin !== '.') {
        cls += ` bin-${info.bin}`
        aria += `, refinado (${info.bin})`
      } else if (isScary(info.tremor, rules)) {
        cls += ' scary'
        const k = (info.tremor - threshold) / Math.max(1, 100 - threshold)
        style['--amp'] = `${(0.6 + k * 2.4).toFixed(2)}px`
        style['--dur'] = `${Math.round(520 - k * 360)}ms`
        style['--alpha'] = (0.15 + k * 0.45).toFixed(2)
        aria += `, da miedo (temblor ${info.tremor})`
      }
      if (claimedByOthers.has(key)) {
        cls += ' claimed'
        aria += `, reservado por ${claimedByOthers.get(key) ?? 'otro'}`
      }
    }
    const isSel = selected.has(key)
    if (isSel) cls += ' selected'
    return (
      <div
        key={c}
        role="gridcell"
        aria-colindex={c + 1}
        aria-selected={isSel}
        aria-label={aria}
        tabIndex={isFocus ? 0 : -1}
        data-r={r}
        data-c={c}
        className={cls}
        style={style}
        title={claimedByOthers.has(key) ? `Reservado por ${claimedByOthers.get(key) ?? ''}` : undefined}
      >
        <span>{text}</span>
      </div>
    )
  }

  const rowEls: ReactNode[] = []
  const focusInWindow = focus.r >= r0 && focus.r < r1 && focus.c >= c0 && focus.c < c1
  for (let r = r0; r < r1; r++) {
    const cells: ReactNode[] = []
    for (let c = c0; c < c1; c++) cells.push(renderCell(r, c))
    if (!focusInWindow && focus.r === r) cells.push(renderCell(focus.r, focus.c))
    rowEls.push(
      <div key={r} role="row" aria-rowindex={r + 1} style={{ position: 'absolute', top: r * CELL, left: 0, height: CELL, width: cols * CELL }}>
        {cells}
      </div>,
    )
  }
  if (!focusInWindow && (focus.r < r0 || focus.r >= r1)) {
    rowEls.push(
      <div key={`f-${focus.r}`} role="row" aria-rowindex={focus.r + 1} style={{ position: 'absolute', top: focus.r * CELL, left: 0, height: CELL, width: cols * CELL }}>
        {renderCell(focus.r, focus.c)}
      </div>,
    )
  }

  return (
    <div
      ref={scrollRef}
      role="grid"
      aria-label={label}
      aria-rowcount={rows}
      aria-colcount={cols}
      aria-multiselectable="true"
      onScroll={onScroll}
      onKeyDown={onKeyDown}
      onFocus={() => {
        hasFocus.current = true
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget)) hasFocus.current = false
      }}
      onClick={(e) => {
        const cell = cellFromTarget(e.target)
        if (!cell) return
        hasFocus.current = true
        setFocus(cell)
        onFocusCell(cell)
        onActivate(cell)
      }}
      onPointerDown={(e) => {
        const cell = cellFromTarget(e.target)
        if (cell) onCellPointerDown(e, cell)
      }}
      className="relative overflow-auto rounded-md border border-slate-700 bg-slate-950"
      style={{
        height: `min(70vh, ${Math.min(rows, MAX_VIEW_ROWS) * CELL + 16}px)`,
        maxWidth: Math.min(cols, MAX_VIEW_COLS) * CELL + 16,
      }}
    >
      <div role="rowgroup" style={{ position: 'relative', width: cols * CELL, height: rows * CELL }}>
        {rowEls}
        {overlay}
      </div>
    </div>
  )
})
