import { useState, type FormEvent } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { safeNext } from '../components/RouteGuards'
import { Notice } from '../components/ui'
import { errorMessage, isApiError } from '../lib/errors'

export default function LoginPage() {
  const { login, notice } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const next = safeNext(new URLSearchParams(location.search).get('next'))
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await login(email.trim(), password)
      navigate(next, { replace: true })
    } catch (err) {
      setError(
        isApiError(err) && err.code === 'INVALID_CREDENTIALS' ? 'Email o contraseña incorrectos.' : errorMessage(err),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-4 text-slate-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6" noValidate>
        <h1 className="text-2xl font-semibold">Ingresar al piso</h1>
        {notice && <Notice tone="warn">{notice}</Notice>}
        <div>
          <label htmlFor="email" className="label">
            Email
          </label>
          <input id="email" type="email" autoComplete="email" required className="input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Contraseña
          </label>
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Ingresando…' : 'Ingresar'}
        </button>
        <p className="text-sm text-slate-300">
          ¿Primera vez?{' '}
          <Link to={`/register${location.search}`} className="text-sky-300 underline">
            Registrar cuadrilla
          </Link>
        </p>
      </form>
    </main>
  )
}
