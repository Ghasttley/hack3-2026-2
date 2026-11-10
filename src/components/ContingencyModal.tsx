import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../lib/api'
import { broadcastAck, contingencies } from '../lib/contingency'
import { errorMessage } from '../lib/errors'
import { useStore } from '../lib/store'

/**
 * Contingencia: interrumpe en TODAS las pestañas (el evento llega a todas por el canal compartido),
 * atrapa el foco, se anuncia a lectores de pantalla y solo se cierra al confirmar con
 * POST /contingency/{id}/ack. Si la confirmación falla, sigue abierto con el error.
 */
export function ContingencyModal() {
  const list = useStore(contingencies)
  const current = list[0]
  const dialogRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!current) return
    setError(null)
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null
    buttonRef.current?.focus()
    const root = document.getElementById('root')
    root?.setAttribute('aria-hidden', 'true')
    if (root) root.inert = true
    return () => {
      root?.removeAttribute('aria-hidden')
      if (root) root.inert = false
      previous?.focus()
    }
  }, [current])

  if (!current) return null

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      e.preventDefault() // no se cierra sin confirmar
      return
    }
    if (e.key !== 'Tab' || !dialogRef.current) return
    const focusables = dialogRef.current.querySelectorAll<HTMLElement>('button:not([disabled]), [tabindex="0"]')
    const first = focusables[0]
    const last = focusables[focusables.length - 1]
    if (!first || !last) return
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault()
      last.focus()
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault()
      first.focus()
    }
  }

  async function ack() {
    if (!current || busy) return
    setBusy(true)
    setError(null)
    try {
      await api<void>(`/contingency/${current.id}/ack`, { method: 'POST', retries: 2 })
      broadcastAck(current.id)
    } catch (e) {
      setError(errorMessage(e))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/80 p-4" data-modal-portal>
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="contingency-title"
        aria-describedby="contingency-desc"
        onKeyDown={onKeyDown}
        className="w-full max-w-md rounded-lg border border-red-500 bg-slate-900 p-6 shadow-2xl"
      >
        <h2 id="contingency-title" className="mb-2 text-xl font-bold text-red-300">
          Contingencia de horas extra
        </h2>
        <p id="contingency-desc" className="mb-4 text-slate-100">
          {current.message}
        </p>
        {error && (
          <p role="alert" className="mb-3 rounded bg-red-950 p-2 text-sm text-red-200">
            No se pudo confirmar: {error}
          </p>
        )}
        <button ref={buttonRef} type="button" className="btn-primary w-full" onClick={() => void ack()} disabled={busy}>
          {busy ? 'Confirmando…' : 'Confirmar contingencia'}
        </button>
      </div>
    </div>,
    document.body,
  )
}
