import { isHttpUrl } from '../lib/util'

/** Fotocheck: tamaño fijo (no mueve el layout al cargar) y carga diferida. */
export function BadgeImage({
  badge,
  name,
  size,
}: {
  badge: { url: string; width: number; height: number } | null
  name: string
  size: number
}) {
  const initials = name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0] ?? '')
    .join('')
    .toUpperCase()
  return (
    <div className="shrink-0 overflow-hidden rounded-md bg-slate-800" style={{ width: size, height: size }}>
      {badge && isHttpUrl(badge.url) ? (
        <img
          src={badge.url}
          alt={`Fotocheck de ${name}`}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="h-full w-full object-cover"
        />
      ) : (
        <div className="grid h-full w-full place-items-center font-mono text-lg text-slate-300" role="img" aria-label={`Sin fotocheck: ${name}`}>
          {initials}
        </div>
      )}
    </div>
  )
}
