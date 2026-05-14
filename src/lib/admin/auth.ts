import { createHmac, timingSafeEqual } from 'crypto'

export const ADMIN_COOKIE_NAME = 'bakery_admin_session'

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

type CookiePayload = {
  authenticated: true
  expires_at: number
}

function toBase64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function fromBase64url(str: string): Buffer {
  const padding = (4 - (str.length % 4)) % 4
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding)
  return Buffer.from(padded, 'base64')
}

export function generateSessionCookie(): string {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not set')

  const payload: CookiePayload = {
    authenticated: true,
    expires_at: Date.now() + TOKEN_TTL_MS,
  }

  const payloadStr = toBase64url(Buffer.from(JSON.stringify(payload)))
  const sig = toBase64url(createHmac('sha256', secret).update(payloadStr).digest())
  return `${payloadStr}.${sig}`
}

export function verifySessionCookie(token: string): boolean {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) return false

  const dotIndex = token.lastIndexOf('.')
  if (dotIndex === -1) return false

  const payloadStr = token.slice(0, dotIndex)
  const providedSig = token.slice(dotIndex + 1)

  const expectedSig = toBase64url(
    createHmac('sha256', secret).update(payloadStr).digest()
  )

  const expectedBuf = Buffer.from(expectedSig)
  const providedBuf = Buffer.from(providedSig)
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return false
  }

  try {
    const payload = JSON.parse(fromBase64url(payloadStr).toString()) as CookiePayload
    return payload.authenticated === true && Date.now() < payload.expires_at
  } catch {
    return false
  }
}
