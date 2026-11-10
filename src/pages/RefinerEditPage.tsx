import { useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { ErrorBox, Notice, PageTitle, Spinner } from '../components/ui'
import { api, apiRequest } from '../lib/api'
import { detail, errorMessage, fieldErrors, isApiError, isRecord } from '../lib/errors'
import { onEvent } from '../lib/events'
import { fetchRefiner, patchRefiner } from '../lib/refinerApi'
import { upsertRefiner, useRefiner } from '../lib/refiners'
import type { Department, Refiner, RefinerPatch } from '../lib/types'
import { useApiQuery } from '../lib/useApiQuery'

type FieldName = 'title' | 'extension' | 'bio' | 'departmentId'
type Values = Record<FieldName, string>
const FIELDS: { name: FieldName; label: string }[] = [
  { name: 'title', label: 'Cargo' },
  { name: 'extension', label: 'Extensión' },
  { name: 'departmentId', label: 'Departamento' },
  { name: 'bio', label: 'Biografía' },
]

function valuesOf(r: Refiner): Values {
  return { title: r.title, extension: r.extension, bio: r.bio, departmentId: String(r.department.id) }
}

function toPatch(values: Values, against: Values): RefinerPatch {
  const patch: RefinerPatch = {}
  if (values.title !== against.title) patch.title = values.title
  if (values.extension !== against.extension) patch.extension = values.extension
  if (values.bio !== against.bio) patch.bio = values.bio
  if (values.departmentId !== against.departmentId) patch.departmentId = Number(values.departmentId)
  return patch
}

interface Conflict {
  server: Refiner
  etag: string
  choice: Record<FieldName, 'mine' | 'server'>
}

/**
 * Regla de Milchick: nunca se sobrescribe lo que no se ha leído.
 * - PATCH con If-Match = ETag leído.
 * - Si llega un refiner.updated mientras se edita, se avisa antes de guardar.
 * - 412 → pantalla de conflicto campo por campo; el usuario elige antes de reintentar con el ETag nuevo.
 */
export default function RefinerEditPage() {
  const { id } = useParams()
  const refinerId = /^\d+$/.test(id ?? '') ? Number(id) : 0
  const navigate = useNavigate()
  const departments = useApiQuery<Department[]>('departments', (signal) => api('/departments', { signal }))
  const [base, setBase] = useState<{ refiner: Refiner; etag: string } | null>(null)
  const [values, setValues] = useState<Values | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({})
  const [conflict, setConflict] = useState<Conflict | null>(null)
  const [remoteBy, setRemoteBy] = useState<string | null>(null)
  const live = useRefiner(refinerId)

  useEffect(() => {
    if (!refinerId) return
    const controller = new AbortController()
    fetchRefiner(refinerId, controller.signal)
      .then((res) => {
        setBase(res)
        setValues(valuesOf(res.refiner))
      })
      .catch((e: unknown) => {
        if (!controller.signal.aborted) setLoadError(e)
      })
    return () => controller.abort()
  }, [refinerId])

  useEffect(
    () =>
      onEvent('refiner.updated', (ev) => {
        if (!isRecord(ev.data) || ev.data.id !== refinerId) return
        const by = isRecord(ev.data.updatedBy) && typeof ev.data.updatedBy.displayName === 'string' ? ev.data.updatedBy.displayName : null
        setRemoteBy(by ?? 'alguien')
      }),
    [refinerId],
  )

  const remoteChanged = !!(base && live && live.version > base.refiner.version)

  async function openConflictFromServer() {
    // Lee la versión actual (con su ETag) antes de decidir.
    const { data, headers } = await apiRequest<Refiner>(`/refiners/${refinerId}`)
    upsertRefiner(data)
    startConflict(data, headers.get('ETag') ?? `"${data.version}"`)
  }

  function startConflict(server: Refiner, etag: string) {
    if (!values || !base) return
    const bv = valuesOf(base.refiner)
    const choice = {} as Record<FieldName, 'mine' | 'server'>
    for (const f of FIELDS) choice[f.name] = values[f.name] !== bv[f.name] ? 'mine' : 'server'
    setConflict({ server, etag, choice })
  }

  async function save(e: FormEvent) {
    e.preventDefault()
    if (!values || !base || saving) return
    setError(null)
    setFieldErrs({})
    if (remoteChanged) {
      // Aviso ANTES de guardar: el expediente cambió mientras editabas.
      try {
        await openConflictFromServer()
      } catch (err) {
        setError(errorMessage(err))
      }
      return
    }
    const patch = toPatch(values, valuesOf(base.refiner))
    if (Object.keys(patch).length === 0) {
      setError('No hay cambios para guardar.')
      return
    }
    await doPatch(base.etag, patch)
  }

  async function doPatch(etag: string, patch: RefinerPatch) {
    setSaving(true)
    try {
      const res = await patchRefiner(refinerId, etag, patch)
      setBase(res)
      setValues(valuesOf(res.refiner))
      setConflict(null)
      setRemoteBy(null)
      navigate(`/refiners/${refinerId}`)
    } catch (err) {
      if (isApiError(err) && err.code === 'VERSION_CONFLICT') {
        const current = detail(err, 'current')
        if (isRecord(current) && typeof current.version === 'number') {
          const server = current as unknown as Refiner
          upsertRefiner(server)
          startConflict(server, err.headers?.get('ETag') ?? `"${server.version}"`)
        } else {
          await openConflictFromServer()
        }
      } else {
        setFieldErrs(fieldErrors(err))
        setError(errorMessage(err))
      }
    } finally {
      setSaving(false)
    }
  }

  async function resolveConflict() {
    if (!conflict || !values) return
    const sv = valuesOf(conflict.server)
    const merged = { ...sv }
    for (const f of FIELDS) if (conflict.choice[f.name] === 'mine') merged[f.name] = values[f.name]
    const patch = toPatch(merged, sv)
    if (Object.keys(patch).length === 0) {
      setBase({ refiner: conflict.server, etag: conflict.etag })
      setValues(sv)
      setConflict(null)
      setRemoteBy(null)
      return
    }
    setValues(merged)
    setBase({ refiner: conflict.server, etag: conflict.etag })
    await doPatch(conflict.etag, patch)
  }

  if (!refinerId) return <ErrorBox error={new Error('Expediente inválido.')} />
  if (loadError) return <ErrorBox error={loadError} />
  if (!base || !values) return <Spinner />

  const depName = (idStr: string) => departments.data?.find((d) => String(d.id) === idStr)?.name ?? idStr

  if (conflict) {
    const sv = valuesOf(conflict.server)
    return (
      <section aria-labelledby="conflict-title">
        <h1 id="conflict-title" className="mb-2 text-2xl font-semibold">
          Conflicto de versión
        </h1>
        <Notice tone="warn">
          El expediente cambió en el servidor (versión {conflict.server.version}) desde que lo abriste. Elige, campo por campo, qué valor
          conservar. Nada se sobrescribe sin tu decisión.
        </Notice>
        <div className="mt-4 space-y-4">
          {FIELDS.map((f) => {
            const mine = f.name === 'departmentId' ? depName(values[f.name]) : values[f.name]
            const server = f.name === 'departmentId' ? depName(sv[f.name]) : sv[f.name]
            const same = values[f.name] === sv[f.name]
            return (
              <fieldset key={f.name} className="rounded-lg border border-slate-800 bg-slate-900 p-3">
                <legend className="px-1 font-semibold">
                  {f.label} {same && <span className="text-xs text-slate-400">(sin diferencias)</span>}
                </legend>
                <div className="grid gap-3 md:grid-cols-2">
                  {(['mine', 'server'] as const).map((side) => (
                    <label key={side} className={`block rounded border p-2 text-sm ${conflict.choice[f.name] === side ? 'border-sky-400' : 'border-slate-700'}`}>
                      <input
                        type="radio"
                        name={`choice-${f.name}`}
                        className="mr-2"
                        checked={conflict.choice[f.name] === side}
                        onChange={() => setConflict({ ...conflict, choice: { ...conflict.choice, [f.name]: side } })}
                      />
                      <strong>{side === 'mine' ? 'Lo que escribiste' : 'Lo que hay en el servidor'}</strong>
                      <span className="mt-1 block whitespace-pre-wrap break-words text-slate-200">{side === 'mine' ? mine : server}</span>
                    </label>
                  ))}
                </div>
              </fieldset>
            )
          })}
        </div>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-300">
            {error}
          </p>
        )}
        <div className="mt-4 flex gap-3">
          <button type="button" className="btn-primary" disabled={saving} onClick={() => void resolveConflict()}>
            {saving ? 'Guardando…' : 'Guardar con la versión actual'}
          </button>
          <button type="button" className="btn-secondary" onClick={() => setConflict(null)}>
            Volver a editar
          </button>
        </div>
      </section>
    )
  }

  return (
    <section>
      <PageTitle actions={<Link to={`/refiners/${refinerId}`} className="btn-secondary">Cancelar</Link>}>Editar: {base.refiner.fullName}</PageTitle>
      {remoteChanged && (
        <div className="mb-4">
          <Notice tone="warn">
            {remoteBy ?? 'Alguien'} modificó este expediente mientras lo editabas (versión {live?.version}). Al guardar podrás comparar los
            cambios campo por campo.
          </Notice>
        </div>
      )}
      <form onSubmit={(e) => void save(e)} className="max-w-xl space-y-4" noValidate>
        <div>
          <label htmlFor="title" className="label">
            Cargo
          </label>
          <input id="title" className="input" maxLength={200} value={values.title} onChange={(e) => setValues({ ...values, title: e.target.value })} />
          {fieldErrs.title && <p className="mt-1 text-sm text-red-300">{fieldErrs.title}</p>}
        </div>
        <div>
          <label htmlFor="extension" className="label">
            Extensión (3 a 6 dígitos)
          </label>
          <input
            id="extension"
            className="input"
            inputMode="numeric"
            value={values.extension}
            onChange={(e) => setValues({ ...values, extension: e.target.value })}
          />
          {fieldErrs.extension && <p className="mt-1 text-sm text-red-300">{fieldErrs.extension}</p>}
        </div>
        <div>
          <label htmlFor="department" className="label">
            Departamento
          </label>
          <select id="department" className="input" value={values.departmentId} onChange={(e) => setValues({ ...values, departmentId: e.target.value })}>
            {(departments.data ?? [base.refiner.department]).map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="bio" className="label">
            Biografía
          </label>
          <textarea id="bio" className="input min-h-32" maxLength={2000} value={values.bio} onChange={(e) => setValues({ ...values, bio: e.target.value })} />
          {fieldErrs.bio && <p className="mt-1 text-sm text-red-300">{fieldErrs.bio}</p>}
        </div>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={saving}>
          {saving ? 'Guardando…' : 'Guardar'}
        </button>
      </form>
    </section>
  )
}
