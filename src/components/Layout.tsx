import { NavLink, Outlet, useLocation } from 'react-router'
import { Suspense } from 'react'
import { useAuth } from '../auth/AuthContext'
import { restartEvents, streamStatus, type StreamStatus } from '../lib/events'
import { useStore } from '../lib/store'
import type { Permission } from '../lib/types'
import { ContingencyModal } from './ContingencyModal'
import { ErrorBoundary } from './ErrorBoundary'
import { Spinner } from './ui'

const NAV: { to: string; label: string; permission?: Permission }[] = [
  { to: '/files', label: 'Archivos', permission: 'files:read' },
  { to: '/refiners', label: 'Expedientes', permission: 'refiners:read' },
  { to: '/incidents', label: 'Incidencias', permission: 'incidents:read' },
  { to: '/estado', label: 'Estado' },
]

const STATUS_LABEL: Record<StreamStatus, { text: string; tone: string }> = {
  idle: { text: 'Eventos: inactivo', tone: 'bg-slate-500' },
  connecting: { text: 'Eventos: conectando', tone: 'bg-amber-400' },
  open: { text: 'Eventos: en vivo', tone: 'bg-emerald-400' },
  reconnecting: { text: 'Eventos: reconectando', tone: 'bg-amber-400' },
  locked: { text: 'Eventos: Piso cerrado', tone: 'bg-slate-500' },
  superseded: { text: 'Eventos: reemplazado', tone: 'bg-red-500' },
  stopped: { text: 'Eventos: detenido', tone: 'bg-slate-500' },
}

export function StreamIndicator() {
  const status = useStore(streamStatus)
  const s = STATUS_LABEL[status]
  return (
    <span className="flex items-center gap-2 text-xs text-slate-300" role="status" aria-live="polite">
      <span className={`inline-block h-2.5 w-2.5 rounded-full ${s.tone}`} aria-hidden="true" />
      {s.text}
      {status === 'superseded' && (
        <button type="button" className="underline" onClick={restartEvents}>
          reconectar
        </button>
      )}
    </span>
  )
}

export function Layout() {
  const { me, can, logout } = useAuth()
  const location = useLocation()
  return (
    <div className="min-h-screen bg-slate-950 text-slate-100">
      <a href="#main" className="skip-link">
        Saltar al contenido
      </a>
      <header className="border-b border-slate-800 bg-slate-900">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center gap-4 px-4 py-3">
          <span className="font-mono text-sm font-bold tracking-widest text-sky-300">LUMON · MDR</span>
          <nav aria-label="Principal" className="flex flex-wrap gap-1">
            {NAV.filter((n) => !n.permission || can(n.permission)).map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                className={({ isActive }) =>
                  `rounded px-3 py-1.5 text-sm ${isActive ? 'bg-sky-800 text-white' : 'text-slate-200 hover:bg-slate-800'}`
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex flex-wrap items-center gap-4">
            <StreamIndicator />
            {me && (
              <span className="text-xs text-slate-300">
                {me.displayName} · {me.team.code} · {me.role.name}
              </span>
            )}
            <button type="button" className="btn-secondary" onClick={() => void logout()}>
              Cerrar sesión
            </button>
          </div>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-7xl px-4 py-6">
        <ErrorBoundary resetKey={location.pathname}>
          <Suspense fallback={<Spinner />}>
            <Outlet />
          </Suspense>
        </ErrorBoundary>
      </main>
      <ContingencyModal />
    </div>
  )
}
