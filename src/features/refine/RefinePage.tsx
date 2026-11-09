import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react'
import { Link, useParams, useSearchParams } from 'react-router'
import { useAuth } from '../../auth/AuthContext'
import { ErrorBox, PageTitle, ProgressBar, Spinner } from '../../components/ui'
import { api } from '../../lib/api'
import { detail, errorMessage, isApiError, isRecord } from '../../lib/errors'
import { onEvent } from '../../lib/events'
import { createStore } from '../../lib/store'
import { BINS, type Bin, type Cell, type DataFile, type Me, type Progress, type RefineResult, type Rules } from '../../lib/types'
import { useApiQuery } from '../../lib/useApiQuery'
import { backoff, isAbortError, parseIntParam, percent, sleep, uuid } from '../../lib/util'
import { FloorClient } from './floor'
import { CursorOverlay, PresencePanel } from './FloorWidgets'
import { Grid, type GridApi, type Viewport } from './Grid'
import { findGroup, type Group } from './groups'
import { TileStore } from './tiles'

const BIN_NAMES: Record<Bin, string> = { WO: 'WO · Woe', FC: 'FC · Frolic', DR: 'DR · Dread', MA: 'MA · Malice' }

const INVALID_REASON: Record<string, string> = {
  BELOW_THRESHOLD: 'El grupo incluye celdas que no dan miedo.',
  NOT_CONNECTED: 'Las celdas no están conectadas.',
  INCOMPLETE: 'El grupo está incompleto: faltan celdas. Se recargaron los bloques; vuelve a seleccionarlo.',
  SIZE_OUT_OF_RANGE: 'El grupo es ruido (tamaño fuera de rango) y no se puede refinar.',
}

type Selection =
  | { status: 'idle' }
  | { status: 'loading'; cell: Cell }
  | { status: 'ready'; group: Group; claim: 'pending' | 'ok' | 'none' | 'denied'; holder?: string }

export default function RefinePage() {
  const { id } = useParams()
  const fileId = /^\d+$/.test(id ?? '') ? Number(id) : null
  const { me } = useAuth()
  const query = useApiQuery<{ file: DataFile; rules: Rules }>(fileId === null ? null : `refine-${fileId}`, async (signal) => {
    const [file, rules] = await Promise.all([
      api<DataFile>(`/files/${fileId}`, { signal }),
      api<Rules>(`/files/${fileId}/rules`, { signal }),
    ])
    return { file, rules }
  })

  if (fileId === null) return <ErrorBox error={new Error('Identificador de archivo inválido.')} />
  if (query.error) {
    const notFound = isApiError(query.error) && query.error.status === 404
    return notFound ? (
      <p>
        El archivo no existe.{' '}
        <Link to="/files" className="text-sky-300 underline">
          Volver al listado
        </Link>
      </p>
    ) : (
      <ErrorBox error={query.error} onRetry={query.reload} />
    )
  }
  if (!query.data || !me) return <Spinner label="Cargando archivo…" />
  return <Workspace key={fileId} file={query.data.file} rules={query.data.rules} me={me} />
}

