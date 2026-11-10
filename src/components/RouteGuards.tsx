import type { ReactNode } from 'react'
import { Navigate, useLocation } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import type { Permission } from '../lib/types'
import { Splash } from './Splash'
import { NoPermission } from './NoPermission'

/** Ruta privada: sin sesión → login, recordando ruta + query string + hash para volver después. */
export function RequireAuth({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'checking') return <Splash message="Verificando sesión…" />
  if (status === 'anonymous') {
    const from = `${location.pathname}${location.search}${location.hash}`
    return <Navigate to={`/login?next=${encodeURIComponent(from)}`} replace />
  }
  return <>{children}</>
}

/** La interfaz se decide por `permissions` (los roles cambian entre workspaces). */
export function RequirePermission({ permission, children }: { permission: Permission | Permission[]; children: ReactNode }) {
  const { can } = useAuth()
  const needed = Array.isArray(permission) ? permission : [permission]
  const missing = needed.filter((p) => !can(p))
  if (missing.length > 0) return <NoPermission missing={missing} />
  return <>{children}</>
}

/** Solo para rutas públicas (login / registro): con sesión, al destino. */
export function PublicOnly({ children }: { children: ReactNode }) {
  const { status } = useAuth()
  const location = useLocation()
  if (status === 'checking') return <Splash message="Verificando sesión…" />
  if (status === 'authenticated') {
    const next = safeNext(new URLSearchParams(location.search).get('next'))
    return <Navigate to={next} replace />
  }
  return <>{children}</>
}

/** Solo rutas internas (evita open redirect). */
export function safeNext(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) return '/files'
  return next
}
