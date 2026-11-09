import { useEffect, useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { ErrorBox, Notice, PageTitle, Spinner } from '../components/ui'
import { StreamIndicator } from '../components/Layout'
import { config, missingConfig } from '../config'
import { api } from '../lib/api'
import { errorMessage, fieldErrors, isApiError } from '../lib/errors'
import { rawRequest } from '../lib/http'
import type {
  Check,
  Clearance,
  ClearanceCheckResult,
  DeployChallenge,
  Health,
  IntegrationStatus,
  RosterMember,
  StorageResult,
} from '../lib/types'
import { useApiQuery } from '../lib/useApiQuery'
import { formatDate } from '../lib/util'

function Checks({ checks }: { checks: Check[] }) {
  if (checks.length === 0) return <p className="text-sm text-slate-400">Sin comprobaciones todavía.</p>
  return (
    <ul className="space-y-1 text-sm">
      {checks.map((c) => (
        <li key={c.name} className="flex gap-2">
          <span aria-hidden="true">{c.passed ? '✅' : '❌'}</span>
          <span>
            <strong>{c.name}</strong> — {c.passed ? 'aprobada' : 'pendiente'}: {c.detail}
          </span>
        </li>
      ))}
    </ul>
  )
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-slate-800 bg-slate-900 p-4" aria-labelledby={`card-${title}`}>
      <h2 id={`card-${title}`} className="mb-3 text-lg font-semibold">
        {title}
      </h2>
      {children}
    </section>
  )
}

