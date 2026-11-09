import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { rawRequest } from '../lib/http'
import type { Health } from '../lib/types'
import { backoff } from '../lib/util'

/**
 * Si /meta/health no responde, muestra "Conectando con Lumon…" y reintenta solo
 * con espera creciente; también permite reintentar a mano.
 */
export function HealthGate({ children }: { children: ReactNode }) {
  const [ok, setOk] = useState(false)
  const [failures, setFailures] = useState(0)
  const [nextRetryAt, setNextRetryAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const timer = useRef<number | null>(null)
  const checking = useRef(false)
  const failuresRef = useRef(0)

  const check = useCallback(async () => {
    if (checking.current) return
    checking.current = true
    if (timer.current !== null) window.clearTimeout(timer.current)
    try {
      const { data } = await rawRequest<Health>('/meta/health', { signal: AbortSignal.timeout(10_000) })
      if (data.status === 'ok') {
        setOk(true)
        return
      }
      throw new Error('estado no ok')
    } catch {
      const f = failuresRef.current
      failuresRef.current = f + 1
      const delay = backoff(f, 1000, 30_000)
      setFailures(f + 1)
      setNextRetryAt(Date.now() + delay)
      timer.current = window.setTimeout(() => void check(), delay)
    } finally {
      checking.current = false
    }
  }, [])

  useEffect(() => {
    void check()
    return () => {
      if (timer.current !== null) window.clearTimeout(timer.current)
    }
  }, [check])

  useEffect(() => {
    if (ok || failures === 0) return
    const id = window.setInterval(() => setNow(Date.now()), 500)
    return () => window.clearInterval(id)
  }, [ok, failures])

  if (ok) return <>{children}</>

  const seconds = nextRetryAt ? Math.max(0, Math.ceil((nextRetryAt - now) / 1000)) : null
  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-6 text-slate-200">
      <div className="max-w-md text-center" role="status" aria-live="polite">
        <span className="spinner mx-auto mb-4 block" aria-hidden="true" />
        <h1 className="mb-2 text-xl font-semibold">Conectando con Lumon…</h1>
        {failures > 0 && (
          <>
            <p className="mb-4 text-sm text-slate-400">
              Lumon no responde todavía (intento {failures}).
              {seconds !== null && ` Nuevo intento en ${seconds} s.`}
            </p>
            <button type="button" className="btn-primary" onClick={() => void check()}>
              Reintentar ahora
            </button>
          </>
        )}
      </div>
    </main>
  )
}
