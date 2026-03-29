import { useEffect, useRef, type ReactNode } from 'react'
import { X } from 'lucide-react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const previousFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    if (open) {
      previousFocusRef.current = document.activeElement as HTMLElement | null
      dialog.showModal()
    } else {
      dialog.close()
      previousFocusRef.current?.focus()
    }
  }, [open])

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return

    const handleCancel = (e: Event) => {
      e.preventDefault()
      onClose()
    }

    dialog.addEventListener('cancel', handleCancel)
    return () => dialog.removeEventListener('cancel', handleCancel)
  }, [onClose])

  const handleBackdropClick = (e: React.MouseEvent<HTMLDialogElement>) => {
    if (e.target === dialogRef.current) {
      onClose()
    }
  }

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      onClick={handleBackdropClick}
      className="
        m-auto w-full max-w-md rounded-2xl bg-white p-0 shadow-xl
        backdrop:bg-black/40 backdrop:backdrop-blur-sm
        open:animate-in open:fade-in-0 open:zoom-in-95
        max-sm:mt-auto max-sm:mb-0 max-sm:max-w-none max-sm:rounded-b-none
      "
      aria-labelledby="modal-title"
    >
      <div className="flex items-center justify-between border-b border-slate-100 px-6 py-4">
        <h2 id="modal-title" className="text-lg font-semibold text-slate-900">
          {title}
        </h2>
        <button
          onClick={onClose}
          className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600"
          aria-label="Close"
        >
          <X size={18} />
        </button>
      </div>
      <div className="px-6 py-4">{children}</div>
    </dialog>
  )
}
