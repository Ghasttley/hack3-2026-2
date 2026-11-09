import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router'
import { BadgeImage } from '../../components/BadgeImage'
import { ErrorBox, Notice, PageTitle, ProgressBar, Spinner } from '../../components/ui'
import { detail, errorMessage, isApiError, isRecord } from '../../lib/errors'
import { fetchRefiner, patchRefiner } from '../../lib/refinerApi'
import { upsertRefiner, useRefiner } from '../../lib/refiners'
import type { Refiner } from '../../lib/types'
import { Cropper } from './Cropper'
import { loadBitmap, makeBadge, WebpUnsupportedError, type Crop } from './image'
import { ImagePicker } from './ImagePicker'
import { useUpload } from './useUpload'

const PHASE_TEXT = {
  idle: '',
  ticket: 'Pidiendo permiso para subir…',
  uploading: 'Subiendo al storage…',
  confirming: 'Lumon está comprobando la imagen…',
  done: 'Imagen confirmada.',
  error: 'Error',
  cancelled: 'Subida cancelada.',
} as const

/** Editor de fotocheck: recorte cuadrado → 512×512 WebP sin metadatos → ticket → storage → confirmar → PATCH. */
export default function BadgePage() {
  const { id } = useParams()
  const refinerId = /^\d+$/.test(id ?? '') ? Number(id) : 0
  const live = useRefiner(refinerId)
  const [etag, setEtag] = useState<string | null>(null)
  const [loadError, setLoadError] = useState<unknown>(null)
  const [image, setImage] = useState<{ bitmap: ImageBitmap; url: string } | null>(null)
  const [pickError, setPickError] = useState<string | null>(null)
  const [processing, setProcessing] = useState(false)
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [conflict, setConflict] = useState<{ server: Refiner; etag: string } | null>(null)
  const cropRef = useRef<Crop | null>(null)
  const pendingMedia = useRef<number | null>(null)
  const upload = useUpload('BADGE')

  useEffect(() => {
    if (!refinerId) return
    const c = new AbortController()
    fetchRefiner(refinerId, c.signal)
      .then((r) => setEtag(r.etag))
      .catch((e: unknown) => {
        if (!c.signal.aborted) setLoadError(e)
      })
    return () => c.abort()
  }, [refinerId])

  useEffect(() => () => {
    if (image) URL.revokeObjectURL(image.url)
  }, [image])

  const onFiles = useCallback(async (files: File[]) => {
    const file = files[0]
    if (!file) return
    setPickError(null)
    setSaveState('idle')
    try {
      const bitmap = await loadBitmap(file)
      setImage({ bitmap, url: URL.createObjectURL(file) })
    } catch (e) {
      setPickError(errorMessage(e))
    }
  }, [])

  const onCrop = useCallback((c: Crop) => {
    cropRef.current = c
  }, [])

  async function applyBadge(mediaId: number, useEtag: string) {
    setSaveState('saving')
    setSaveError(null)
    try {
      const res = await patchRefiner(refinerId, useEtag, { badgeMediaId: mediaId })
      setEtag(res.etag)
      setSaveState('saved')
      setConflict(null)
      pendingMedia.current = null
    } catch (e) {
      if (isApiError(e) && e.code === 'VERSION_CONFLICT') {
        const current = detail(e, 'current')
        if (isRecord(current) && typeof current.version === 'number') {
          const server = current as unknown as Refiner
          upsertRefiner(server)
          setConflict({ server, etag: e.headers?.get('ETag') ?? `"${server.version}"` })
          setSaveState('idle')
          return
        }
      }
      setSaveState('error')
      setSaveError(errorMessage(e))
    }
  }

  async function submit() {
    if (!image || !cropRef.current || !etag) return
    setProcessing(true)
    setPickError(null)
    try {
      const img = await makeBadge(image.bitmap, cropRef.current)
      setProcessing(false)
      const media = await upload.start(img)
      if (media) {
        pendingMedia.current = media.mediaId
        await applyBadge(media.mediaId, etag)
      }
    } catch (e) {
      setPickError(e instanceof WebpUnsupportedError ? e.message : errorMessage(e))
    } finally {
      setProcessing(false)
    }
  }

  async function retry() {
    if (upload.state.phase === 'done' && pendingMedia.current && etag) {
      await applyBadge(pendingMedia.current, etag)
      return
    }
    const media = await upload.retry()
    if (media && etag) {
      pendingMedia.current = media.mediaId
      await applyBadge(media.mediaId, etag)
    }
  }

  if (!refinerId) return <ErrorBox error={new Error('Expediente inválido.')} />
  if (loadError) return <ErrorBox error={loadError} />
  if (!live || !etag) return <Spinner />

  const { phase, progress, error } = upload.state
  const busy = processing || phase === 'ticket' || phase === 'uploading' || phase === 'confirming' || saveState === 'saving'

  return (
    <section>
      <PageTitle actions={<Link to={`/refiners/${refinerId}`} className="btn-secondary">Volver</Link>}>Fotocheck de {live.fullName}</PageTitle>
      <div className="flex flex-wrap gap-8">
        <div>
          <h2 className="mb-2 text-sm text-slate-300">Actual</h2>
          <BadgeImage badge={live.badge} name={live.fullName} size={160} />
        </div>
        <div className="min-w-72 flex-1 space-y-4">
          <ImagePicker onFiles={(f) => void onFiles(f)} disabled={busy} label="Elegir archivo" />
          {pickError && (
            <p role="alert" className="text-sm text-red-300">
              {pickError}
            </p>
          )}
          {image && <Cropper key={image.url} bitmap={image.bitmap} src={image.url} onChange={onCrop} />}
          {image && (
            <button type="button" className="btn-primary" disabled={busy} onClick={() => void submit()}>
              {processing ? 'Procesando…' : 'Recortar y subir'}
            </button>
          )}

          {phase !== 'idle' && (
            <div className="space-y-2" aria-live="polite">
              <p className="text-sm">
                {PHASE_TEXT[phase]} {phase === 'uploading' && `${Math.round(progress * 100)} %`}
              </p>
              {(phase === 'uploading' || phase === 'confirming') && <ProgressBar value={progress} label="Progreso de la subida" />}
              {error && (
                <p role="alert" className="text-sm text-red-300">
                  {error}
                </p>
              )}
              <div className="flex gap-2">
                {(phase === 'ticket' || phase === 'uploading') && (
                  <button type="button" className="btn-secondary" onClick={upload.cancel}>
                    Cancelar
                  </button>
                )}
                {(phase === 'error' || phase === 'cancelled' || saveState === 'error') && (
                  <button type="button" className="btn-secondary" onClick={() => void retry()}>
                    Reintentar
                  </button>
                )}
              </div>
            </div>
          )}
          {saveState === 'saving' && <p className="text-sm">Actualizando el expediente…</p>}
          {saveState === 'saved' && <Notice tone="ok">Fotocheck actualizado.</Notice>}
          {saveError && (
            <p role="alert" className="text-sm text-red-300">
              No se pudo actualizar el expediente: {saveError}
            </p>
          )}
          {conflict && (
            <div className="space-y-2 rounded-lg border border-amber-500 p-3" role="alertdialog" aria-labelledby="badge-conflict">
              <h2 id="badge-conflict" className="font-semibold">
                El expediente cambió mientras subías
              </h2>
              <p className="text-sm text-slate-300">
                Ahora está en la versión {conflict.server.version}. Este es el fotocheck que hay en el servidor; ¿quieres reemplazarlo por el
                nuevo?
              </p>
              <BadgeImage badge={conflict.server.badge} name={conflict.server.fullName} size={96} />
              <div className="flex gap-2">
                <button type="button" className="btn-primary" onClick={() => void applyBadge(pendingMedia.current ?? 0, conflict.etag)}>
                  Usar el nuevo fotocheck
                </button>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => {
                    setEtag(conflict.etag)
                    setConflict(null)
                  }}
                >
                  Conservar el del servidor
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
