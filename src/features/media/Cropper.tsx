import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { clamp } from '../../lib/util'
import type { Crop } from './image'

const FRAME = 288

/**
 * Recorte cuadrado con arrastre (Pointer Events) y zoom (rueda, slider o teclado).
 * Sin librerías de recorte.
 */
export function Cropper({ bitmap, src, onChange }: { bitmap: ImageBitmap; src: string; onChange: (crop: Crop) => void }) {
  const minScale = FRAME / Math.min(bitmap.width, bitmap.height)
  const [zoom, setZoom] = useState(1)
  const scale = minScale * zoom
  const [offset, setOffset] = useState(() => ({
    x: (FRAME - bitmap.width * minScale) / 2,
    y: (FRAME - bitmap.height * minScale) / 2,
  }))
  const drag = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null)

  const limit = (x: number, y: number, s: number) => ({
    x: clamp(x, FRAME - bitmap.width * s, 0),
    y: clamp(y, FRAME - bitmap.height * s, 0),
  })

  useEffect(() => {
    onChange({ sx: -offset.x / scale, sy: -offset.y / scale, size: FRAME / scale })
  }, [offset, scale, onChange])

  function setZoomKeepCenter(nextZoom: number) {
    const z = clamp(nextZoom, 1, 5)
    const nextScale = minScale * z
    const cx = (FRAME / 2 - offset.x) / scale
    const cy = (FRAME / 2 - offset.y) / scale
    setZoom(z)
    setOffset(limit(FRAME / 2 - cx * nextScale, FRAME / 2 - cy * nextScale, nextScale))
  }

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.currentTarget.setPointerCapture(e.pointerId)
    drag.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y }
  }
  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    const d = drag.current
    if (!d) return
    setOffset(limit(d.ox + e.clientX - d.x, d.oy + e.clientY - d.y, scale))
  }
  function onKeyDown(e: KeyboardEvent) {
    const step = e.shiftKey ? 40 : 10
    const moves: Record<string, [number, number]> = { ArrowLeft: [step, 0], ArrowRight: [-step, 0], ArrowUp: [0, step], ArrowDown: [0, -step] }
    const mv = moves[e.key]
    if (mv) {
      e.preventDefault()
      setOffset(limit(offset.x + mv[0], offset.y + mv[1], scale))
    } else if (e.key === '+' || e.key === '=') {
      e.preventDefault()
      setZoomKeepCenter(zoom + 0.1)
    } else if (e.key === '-') {
      e.preventDefault()
      setZoomKeepCenter(zoom - 0.1)
    }
  }

  return (
    <div className="space-y-3">
      <div
        tabIndex={0}
        role="group"
        aria-label="Área de recorte. Flechas para mover, + y − para acercar o alejar."
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={() => (drag.current = null)}
        onPointerCancel={() => (drag.current = null)}
        onWheel={(e) => setZoomKeepCenter(zoom - Math.sign(e.deltaY) * 0.1)}
        onKeyDown={onKeyDown}
        className="relative cursor-move touch-none overflow-hidden rounded-md border-2 border-sky-500 bg-slate-800"
        style={{ width: FRAME, height: FRAME }}
      >
        <img
          src={src}
          alt="Imagen a recortar"
          draggable={false}
          className="pointer-events-none absolute max-w-none select-none"
          style={{
            left: offset.x,
            top: offset.y,
            width: bitmap.width * scale,
            height: bitmap.height * scale,
          }}
        />
      </div>
      <div style={{ width: FRAME }}>
        <label htmlFor="zoom" className="label">
          Zoom
        </label>
        <input
          id="zoom"
          type="range"
          min={1}
          max={5}
          step={0.05}
          value={zoom}
          onChange={(e) => setZoomKeepCenter(Number(e.target.value))}
          className="w-full"
        />
      </div>
    </div>
  )
}
