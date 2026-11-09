import { useEffect, useId, useState, type DragEvent } from 'react'

/**
 * Elegir imagen: selector de archivos, arrastrar y soltar (eventos nativos de HTML) o pegar desde el portapapeles.
 */
export function ImagePicker({
  onFiles,
  multiple = false,
  disabled = false,
  label,
}: {
  onFiles: (files: File[]) => void
  multiple?: boolean
  disabled?: boolean
  label: string
}) {
  const id = useId()
  const [over, setOver] = useState(false)

  useEffect(() => {
    if (disabled) return
    const onPaste = (e: ClipboardEvent) => {
      const files = [...(e.clipboardData?.files ?? [])].filter((f) => f.type.startsWith('image/'))
      if (files.length > 0) {
        e.preventDefault()
        onFiles(multiple ? files : files.slice(0, 1))
      }
    }
    window.addEventListener('paste', onPaste)
    return () => window.removeEventListener('paste', onPaste)
  }, [onFiles, multiple, disabled])

  function onDrop(e: DragEvent) {
    e.preventDefault()
    setOver(false)
    if (disabled) return
    const files = [...e.dataTransfer.files].filter((f) => f.type.startsWith('image/'))
    if (files.length > 0) onFiles(multiple ? files : files.slice(0, 1))
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setOver(true)
      }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      className={`rounded-lg border-2 border-dashed p-6 text-center text-sm ${over ? 'border-sky-400 bg-sky-950/40' : 'border-slate-600'}`}
    >
      <p className="mb-2 text-slate-300">Arrastra {multiple ? 'imágenes' : 'una imagen'} aquí, pégala (Ctrl+V) o</p>
      <label htmlFor={id} className="btn-secondary cursor-pointer">
        {label}
      </label>
      <input
        id={id}
        type="file"
        accept="image/*"
        multiple={multiple}
        disabled={disabled}
        className="sr-only"
        onChange={(e) => {
          const files = [...(e.target.files ?? [])]
          if (files.length > 0) onFiles(files)
          e.target.value = ''
        }}
      />
    </div>
  )
}
