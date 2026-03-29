import { useEffect, useState } from 'react'
import { CheckCircle, AlertCircle, X } from 'lucide-react'

export interface ToastMessage {
  id: string
  variant: 'success' | 'error'
  text: string
}

interface ToastProps {
  message: ToastMessage
  onDismiss: (id: string) => void
  duration?: number
}

const variantConfig = {
  success: {
    bg: 'bg-green-50 border-green-200',
    text: 'text-green-800',
    Icon: CheckCircle,
  },
  error: {
    bg: 'bg-red-50 border-red-200',
    text: 'text-red-800',
    Icon: AlertCircle,
  },
}

function Toast({ message, onDismiss, duration = 4000 }: ToastProps) {
  const [exiting, setExiting] = useState(false)

  useEffect(() => {
    const timer = setTimeout(() => setExiting(true), duration)
    return () => clearTimeout(timer)
  }, [duration])

  useEffect(() => {
    if (!exiting) return
    const timer = setTimeout(() => onDismiss(message.id), 300)
    return () => clearTimeout(timer)
  }, [exiting, message.id, onDismiss])

  const config = variantConfig[message.variant]
  const { Icon } = config

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`
        flex items-center gap-3 rounded-lg border px-4 py-3 shadow-lg
        transition-all duration-300
        ${config.bg} ${config.text}
        ${exiting ? 'translate-x-full opacity-0' : 'translate-x-0 opacity-100'}
      `}
    >
      <Icon size={16} className="shrink-0" aria-hidden="true" />
      <p className="flex-1 text-sm">{message.text}</p>
      <button
        onClick={() => onDismiss(message.id)}
        className="shrink-0 rounded p-0.5 hover:bg-black/5"
        aria-label="Dismiss"
      >
        <X size={14} aria-hidden="true" />
      </button>
    </div>
  )
}

interface ToastContainerProps {
  messages: ToastMessage[]
  onDismiss: (id: string) => void
}

export function ToastContainer({ messages, onDismiss }: ToastContainerProps) {
  if (messages.length === 0) return null

  return (
    <div aria-label="Notifications" className="fixed right-4 top-4 z-50 flex w-80 flex-col gap-2">
      {messages.map((msg) => (
        <Toast key={msg.id} message={msg} onDismiss={onDismiss} />
      ))}
    </div>
  )
}
