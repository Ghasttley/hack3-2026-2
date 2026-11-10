import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { errorMessage, fieldErrors, isApiError } from '../lib/errors'

type Field = 'teamName' | 'email' | 'password'

/** Registro de la cuadrilla: crea la cuenta y entra directo. Errores del servidor junto a su campo. */
export default function RegisterPage() {
  const { register } = useAuth()
  const navigate = useNavigate()
  const [values, setValues] = useState<Record<Field, string>>({ teamName: '', email: '', password: '' })
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({})
  const [general, setGeneral] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    setErrors({})
    setGeneral(null)
    try {
      await register(values.teamName.trim(), values.email.trim(), values.password)
      navigate('/estado', { replace: true })
    } catch (err) {
      const next: Partial<Record<Field, string>> = {}
      if (isApiError(err)) {
        if (err.code === 'EMAIL_TAKEN') next.email = 'Ese email ya está registrado.'
        else if (err.code === 'TEAM_NAME_TAKEN') next.teamName = 'Ese nombre de cuadrilla ya existe.'
        const fe = fieldErrors(err)
        for (const f of ['teamName', 'email', 'password'] as const) if (fe[f]) next[f] = fe[f]
      }
      setErrors(next)
      if (Object.keys(next).length === 0) setGeneral(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  function field(name: Field, label: string, type: string, autoComplete: string, hint?: string) {
    const errId = `${name}-error`
    return (
      <div>
        <label htmlFor={name} className="label">
          {label}
        </label>
        <input
          id={name}
          type={type}
          autoComplete={autoComplete}
          className="input"
          value={values[name]}
          aria-invalid={errors[name] ? true : undefined}
          aria-describedby={errors[name] ? errId : undefined}
          onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
        />
        {hint && !errors[name] && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
        {errors[name] && (
          <p id={errId} className="mt-1 text-sm text-red-300">
            {errors[name]}
          </p>
        )}
      </div>
    )
  }

  return (
    <main className="grid min-h-screen place-items-center bg-slate-950 p-4 text-slate-100">
      <form onSubmit={onSubmit} className="w-full max-w-sm space-y-4 rounded-lg border border-slate-800 bg-slate-900 p-6" noValidate>
        <h1 className="text-2xl font-semibold">Registrar cuadrilla</h1>
        {field('teamName', 'Nombre de la cuadrilla', 'text', 'organization', 'Entre 3 y 40 caracteres.')}
        {field('email', 'Email', 'email', 'email')}
        {field('password', 'Contraseña', 'password', 'new-password', 'Entre 8 y 72 caracteres.')}
        {general && (
          <p role="alert" className="text-sm text-red-300">
            {general}
          </p>
        )}
        <button type="submit" className="btn-primary w-full" disabled={busy}>
          {busy ? 'Registrando…' : 'Registrar y entrar'}
        </button>
        <p className="text-sm text-slate-300">
          ¿Ya tienen cuenta?{' '}
          <Link to="/login" className="text-sky-300 underline">
            Ingresar
          </Link>
        </p>
      </form>
    </main>
  )
}
