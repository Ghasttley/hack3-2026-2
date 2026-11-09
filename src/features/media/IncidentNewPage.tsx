import { useCallback, useEffect, useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router'
import { PageTitle, ProgressBar } from '../../components/ui'
import { api } from '../../lib/api'
import { errorMessage, fieldErrors } from '../../lib/errors'
import { SEVERITIES, type Incident, type Severity } from '../../lib/types'
import { uuid } from '../../lib/util'
import { loadBitmap, makeIncidentPhoto, type ProcessedImage } from './image'
import { ImagePicker } from './ImagePicker'
import { useUpload } from './useUpload'

interface PhotoSlot {
  key: string
  file: File
}

/** Una foto: se procesa y sube por su cuenta (en paralelo con las demás), con progreso, cancelar y reintentar. */
function PhotoItem({
  slot,
  onMedia,
  onRemove,
}: {
  slot: PhotoSlot
  onMedia: (key: string, mediaId: number | null) => void
  onRemove: (key: string) => void
}) {
  const upload = useUpload('INCIDENT')
  const [preview] = useState(() => URL.createObjectURL(slot.file))
  const [prepError, setPrepError] = useState<string | null>(null)
  const [processed, setProcessed] = useState<ProcessedImage | null>(null)
  const { start } = upload

  useEffect(() => () => URL.revokeObjectURL(preview), [preview])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const bitmap = await loadBitmap(slot.file)
        const img = await makeIncidentPhoto(bitmap)
        if (cancelled) return
        setProcessed(img)
        const media = await start(img)
        if (!cancelled && media) onMedia(slot.key, media.mediaId)
      } catch (e) {
        if (!cancelled) setPrepError(errorMessage(e))
      }
    })()
    return () => {
      cancelled = true
    }
  }, [slot, start, onMedia])

  const { phase, progress, error } = upload.state
  return (
    <li className="flex gap-3 rounded-lg border border-slate-800 bg-slate-900 p-3">
      <img src={preview} alt={`Vista previa de ${slot.file.name}`} width={96} height={96} className="h-24 w-24 rounded object-cover" />
      <div className="min-w-0 flex-1 space-y-1 text-sm">
        <p className="truncate">{slot.file.name}</p>
        {processed && (
          <p className="text-xs text-slate-400">
            {processed.width}×{processed.height} · {Math.round(processed.bytes.byteLength / 1024)} KB WebP
          </p>
        )}
        <p aria-live="polite">
          {prepError
            ? `Error: ${prepError}`
            : phase === 'done'
              ? 'Confirmada ✓'
              : phase === 'error'
                ? `Error: ${error ?? ''}`
                : phase === 'cancelled'
                  ? 'Cancelada'
                  : phase === 'uploading'
                    ? `Subiendo ${Math.round(progress * 100)} %`
                    : phase === 'confirming'
                      ? 'Confirmando…'
                      : 'Preparando…'}
        </p>
        {(phase === 'uploading' || phase === 'confirming' || phase === 'done') && (
          <ProgressBar value={progress} label={`Progreso de ${slot.file.name}`} />
        )}
        <div className="flex gap-2 pt-1">
          {(phase === 'ticket' || phase === 'uploading') && (
            <button type="button" className="btn-secondary" onClick={upload.cancel}>
              Cancelar
            </button>
          )}
          {(phase === 'error' || phase === 'cancelled') && (
            <button
              type="button"
              className="btn-secondary"
              onClick={() =>
                void upload.retry().then((m) => {
                  if (m) onMedia(slot.key, m.mediaId)
                })
              }
            >
              Reintentar
            </button>
          )}
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              upload.cancel()
              onRemove(slot.key)
            }}
          >
            Quitar
          </button>
        </div>
      </div>
    </li>
  )
}

/** Reporte de incidencia con 1 a 3 fotos. No se envía hasta que todas estén confirmadas. */
export default function IncidentNewPage() {
  const navigate = useNavigate()
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [severity, setSeverity] = useState<Severity>('MEDIUM')
  const [fileId, setFileId] = useState('')
  const [slots, setSlots] = useState<PhotoSlot[]>([])
  const [media, setMedia] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fieldErrs, setFieldErrs] = useState<Record<string, string>>({})

  const onMedia = useCallback((key: string, mediaId: number | null) => {
    setMedia((m) => {
      const next = { ...m }
      if (mediaId === null) delete next[key]
      else next[key] = mediaId
      return next
    })
  }, [])

  const onRemove = useCallback(
    (key: string) => {
      setSlots((s) => s.filter((x) => x.key !== key))
      onMedia(key, null)
    },
    [onMedia],
  )

  const onFiles = useCallback((files: File[]) => {
    setSlots((s) => [...s, ...files.map((file) => ({ key: uuid(), file }))].slice(0, 3))
  }, [])

  const allConfirmed = slots.length > 0 && slots.every((s) => media[s.key] !== undefined)

  async function submit(e: FormEvent) {
    e.preventDefault()
    if (!allConfirmed || busy) return
    setBusy(true)
    setError(null)
    setFieldErrs({})
    try {
      await api<Incident>('/incidents', {
        method: 'POST',
        body: {
          title: title.trim(),
          description: description.trim(),
          severity,
          fileId: fileId ? Number(fileId) : null,
          mediaIds: slots.map((s) => media[s.key]),
        },
      })
      navigate('/incidents')
    } catch (err) {
      // El formulario y las fotos confirmadas se conservan.
      setFieldErrs(fieldErrors(err))
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section>
      <PageTitle actions={<Link to="/incidents" className="btn-secondary">Volver</Link>}>Nuevo reporte de incidencia</PageTitle>
      <form onSubmit={(e) => void submit(e)} className="max-w-2xl space-y-4" noValidate>
        <div>
          <label htmlFor="it" className="label">
            Título
          </label>
          <input id="it" className="input" maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} />
          {fieldErrs.title && <p className="mt-1 text-sm text-red-300">{fieldErrs.title}</p>}
        </div>
        <div>
          <label htmlFor="id" className="label">
            Descripción
          </label>
          <textarea id="id" className="input min-h-28" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} />
          {fieldErrs.description && <p className="mt-1 text-sm text-red-300">{fieldErrs.description}</p>}
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="is" className="label">
              Severidad
            </label>
            <select id="is" className="input" value={severity} onChange={(e) => setSeverity(e.target.value as Severity)}>
              {SEVERITIES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="if" className="label">
              ID del archivo (opcional)
            </label>
            <input id="if" className="input" inputMode="numeric" value={fileId} onChange={(e) => setFileId(e.target.value.replace(/\D/g, ''))} />
          </div>
        </div>
        <fieldset className="space-y-3">
          <legend className="label">Fotos (1 a 3)</legend>
          {slots.length < 3 && <ImagePicker multiple onFiles={onFiles} label="Elegir fotos" />}
          <ul className="space-y-2">
            {slots.map((slot) => (
              <PhotoItem key={slot.key} slot={slot} onMedia={onMedia} onRemove={onRemove} />
            ))}
          </ul>
        </fieldset>
        {error && (
          <p role="alert" className="text-sm text-red-300">
            No se pudo enviar: {error}
          </p>
        )}
        <button type="submit" className="btn-primary" disabled={!allConfirmed || busy || title.trim().length < 3 || !description.trim()}>
          {busy ? 'Enviando…' : allConfirmed ? 'Enviar reporte' : 'Esperando que se confirmen las fotos…'}
        </button>
      </form>
    </section>
  )
}