function Workspace({ file: initialFile, rules, me }: { file: DataFile; rules: Rules; me: Me }) {
  const fileId = initialFile.id
  const canRefine = me.permissions.includes('files:refine')
  const [file, setFile] = useState(initialFile)
  const [completed, setCompleted] = useState(initialFile.status === 'COMPLETE')
  const [selection, setSelection] = useState<Selection>({ status: 'idle' })
  const [message, setMessage] = useState<{ text: string; tone: 'info' | 'error' | 'ok' } | null>(null)
  const [refining, setRefining] = useState(false)
  const [hoverBin, setHoverBin] = useState<Bin | null>(null)
  const refiningRef = useRef(false)
  const selectAbort = useRef<AbortController | null>(null)
  const gridApi = useRef<GridApi | null>(null)
  const ghostRef = useRef<HTMLDivElement>(null)
  const justDragged = useRef(false)

  const store = useMemo(() => new TileStore(fileId, initialFile.rows, initialFile.cols, initialFile.tileSize), [fileId, initialFile])
  useEffect(() => () => store.dispose(), [store])
  const viewport = useMemo(() => createStore<Viewport>({ r0: 0, c0: 0, r1: 0, c1: 0 }), [])

  const [floor, setFloor] = useState<FloorClient | null>(null)
  useEffect(() => {
    const f = new FloorClient(fileId, me.id)
    setFloor(f)
    return () => f.dispose()
  }, [fileId, me.id])

  const floorState = useSyncExternalStore(
    floor?.subscribeState ?? noopSubscribe,
    floor?.getState ?? nullState,
  )
  const claimedByOthers = useMemo(() => floor?.othersClaimedCells() ?? new Map<string, string>(), [floor, floorState])

  // --- posición en la URL (?r=&c=): replace, el scroll no llena el historial ---
  const [sp, setSp] = useSearchParams()
  const initialCell = useMemo<Cell>(
    () => ({
      r: parseIntParam(sp.get('r'), 0, 0, Math.max(0, initialFile.rows - 1)),
      c: parseIntParam(sp.get('c'), 0, 0, Math.max(0, initialFile.cols - 1)),
    }),
    // solo al montar
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  )
  useEffect(() => {
    let t: number | null = null
    const unsub = viewport.subscribe(() => {
      if (t !== null) window.clearTimeout(t)
      t = window.setTimeout(() => {
        const { r0, c0 } = viewport.get()
        setSp(
          (prev) => {
            const next = new URLSearchParams(prev)
            next.set('r', String(r0))
            next.set('c', String(c0))
            return next
          },
          { replace: true },
        )
      }, 300)
    })
    return () => {
      unsub()
      if (t !== null) window.clearTimeout(t)
    }
  }, [viewport, setSp])

  const selectedSet = useMemo(() => {
    if (selection.status !== 'ready') return new Set<string>()
    return new Set(selection.group.cells.map((x) => `${x.r},${x.c}`))
  }, [selection])

  const clearSelection = useCallback(() => {
    selectAbort.current?.abort()
    floor?.release()
    setSelection({ status: 'idle' })
  }, [floor])

  const claimGroup = useCallback(
    async (group: Group) => {
      const first = group.cells[0]
      if (!floor || !first) return
      const res = await floor.claim(first)
      setSelection((s) => {
        if (s.status !== 'ready' || s.group.key !== group.key) return s
        if (res.ok) return { ...s, claim: 'ok' }
        if (res.reason === 'HELD') return { ...s, claim: 'denied', holder: res.holder ?? 'otro refinador' }
        if (res.reason === 'NOT_A_GROUP') return { ...s, claim: 'none' }
        return { ...s, claim: 'none' }
      })
      if (!res.ok && res.reason === 'HELD') {
        setMessage({ text: `Ese grupo está reservado por ${res.holder ?? 'otro refinador'}. Elige otro.`, tone: 'error' })
      }
    },
    [floor],
  )

  // --- seleccionar un grupo completo (aunque cruce bloques) ---
  const activate = useCallback(
    async (cell: Cell) => {
      if (justDragged.current) return
      const info = store.getCell(cell.r, cell.c)
      if (selection.status === 'ready' && selectedSet.has(`${cell.r},${cell.c}`)) return
      selectAbort.current?.abort()
      floor?.release()
      if (info && info.tremor < rules.tremorThreshold) {
        setSelection({ status: 'idle' })
        return
      }
      const controller = new AbortController()
      selectAbort.current = controller
      setSelection({ status: 'loading', cell })
      try {
        const group = await findGroup(store, rules, cell, controller.signal)
        if (controller.signal.aborted) return
        if (!group) {
          setSelection({ status: 'idle' })
          return
        }
        const canClaim = !group.noise && !group.refined && canRefine
        setSelection({ status: 'ready', group, claim: canClaim ? 'pending' : 'none' })
        setMessage(null)
        if (canClaim) void claimGroup(group)
      } catch (e) {
        if (isAbortError(e)) return
        setSelection({ status: 'idle' })
        setMessage({ text: `No se pudo cargar el grupo: ${errorMessage(e)}`, tone: 'error' })
      }
    },
    [store, rules, floor, selection, selectedSet, canRefine, claimGroup],
  )

  // Al reconectar el WebSocket, la reserva se perdió: hay que volver a pedirla.
  useEffect(() => {
    if (floorState?.status !== 'open' || selection.status !== 'ready') return
    if (selection.claim === 'none' && !selection.group.noise && !selection.group.refined && canRefine && floor && !floor.myClaimId) {
      setSelection({ ...selection, claim: 'pending' })
      void claimGroup(selection.group)
    }
  }, [floorState?.status]) // eslint-disable-line react-hooks/exhaustive-deps

  // --- refinar: una Idempotency-Key por intención; los reintentos reutilizan la misma ---
  const refine = useCallback(
    async (bin: Bin) => {
      if (refiningRef.current || selection.status !== 'ready' || !canRefine) return
      const { group } = selection
      if (group.noise) {
        setMessage({ text: 'Ese grupo es ruido: no se puede refinar.', tone: 'error' })
        return
      }
      if (group.refined) {
        setMessage({ text: 'Ese grupo ya está refinado.', tone: 'error' })
        return
      }
      if (selection.claim === 'denied' || group.cells.some((x) => claimedByOthers.has(`${x.r},${x.c}`))) {
        setMessage({ text: `Ese grupo está reservado por ${selection.holder ?? 'otro refinador'}.`, tone: 'error' })
        return
      }
      refiningRef.current = true
      setRefining(true)
      const idempotencyKey = uuid()
      const body = { bin, cells: group.cells }
      try {
        let result: RefineResult | null = null
        for (let attempt = 0; result === null; attempt++) {
          try {
            result = await api<RefineResult>(`/files/${fileId}/refinements`, {
              method: 'POST',
              body,
              headers: { 'Idempotency-Key': idempotencyKey },
              retries: 0,
            })
          } catch (e) {
            const transient = isApiError(e) && (e.status === 503 || e.status === 429 || e.isNetwork)
            if (transient && attempt < 5) {
              await sleep(e.retryAfterMs ?? backoff(attempt))
              continue
            }
            throw e
          }
        }
        store.applyRefinement(group.cells, bin)
        setFile((f) => ({ ...f, ...result.file, progress: result.file.progress }))
        floor?.release()
        setSelection({ status: 'idle' })
        setMessage({ text: `Grupo de ${result.size} celdas llevado a ${BIN_NAMES[bin]}.`, tone: 'ok' })
        if (result.file.status === 'COMPLETE') setCompleted(true)
      } catch (e) {
        handleRefineError(e, group)
      } finally {
        refiningRef.current = false
        setRefining(false)
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [selection, canRefine, claimedByOthers, fileId, store, floor],
  )

  function handleRefineError(e: unknown, group: Group) {
    if (!isApiError(e)) {
      setMessage({ text: errorMessage(e), tone: 'error' })
      return
    }
    if (e.code === 'WRONG_BIN') {
      const mistakes = detail(e, 'mistakes')
      if (typeof mistakes === 'number') setFile((f) => ({ ...f, mistakes }))
      setMessage({ text: `Caja incorrecta: Lumon lo anotó (errores: ${typeof mistakes === 'number' ? mistakes : '?'}). Revisa la caja sugerida.`, tone: 'error' })
      return
    }
    if (e.code === 'ALREADY_REFINED') {
      store.invalidate(store.tilesForCells(group.cells))
      clearSelection()
      setMessage({ text: 'Alguna celda ya estaba refinada. Se actualizaron los bloques afectados.', tone: 'error' })
      return
    }
    if (e.code === 'GROUP_CLAIMED') {
      const holder = detail(e, 'holder')
      const name = isRecord(holder) && typeof holder.displayName === 'string' ? holder.displayName : 'otro refinador'
      setSelection((s) => (s.status === 'ready' ? { ...s, claim: 'denied', holder: name } : s))
      setMessage({ text: `${name} tiene reservado ese grupo. Elige otro o espera a que lo libere.`, tone: 'error' })
      return
    }
    if (e.code === 'GROUP_INVALID') {
      const reason = detail(e, 'reason')
      store.invalidate(store.tilesForCells(group.cells))
      clearSelection()
      setMessage({ text: (typeof reason === 'string' && INVALID_REASON[reason]) || e.message, tone: 'error' })
      return
    }
    setMessage({ text: errorMessage(e), tone: 'error' })
  }

  // --- eventos en tiempo real ---
  useEffect(() => {
    const offs = [
      onEvent('refinement.created', (ev) => {
        const d = ev.data
        if (!isRecord(d) || d.fileId !== fileId || !Array.isArray(d.cells) || typeof d.bin !== 'string') return
        const cells = d.cells.filter((x): x is Cell => isRecord(x) && typeof x.r === 'number' && typeof x.c === 'number')
        if (!(BINS as readonly string[]).includes(d.bin)) return
        store.applyRefinement(cells, d.bin as Bin)
        if (isRecord(d.progress)) setFile((f) => ({ ...f, progress: d.progress as unknown as Progress }))
        setSelection((s) => {
          if (s.status !== 'ready') return s
          const keys = new Set(cells.map((x) => `${x.r},${x.c}`))
          return s.group.cells.some((x) => keys.has(`${x.r},${x.c}`)) ? { status: 'idle' } : s
        })
      }),
      onEvent('file.completed', (ev) => {
        if (isRecord(ev.data) && ev.data.fileId === fileId) setCompleted(true)
      }),
      onEvent('stream.reset', () => {
        store.invalidateAll()
        api<DataFile>(`/files/${fileId}`)
          .then((f) => {
            setFile(f)
            if (f.status === 'COMPLETE') setCompleted(true)
          })
          .catch(() => undefined)
      }),
    ]
    return () => offs.forEach((off) => off())
  }, [fileId, store])

  // --- arrastre con Pointer Events (sin librerías) ---
  const onCellPointerDown = useCallback(
    (e: PointerEvent, cell: Cell) => {
      if (e.button !== 0 || selection.status !== 'ready' || !selectedSet.has(`${cell.r},${cell.c}`) || !canRefine) return
      e.preventDefault()
      const startX = e.clientX
      const startY = e.clientY
      let dragging = false
      let over: Bin | null = null
      const ghost = ghostRef.current
      const move = (ev: globalThis.PointerEvent) => {
        if (!dragging && Math.hypot(ev.clientX - startX, ev.clientY - startY) < 6) return
        dragging = true
        if (ghost) {
          ghost.style.display = 'block'
          ghost.style.transform = `translate(${ev.clientX + 12}px, ${ev.clientY + 12}px)`
        }
        const target = document.elementFromPoint(ev.clientX, ev.clientY)?.closest<HTMLElement>('[data-bin]')
        const bin = (target?.dataset.bin ?? null) as Bin | null
        if (bin !== over) {
          over = bin
          setHoverBin(bin)
        }
      }
      const up = () => {
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
        window.removeEventListener('pointercancel', up)
        if (ghost) ghost.style.display = 'none'
        setHoverBin(null)
        if (dragging) {
          justDragged.current = true
          window.setTimeout(() => {
            justDragged.current = false
          }, 0)
          if (over) void refine(over)
        }
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
      window.addEventListener('pointercancel', up)
    },
    [selection, selectedSet, canRefine, refine],
  )

  const onBinKey = useCallback(
    (index: number) => {
      const bin = BINS[index]
      if (bin) void refine(bin)
    },
    [refine],
  )
  const onFocusCell = useCallback((cell: Cell) => floor?.sendCursor(cell), [floor])
  const onActivate = useCallback((cell: Cell) => void activate(cell), [activate])
  const overlay = useMemo(() => (floor ? <CursorOverlay floor={floor} /> : null), [floor])

  if (completed) {
    return (
      <section className="mx-auto max-w-xl py-12 text-center" aria-labelledby="done-title">
        <h1 id="done-title" className="mb-2 text-3xl font-semibold text-emerald-300">
          Archivo completado
        </h1>
        <p className="mb-6 text-slate-300">
          «{file.name}» llegó al 100 %. {file.refinedGroups}/{file.totalGroups} grupos refinados · {file.mistakes} errores.
        </p>
        <p className="mb-6 italic text-slate-400">Que cada número encuentre su caja.</p>
        <Link to="/files" className="btn-primary">
          Volver a los archivos
        </Link>
      </section>
    )
  }

  const group = selection.status === 'ready' ? selection.group : null
  const canDrop = !!group && !group.noise && !group.refined && selection.status === 'ready' && selection.claim !== 'denied' && canRefine && !refining

  return (
    <div>
      <PageTitle actions={<Link to="/files" className="btn-secondary">Volver</Link>}>{file.name}</PageTitle>
      <p className="mb-3 text-sm text-slate-400">
        {file.rows}×{file.cols} · umbral {rules.tremorThreshold} · conectividad {rules.connectivity} · grupos de {rules.minGroupSize} a{' '}
        {rules.maxGroupSize} · {rules.binning.strategy === 'DIGIT_SUM_MOD' ? 'suma de dígitos' : 'dígito máximo'} mód 4 →{' '}
        {rules.binning.order.join(', ')}
      </p>
      <p id="grid-help" className="mb-3 text-xs text-slate-400">
        Flechas, RePág/AvPág, Inicio/Fin para moverte. Enter selecciona el grupo. 1–4 lo lleva a WO, FC, DR o MA (o arrástralo a una
        caja). Esc cancela.
      </p>

      <div className="grid gap-4 xl:grid-cols-[1fr_280px]">
        <div className="min-w-0">
          {floor && (
            <Grid
              store={store}
              rules={rules}
              selected={selectedSet}
              claimedByOthers={claimedByOthers}
              initial={initialCell}
              viewport={viewport}
              apiRef={gridApi}
              onActivate={onActivate}
              onFocusCell={onFocusCell}
              onBinKey={onBinKey}
              onEscape={clearSelection}
              onCellPointerDown={onCellPointerDown}
              overlay={overlay}
              label={`Archivo ${file.name}`}
            />
          )}

          <div role="status" aria-live="polite" className="mt-3 min-h-6 text-sm">
            {selection.status === 'loading' && 'Buscando el grupo completo…'}
            {group && (
              <span>
                Grupo de <strong>{group.truncated ? `más de ${rules.maxGroupSize}` : group.size}</strong> celdas ·{' '}
                {group.refined
                  ? 'ya refinado'
                  : group.noise
                    ? 'es ruido (no se puede refinar)'
                    : `caja que corresponde: ${group.bin ? BIN_NAMES[group.bin] : '—'}`}
                {selection.status === 'ready' && selection.claim === 'pending' && ' · reservando…'}
                {selection.status === 'ready' && selection.claim === 'ok' && ' · reservado para ti'}
                {selection.status === 'ready' && selection.claim === 'denied' && ` · reservado por ${selection.holder ?? 'otro'}`}
              </span>
            )}
          </div>
          {message && (
            <p
              role={message.tone === 'error' ? 'alert' : 'status'}
              className={`mt-2 text-sm ${message.tone === 'error' ? 'text-red-300' : message.tone === 'ok' ? 'text-emerald-300' : 'text-slate-200'}`}
            >
              {message.text}
            </p>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4" aria-label="Cajas">
            {BINS.map((bin, i) => (
              <button
                key={bin}
                type="button"
                data-bin={bin}
                disabled={!canDrop}
                onClick={() => void refine(bin)}
                aria-keyshortcuts={String(i + 1)}
                className={`rounded-lg border p-3 text-left transition-colors ${
                  hoverBin === bin ? 'border-sky-300 bg-sky-900' : group?.bin === bin ? 'border-emerald-500 bg-slate-900' : 'border-slate-700 bg-slate-900'
                } disabled:opacity-80`}
              >
                <span className="block font-semibold">
                  {i + 1}. {BIN_NAMES[bin]}
                </span>
                <span className="mb-1 block text-xs text-slate-300">{percent(file.progress[bin])}</span>
                <ProgressBar value={file.progress[bin]} label={`Progreso de ${bin}`} />
                {group?.bin === bin && !group.noise && !group.refined && <span className="mt-1 block text-xs text-emerald-300">sugerida</span>}
              </button>
            ))}
          </div>
          <div className="mt-3 text-sm text-slate-300">
            <span>Progreso total: {percent(file.progress.overall)}</span>
            <ProgressBar value={file.progress.overall} label="Progreso total" />
            <span className="mt-1 block text-xs text-slate-400">
              {file.refinedGroups}/{file.totalGroups} grupos · {file.mistakes} errores
            </span>
          </div>
          {!canRefine && <p className="mt-2 text-sm text-amber-200">Tu rol puede ver la grilla pero no refinar (falta files:refine).</p>}
        </div>

        <aside className="space-y-4">
          {floor && <PresencePanel floor={floor} viewport={viewport} gridApi={gridApi} myUserId={me.id} />}
        </aside>
      </div>

      <div
        ref={ghostRef}
        aria-hidden="true"
        className="pointer-events-none fixed left-0 top-0 z-40 hidden rounded bg-sky-500 px-2 py-1 text-xs font-semibold text-slate-950 shadow-lg"
      >
        {group ? `${group.size} celdas` : ''}
      </div>
    </div>
  )
}

function noopSubscribe() {
  return () => undefined
}
function nullState() {
  return null
}
