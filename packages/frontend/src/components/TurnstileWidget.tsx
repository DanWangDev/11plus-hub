import { Turnstile } from '@marsidev/react-turnstile'

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY ?? ''

export const isTurnstileEnabled = !!SITE_KEY

interface TurnstileWidgetProps {
  onVerify: (token: string) => void
  onExpire?: () => void
}

export function TurnstileWidget({ onVerify, onExpire }: TurnstileWidgetProps) {
  if (!SITE_KEY) {
    return null
  }

  return (
    <Turnstile
      siteKey={SITE_KEY}
      onSuccess={onVerify}
      onExpire={onExpire}
      options={{ size: 'invisible' }}
    />
  )
}
