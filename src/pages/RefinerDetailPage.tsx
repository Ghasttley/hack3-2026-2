import { Link, useParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { BadgeImage } from '../components/BadgeImage'
import { ErrorBox, PageTitle, Spinner } from '../components/ui'
import { fetchRefiner } from '../lib/refinerApi'
import { useRefiner } from '../lib/refiners'
import { useApiQuery } from '../lib/useApiQuery'
import { formatDate, isHttpUrl } from '../lib/util'

export default function RefinerDetailPage() {
  const { id } = useParams()
  const refinerId = /^\d+$/.test(id ?? '') ? Number(id) : 0
  const { can } = useAuth()
  const q = useApiQuery(refinerId ? `refiner-${refinerId}` : null, (signal) => fetchRefiner(refinerId, signal))
  const live = useRefiner(refinerId)
  const r = live ?? q.data?.refiner

  if (!refinerId) return <ErrorBox error={new Error('Expediente inválido.')} />
  if (q.error && !r) return <ErrorBox error={q.error} onRetry={q.reload} />
  if (!r) return <Spinner />

  return (
    <article>
      <PageTitle
        actions={
          <div className="flex gap-2">
            {can('refiners:write') && (
              <Link to={`/refiners/${r.id}/edit`} className="btn-secondary">
                Editar
              </Link>
            )}
            {can('refiners:write') && can('media:upload') && (
              <Link to={`/refiners/${r.id}/badge`} className="btn-secondary">
                Cambiar fotocheck
              </Link>
            )}
          </div>
        }
      >
        {r.fullName}
      </PageTitle>
      <div className="flex flex-wrap gap-6">
        <BadgeImage badge={r.badge} name={r.fullName} size={192} />
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          <dt className="text-slate-400">Cargo</dt>
          <dd>{r.title}</dd>
          <dt className="text-slate-400">Departamento</dt>
          <dd>{r.department.name}</dd>
          <dt className="text-slate-400">Extensión</dt>
          <dd>{r.extension}</dd>
          <dt className="text-slate-400">Perfil</dt>
          <dd>
            {isHttpUrl(r.profileUrl) ? (
              <a href={r.profileUrl} target="_blank" rel="noopener noreferrer" className="text-sky-300 underline">
                {r.profileUrl}
              </a>
            ) : (
              '—'
            )}
          </dd>
          <dt className="text-slate-400">Versión</dt>
          <dd>
            {r.version} · {formatDate(r.updatedAt)}
          </dd>
        </dl>
      </div>
      <h2 className="mt-6 mb-2 font-semibold">Biografía</h2>
      {/* Texto del exterior: se muestra como texto, nunca se interpreta como HTML. */}
      <p className="whitespace-pre-wrap text-slate-200">{r.bio}</p>
    </article>
  )
}
