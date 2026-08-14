import { getIronSession, type IronSession } from 'iron-session'
import type { Request, Response } from 'express'

export const HUB_SESSION_COOKIE = '__hub_session'
export const HUB_SESSION_MAX_AGE_SECONDS = 7 * 24 * 60 * 60

/**
 * Single source of truth for the hub's iron-session cookie configuration.
 * Every reader/writer of the `__hub_session` cookie must use this helper —
 * cookie-option drift between routes previously caused subtle bugs (e.g. the
 * impersonation flow setting a different maxAge than the login flow).
 */
export function getHubSession<T extends object>(
  req: Request,
  res: Response,
  password: string,
  maxAgeSeconds: number = HUB_SESSION_MAX_AGE_SECONDS,
): Promise<IronSession<T>> {
  return getIronSession<T>(req, res, {
    password,
    cookieName: HUB_SESSION_COOKIE,
    cookieOptions: {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      path: '/',
      maxAge: maxAgeSeconds,
    },
  })
}
