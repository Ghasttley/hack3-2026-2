/**
 * Toda la configuración sale de variables de entorno de Vite (VITE_*).
 * Ninguna URL, bucket, cloud name ni clave va escrita en el código.
 */
function clean(value: string | undefined): string {
  return (value ?? '').trim().replace(/\/+$/, '')
}

export type StorageProvider = 'SUPABASE' | 'CLOUDINARY'

const provider = clean(import.meta.env.VITE_STORAGE_PROVIDER).toUpperCase()

export const config = {
  apiBaseUrl: clean(import.meta.env.VITE_API_BASE_URL),
  wsBaseUrl: clean(import.meta.env.VITE_WS_BASE_URL),
  buildSha: __BUILD_SHA__,
  storageProvider: (provider === 'SUPABASE' || provider === 'CLOUDINARY' ? provider : null) as StorageProvider | null,
  supabase: {
    url: clean(import.meta.env.VITE_SUPABASE_URL),
    publishableKey: (import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? '').trim(),
    bucket: clean(import.meta.env.VITE_SUPABASE_BUCKET) || 'lumon-media',
  },
  cloudinary: {
    cloudName: clean(import.meta.env.VITE_CLOUDINARY_CLOUD_NAME),
    uploadPreset: clean(import.meta.env.VITE_CLOUDINARY_UPLOAD_PRESET),
  },
} as const

export function missingConfig(): string[] {
  const missing: string[] = []
  if (!config.apiBaseUrl) missing.push('VITE_API_BASE_URL')
  if (!config.wsBaseUrl) missing.push('VITE_WS_BASE_URL')
  if (!config.storageProvider) missing.push('VITE_STORAGE_PROVIDER')
  if (config.storageProvider === 'SUPABASE') {
    if (!config.supabase.url) missing.push('VITE_SUPABASE_URL')
    if (!config.supabase.publishableKey) missing.push('VITE_SUPABASE_PUBLISHABLE_KEY')
  }
  if (config.storageProvider === 'CLOUDINARY') {
    if (!config.cloudinary.cloudName) missing.push('VITE_CLOUDINARY_CLOUD_NAME')
    if (!config.cloudinary.uploadPreset) missing.push('VITE_CLOUDINARY_UPLOAD_PRESET')
  }
  return missing
}
