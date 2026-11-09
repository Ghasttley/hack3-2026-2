import { useEffect } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useAuth } from '../auth/AuthContext'
import { ErrorBox, PageTitle, Pagination, Spinner } from '../components/ui'
import { api, qs } from '../lib/api'
import { onEvent } from '../lib/events'
import type { Incident, Page } from '../lib/types'
import { useApiQuery } from '../lib/useApiQuery'
import { formatDate, isHttpUrl, parseIntParam } from '../lib/util'

export default function IncidentsPage() {
  const { can } = useAuth()
  const [sp, setSp] = useSearchParams()
  const page = parseIntParam(sp.get('page'), 0, 0, 100_000)
  const list = useApiQuery<Page<Incident>>(`incidents-${page}`, (signal) => api(`/incidents${qs({ page, size: 10 })}`, { signal }))
  useEffect(() => onEvent('stream.reset', list.reload), [list.reload])

  return (
    <section>
      <PageTitle
        actions={
          can('incidents:create') && can('media:upload') ? (
            <Link to="/incidents/new" className="btn-primary">
              Nuevo reporte
            </Link>
          ) : null
        }
      >
        Reportes de incidencia
      </PageTitle>
      {list.error ? <ErrorBox error={list.error} onRetry={list.reload} /> : null}
      {list.loading && !list.data && <Spinner />}
      {list.data && (
        <>
          {list.data.content.length === 0 && <p className="text-slate-300">Sin reportes todavía.</p>}
          <ul className="space-y-4">
            {list.data.content.map((inc) => (
              <li key={inc.id} className="rounded-lg border border-slate-800 bg-slate-900 p-4">
                <h2 className="font-semibold">
                  {inc.title} <span className="ml-2 rounded bg-slate-800 px-2 py-0.5 text-xs">{inc.severity}</span>
                </h2>
                <p className="text-xs text-slate-400">
                  {inc.createdBy.displayName} · {formatDate(inc.createdAt)}
                  {inc.file && ` · archivo ${inc.file.name}`}
                </p>
                <p className="mt-2 whitespace-pre-wrap text-sm text-slate-200">{inc.description}</p>
                <div className="mt-3 flex flex-wrap gap-3">
                  {inc.photos.filter((p) => isHttpUrl(p.url)).map((p) => (
                    <img
                      key={p.mediaId}
                      src={p.url}
                      width={p.width}
                      height={p.height}
                      loading="lazy"
                      decoding="async"
                      alt={`Foto del reporte «${inc.title}»`}
                      className="h-auto max-h-48 w-auto max-w-full rounded"
                      style={{ aspectRatio: `${p.width} / ${p.height}` }}
                    />
                  ))}
                </div>
              </li>
            ))}
          </ul>
          <Pagination page={page} totalPages={list.data.totalPages} onPage={(p) => setSp(p ? { page: String(p) } : {})} />
        </>
      )}
    </section>
  )
}
