import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { api } from '../lib/api'
import { setContingencyUser } from '../lib/contingency'
import { onEvent, startEvents, stopEvents } from '../lib/events'
import { rawRequest } from '../lib/http'
import {
  endSession,
  hasStoredSession,
  logout as sessionLogout,
  onLoginElsewhere,
  onSessionEnded,
  refreshAccessToken,
  SessionEndedError,
  startSession,
  type EndReason,
} from '../lib/session'
import type { LoginResponse, Me, Permission, RegisterResponse } from '../lib/types'
import { backoff, sleep } from '../lib/util'

type Status = 'checking' | 'authenticated' | 'anonymous'

interface AuthValue {
  status: Status
  me: Me | null
  notice: string | null
  clearNotice: () => void
  login: (email: string, password: string) => Promise<void>
  register: (teamName: string, email: string, password: string) => Promise<RegisterResponse>
  logout: () => Promise<void>
  reloadMe: () => Promise<void>
  can: (permission: Permission) => boolean
}

const AuthContext = createContext<AuthValue | null>(null)

const NOTICES: Record<EndReason, string | null> = {
  LOGOUT: null,
  REFRESH_REUSED:
    'Por seguridad se cerró tu sesión en todas las pestañas: se detectó un refresh token reutilizado. Vuelve a ingresar.',
  SESSION_REVOKED: 'Tu sesión fue revocada. Vuelve a ingresar.',
  REFRESH_INVALID: 'Tu sesión expiró. Vuelve a ingresar.',
  TOKEN_INVALID: 'Tu sesión no es válida. Vuelve a ingresar.',
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>(hasStoredSession() ? 'checking' : 'anonymous')
  const [me, setMe] = useState<Me | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const loadMe = useCallback(async () => {
    const data = await api<Me>('/auth/me')
    setMe(data)
    setContingencyUser(data.id)
    setStatus('authenticated')
  }, [])

  // Restauración de sesión al recargar: se muestra un splash (no el login) mientras se verifica.
  useEffect(() => {
    if (!hasStoredSession()) return
    let cancelled = false
    void (async () => {
      for (let attempt = 0; attempt < 4 && !cancelled; attempt++) {
        try {
          await refreshAccessToken(null)
          await loadMe()
          return
        } catch (e) {
          if (e instanceof SessionEndedError || !hasStoredSession()) return // onSessionEnded ya lo maneja
          await sleep(backoff(attempt, 1000))
        }
      }
      if (!cancelled) {
        setStatus('anonymous')
        setNotice('No se pudo restaurar la sesión. Vuelve a ingresar.')
      }
    })()
    return () => {
      cancelled = true
    }
  }, [loadMe])

  // Fin de sesión (logout, revocación) en esta u otra pestaña.
  useEffect(
    () =>
      onSessionEnded((reason) => {
        setMe(null)
        setContingencyUser(null)
        setStatus('anonymous')
        setNotice(NOTICES[reason])
        stopEvents()
      }),
    [],
  )

  // Login en otra pestaña: esta también entra.
  useEffect(
    () =>
      onLoginElsewhere(() => {
        loadMe().catch(() => undefined)
      }),
    [loadMe],
  )

  useEffect(
    () =>
      onEvent('session.revoked', (ev) => {
        const reason =
          typeof ev.data === 'object' && ev.data !== null && 'reason' in ev.data && ev.data.reason === 'REFRESH_REUSED'
            ? 'REFRESH_REUSED'
            : 'SESSION_REVOKED'
        endSession(reason)
      }),
    [],
  )

  // Un solo stream de eventos por navegador mientras haya sesión.
  useEffect(() => {
    if (status === 'authenticated') startEvents()
  }, [status])

  const login = useCallback(
    async (email: string, password: string) => {
      const { data } = await rawRequest<LoginResponse>('/auth/login', { method: 'POST', body: { email, password } })
      startSession(data)
      setNotice(null)
      await loadMe()
    },
    [loadMe],
  )

  const register = useCallback(
    async (teamName: string, email: string, password: string) => {
      const { data } = await rawRequest<RegisterResponse>('/auth/register', {
        method: 'POST',
        body: { teamName, email, password },
      })
      startSession(data)
      setNotice(null)
      await loadMe()
      return data
    },
    [loadMe],
  )

  const logout = useCallback(async () => {
    await sessionLogout()
  }, [])

  const value = useMemo<AuthValue>(
    () => ({
      status,
      me,
      notice,
      clearNotice: () => setNotice(null),
      login,
      register,
      logout,
      reloadMe: loadMe,
      can: (p) => me?.permissions.includes(p) ?? false,
    }),
    [status, me, notice, login, register, logout, loadMe],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth fuera de AuthProvider')
  return ctx
}