/** /estado: build desplegado, salud de la API, integraciones, clearance y la revisión automática. */
export default function EstadoPage() {
  const { me, can, reloadMe } = useAuth()
  const health = useApiQuery<Health>('health', (signal) => rawRequest<Health>('/meta/health', { signal }).then((r) => r.data))
  const status = useApiQuery<IntegrationStatus>('integrations', (signal) => api('/integrations/status', { signal }))
  const clearance = useApiQuery<Clearance>('clearance', (signal) => api('/clearance', { signal }))
  const missing = missingConfig()

  // --- revisión automática ---
  const [checkBusy, setCheckBusy] = useState(false)
  const [checkResult, setCheckResult] = useState<ClearanceCheckResult | null>(null)
  const [checkError, setCheckError] = useState<unknown>(null)
  async function runCheck() {
    if (checkBusy) return
    setCheckBusy(true)
    setCheckError(null)
    try {
      const res = await api<ClearanceCheckResult>('/clearance/check', { method: 'POST', retries: 2 })
      setCheckResult(res)
      if (res.granted) await reloadMe()
      clearance.reload()
      status.reload()
    } catch (e) {
      setCheckError(e)
    } finally {
      setCheckBusy(false)
    }
  }

  // --- dominio ---
  const [origin, setOrigin] = useState(window.location.origin)
  const [challenge, setChallenge] = useState<DeployChallenge | null>(null)
  const [deployMsg, setDeployMsg] = useState<string | null>(null)
  const [deployBusy, setDeployBusy] = useState(false)
  async function requestChallenge(e: FormEvent) {
    e.preventDefault()
    setDeployBusy(true)
    setDeployMsg(null)
    try {
      setChallenge(await api<DeployChallenge>('/integrations/deploy/challenge', { method: 'POST', body: { origin: origin.trim() } }))
    } catch (err) {
      setDeployMsg(errorMessage(err))
    } finally {
      setDeployBusy(false)
    }
  }
  async function verifyDeploy() {
    setDeployBusy(true)
    setDeployMsg(null)
    try {
      const res = await api<{ origin: string; verifiedAt: string }>('/integrations/deploy/verify', { method: 'POST' })
      setDeployMsg(`Dominio verificado: ${res.origin}`)
      status.reload()
    } catch (err) {
      setDeployMsg(errorMessage(err))
    } finally {
      setDeployBusy(false)
    }
  }

  // --- storage ---
  const [storage, setStorage] = useState<StorageResult | null>(null)
  const [storageError, setStorageError] = useState<unknown>(null)
  const [storageBusy, setStorageBusy] = useState(false)
  async function registerStorage() {
    setStorageBusy(true)
    setStorageError(null)
    const body =
      config.storageProvider === 'SUPABASE'
        ? { provider: 'SUPABASE', projectUrl: config.supabase.url, bucket: config.supabase.bucket, publicKey: config.supabase.publishableKey }
        : { provider: 'CLOUDINARY', cloudName: config.cloudinary.cloudName, uploadPreset: config.cloudinary.uploadPreset }
    try {
      setStorage(await api<StorageResult>('/integrations/storage', { method: 'PUT', body }))
      status.reload()
    } catch (err) {
      setStorageError(err)
      if (isApiError(err) && err.details && typeof err.details === 'object' && 'checks' in err.details) {
        const checks = (err.details as { checks: unknown }).checks
        if (Array.isArray(checks)) setStorage({ provider: config.storageProvider ?? 'SUPABASE', verifiedAt: '', checks: checks as Check[] })
      }
    } finally {
      setStorageBusy(false)
    }
  }

  // --- roster ---
  const [roster, setRoster] = useState<RosterMember[]>([
    { name: '', code: '' },
    { name: '', code: '' },
    { name: '', code: '' },
  ])
  const [rosterMsg, setRosterMsg] = useState<string | null>(null)
  useEffect(() => {
    const members = clearance.data?.roster.members
    if (members && members.length === 3) setRoster(members)
  }, [clearance.data])
  async function saveRoster(e: FormEvent) {
    e.preventDefault()
    setRosterMsg(null)
    try {
      await api('/team/roster', { method: 'PUT', body: { members: roster.map((m) => ({ name: m.name.trim(), code: m.code.trim() })) } })
      setRosterMsg('Integrantes inscritos.')
      clearance.reload()
    } catch (err) {
      const fe = fieldErrors(err)
      setRosterMsg(Object.keys(fe).length ? Object.values(fe).join(' · ') : errorMessage(err))
    }
  }

  // --- caos ---
  const [chaos, setChaos] = useState<number | null>(null)
  const [chaosMsg, setChaosMsg] = useState<string | null>(null)
  useEffect(() => {
    if (clearance.data) setChaos(clearance.data.workspace.chaosLevel)
  }, [clearance.data])
  async function saveChaos(level: number) {
    setChaosMsg(null)
    try {
      const res = await api<{ level: number }>('/workspace/chaos', { method: 'PUT', body: { level } })
      setChaos(res.level)
      setChaosMsg(`Modo caos en nivel ${res.level}.`)
    } catch (err) {
      setChaosMsg(errorMessage(err))
    }
  }

  const granted = clearance.data?.granted ?? me?.clearance.granted ?? false

  return (
    <div className="space-y-4">
      <PageTitle>Estado</PageTitle>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Despliegue">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
            <dt className="text-slate-400">Build</dt>
            <dd className="font-mono">{config.buildSha}</dd>
            <dt className="text-slate-400">Origen</dt>
            <dd className="font-mono break-all">{window.location.origin}</dd>
            <dt className="text-slate-400">API</dt>
            <dd>
              {health.loading ? 'verificando…' : health.error ? `no responde (${errorMessage(health.error)})` : `responde (${health.data?.service ?? ''})`}
            </dd>
            <dt className="text-slate-400">Eventos</dt>
            <dd>
              <StreamIndicator />
            </dd>
            <dt className="text-slate-400">Cuadrilla</dt>
            <dd>
              {me?.team.name} ({me?.team.code})
            </dd>
          </dl>
          {missing.length > 0 && (
            <div className="mt-3">
              <Notice tone="warn">Faltan variables de entorno: {missing.join(', ')}</Notice>
            </div>
          )}
        </Card>

        <Card title="Piso de Pruebas">
          {clearance.loading && !clearance.data && <Spinner />}
          {clearance.error ? <ErrorBox error={clearance.error} onRetry={clearance.reload} /> : null}
          <p className="mb-3 text-sm">
            Estado: <strong>{granted ? 'abierto' : 'cerrado'}</strong>
            {clearance.data?.grantedAt && ` desde ${formatDate(clearance.data.grantedAt)}`}
          </p>
          <Checks checks={checkResult?.checks ?? clearance.data?.checks ?? []} />
          <button type="button" className="btn-primary mt-3" onClick={() => void runCheck()} disabled={checkBusy}>
            {checkBusy ? 'Revisando…' : 'Abrir el Piso de Pruebas'}
          </button>
          {checkError ? (
            <div className="mt-3">
              <ErrorBox error={checkError} />
            </div>
          ) : null}
          {clearance.data && (
            <div className="mt-4 text-sm text-slate-300">
              <p>
                Ronda de control: {clearance.data.round.approved ? `aprobada (ronda ${clearance.data.round.approvedRound ?? ''})` : 'sin aprobar'}
              </p>
              {clearance.data.round.drawnMember && (
                <p>
                  Sorteado: {clearance.data.round.drawnMember.name} (ronda {clearance.data.round.drawnMember.round})
                </p>
              )}
              {clearance.data.round.nextRoundAt && <p>Próxima ronda: {formatDate(clearance.data.round.nextRoundAt)}</p>}
              <p>Workspace: {clearance.data.workspace.kind}</p>
            </div>
          )}
        </Card>

        <Card title="Dominio verificado">
          {status.data && (
            <p className="mb-2 text-sm">
              Origen verificado: <span className="font-mono">{status.data.deploy.origin ?? 'ninguno'}</span>
              {status.data.deploy.lastBuildSeen && ` · último build visto: ${status.data.deploy.lastBuildSeen}`}
            </p>
          )}
          <form onSubmit={(e) => void requestChallenge(e)} className="flex flex-wrap items-end gap-2">
            <div className="grow">
              <label htmlFor="origin" className="label">
                Origen de producción (https)
              </label>
              <input id="origin" className="input" value={origin} onChange={(e) => setOrigin(e.target.value)} />
            </div>
            <button type="submit" className="btn-secondary" disabled={deployBusy}>
              1. Pedir token
            </button>
            <button type="button" className="btn-secondary" disabled={deployBusy} onClick={() => void verifyDeploy()}>
              3. Verificar
            </button>
          </form>
          {challenge && (
            <div className="mt-3 text-sm">
              <p>
                2. Publica este texto (solo el token) en <code>public{challenge.wellKnownPath}</code>, haz commit y despliega:
              </p>
              <pre className="mt-1 overflow-x-auto rounded bg-slate-950 p-2 font-mono">{challenge.token}</pre>
              <p className="text-slate-400">Vence: {formatDate(challenge.expiresAt)}</p>
            </div>
          )}
          {deployMsg && (
            <p role="status" className="mt-2 text-sm">
              {deployMsg}
            </p>
          )}
        </Card>

        <Card title="Storage de imágenes">
          <p className="mb-2 text-sm">
            Proveedor configurado: <strong>{config.storageProvider ?? 'ninguno'}</strong>
            {status.data?.storage.verifiedAt && ` · verificado ${formatDate(status.data.storage.verifiedAt)}`}
          </p>
          <button type="button" className="btn-secondary" disabled={storageBusy || !config.storageProvider} onClick={() => void registerStorage()}>
            {storageBusy ? 'Verificando…' : 'Registrar y verificar storage'}
          </button>
          <div className="mt-3">
            <Checks checks={storage?.checks ?? status.data?.storage.checks ?? []} />
          </div>
          {storageError ? (
            <div className="mt-3">
              <ErrorBox error={storageError} />
            </div>
          ) : null}
        </Card>

        {can('team:manage') && (
          <Card title="Integrantes (rondas de control)">
            {clearance.data?.roster.locked && <Notice>La lista está bloqueada.</Notice>}
            <form onSubmit={(e) => void saveRoster(e)} className="space-y-2">
              {roster.map((m, i) => (
                <fieldset key={i} className="grid grid-cols-2 gap-2">
                  <legend className="sr-only">Integrante {i + 1}</legend>
                  <div>
                    <label htmlFor={`rn-${i}`} className="label">
                      Nombre {i + 1}
                    </label>
                    <input
                      id={`rn-${i}`}
                      className="input"
                      value={m.name}
                      disabled={clearance.data?.roster.locked}
                      onChange={(e) => setRoster((r) => r.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                    />
                  </div>
                  <div>
                    <label htmlFor={`rc-${i}`} className="label">
                      Código UTEC {i + 1}
                    </label>
                    <input
                      id={`rc-${i}`}
                      className="input"
                      value={m.code}
                      disabled={clearance.data?.roster.locked}
                      onChange={(e) => setRoster((r) => r.map((x, j) => (j === i ? { ...x, code: e.target.value } : x)))}
                    />
                  </div>
                </fieldset>
              ))}
              <button type="submit" className="btn-secondary" disabled={clearance.data?.roster.locked}>
                Inscribir integrantes
              </button>
              {rosterMsg && (
                <p role="status" className="text-sm">
                  {rosterMsg}
                </p>
              )}
            </form>
          </Card>
        )}

        <Card title="Modo caos (para probar)">
          <div className="flex gap-2" role="group" aria-label="Nivel de caos">
            {[0, 1, 2].map((lvl) => (
              <button
                key={lvl}
                type="button"
                aria-pressed={chaos === lvl}
                className={chaos === lvl ? 'btn-primary' : 'btn-secondary'}
                onClick={() => void saveChaos(lvl)}
              >
                Nivel {lvl}
              </button>
            ))}
          </div>
          {chaosMsg && (
            <p role="status" className="mt-2 text-sm">
              {chaosMsg}
            </p>
          )}
        </Card>
      </div>
    </div>
  )
}
