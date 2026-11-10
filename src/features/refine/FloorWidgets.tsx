import { useSyncExternalStore } from 'react'
import { useStore, type Store } from '../../lib/store'
import type { FloorClient, FloorState } from './floor'
import { CELL, type GridApi, type Viewport } from './Grid'

function colorFor(userId: number): string {
  const hues = [12, 48, 140, 190, 280, 320, 90, 220]
  return `hsl(${hues[userId % hues.length] ?? 200} 90% 60%)`
}

/**
 * Cursores de los demás sobre la grilla. Se suscribe SOLO a los cursores:
 * cada movimiento re-renderiza este overlay, no la grilla.
 */
export function CursorOverlay({ floor }: { floor: FloorClient }) {
  useSyncExternalStore(floor.subscribeCursors, floor.getCursorVersion)
  return (
    <div aria-hidden="true" style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
      {[...floor.cursors.entries()].map(([userId, cur]) => (
        <div
          key={userId}
          style={{
            position: 'absolute',
            left: cur.c * CELL,
            top: cur.r * CELL,
            width: CELL,
            height: CELL,
            boxShadow: `inset 0 0 0 2px ${colorFor(userId)}`,
            zIndex: 3,
          }}
        >
          <span
            style={{ background: colorFor(userId), position: 'absolute', top: -16, left: 0 }}
            className="whitespace-nowrap rounded px-1 text-[10px] font-semibold text-slate-950"
          >
            {cur.displayName}
          </span>
        </div>
      ))}
    </div>
  )
}

const STATUS_TEXT: Record<FloorState['status'], string> = {
  connecting: 'conectando',
  open: 'conectado',
  reconnecting: 'reconectando',
  failed: 'no disponible',
  closed: 'cerrado',
}

/** Lista de presentes (sin duplicados) e indicador del WebSocket. */
export function PresencePanel({
  floor,
  viewport,
  gridApi,
  myUserId,
}: {
  floor: FloorClient
  viewport: Store<Viewport>
  gridApi: { current: GridApi | null }
  myUserId: number
}) {
  const state = useSyncExternalStore(floor.subscribeState, floor.getState)
  useSyncExternalStore(floor.subscribeCursors, floor.getCursorVersion)
  const vp = useStore(viewport)
  const dot = state.status === 'open' ? 'bg-emerald-400' : state.status === 'failed' ? 'bg-red-500' : 'bg-amber-400'
  return (
    <section aria-labelledby="presence-title" className="rounded-lg border border-slate-800 bg-slate-900 p-3 text-sm">
      <h2 id="presence-title" className="mb-2 font-semibold">
        En el piso
      </h2>
      <p className="mb-2 flex items-center gap-2 text-xs text-slate-300" role="status" aria-live="polite">
        <span className={`inline-block h-2.5 w-2.5 rounded-full ${dot}`} aria-hidden="true" />
        Piso compartido: {STATUS_TEXT[state.status]}
      </p>
      {state.message && <p className="mb-2 text-xs text-amber-200">{state.message}</p>}
      {state.status === 'failed' && <p className="mb-2 text-xs text-slate-400">Puedes seguir refinando con normalidad.</p>}
      <ul className="space-y-1">
        {state.members.map((m) => {
          const cur = floor.cursors.get(m.userId)
          const outside = cur ? cur.r < vp.r0 || cur.r >= vp.r1 || cur.c < vp.c0 || cur.c >= vp.c1 : false
          return (
            <li key={m.userId} className="flex items-center justify-between gap-2">
              <span className="flex items-center gap-2">
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: colorFor(m.userId) }} aria-hidden="true" />
                {m.displayName}
                {m.userId === myUserId && <span className="text-xs text-slate-400">(tú)</span>}
                {outside && <span className="text-xs text-slate-400">fuera de la vista</span>}
              </span>
              {cur && outside && (
                <button type="button" className="text-xs text-sky-300 underline" onClick={() => gridApi.current?.goTo(cur.r, cur.c)}>
                  Ir a su posición
                </button>
              )}
            </li>
          )
        })}
        {state.members.length === 0 && <li className="text-slate-400">Nadie conectado.</li>}
      </ul>
    </section>
  )
}
