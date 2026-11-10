import type { ReactNode } from 'react'
import { errorMessage } from '../lib/errors'

export function Spinner({ label = 'Cargando…' }: { label?: string }) {
  return (
    <div role="status" className="flex items-center gap-2 text-sm text-slate-300">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  )
}

export function ErrorBox({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <div role="alert" className="rounded-md border border-red-500/60 bg-red-950/50 p-3 text-sm text-red-100">
      <p>{errorMessage(error)}</p>
      {onRetry && (
        <button type="button" className="btn-secondary mt-2" onClick={onRetry}>
          Reintentar
        </button>
      )}
    </div>
  )
}

export function Notice({ children, tone = 'info' }: { children: ReactNode; tone?: 'info' | 'warn' | 'ok' }) {
  const styles = {
    info: 'border-sky-500/50 bg-sky-950/40 text-sky-100',
    warn: 'border-amber-500/60 bg-amber-950/40 text-amber-100',
    ok: 'border-emerald-500/60 bg-emerald-950/40 text-emerald-100',
  }[tone]
  return (
    <div role="status" className={`rounded-md border p-3 text-sm ${styles}`}>
      {children}
    </div>
  )
}

export function PageTitle({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-2xl font-semibold text-slate-50">{children}</h1>
      {actions}
    </div>
  )
}

export function Pagination({
  page,
  totalPages,
  onPage,
}: {
  page: number
  totalPages: number
  onPage: (page: number) => void
}) {
  return (
    <nav aria-label="Paginación" className="mt-4 flex items-center gap-3 text-sm">
      <button type="button" className="btn-secondary" disabled={page <= 0} onClick={() => onPage(page - 1)}>
        Anterior
      </button>
      <span>
        Página {totalPages === 0 ? 0 : page + 1} de {totalPages}
      </span>
      <button
        type="button"
        className="btn-secondary"
        disabled={page + 1 >= totalPages}
        onClick={() => onPage(page + 1)}
      >
        Siguiente
      </button>
    </nav>
  )
}

export function ProgressBar({ value, label }: { value: number; label: string }) {
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100)
  return (
    <div
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={pct}
      className="h-2 w-full overflow-hidden rounded bg-slate-700"
    >
      <div className="h-full bg-sky-400 transition-[width]" style={{ width: `${pct}%` }} />
    </div>
  )
}
