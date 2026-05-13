import { createHmac, timingSafeEqual } from 'crypto'

const ALGORITHM = 'sha256'
const TOKEN_TTL_MS = 24 * 60 * 60 * 1000 // 24 hours

// ============================================================
// Internal helpers
// ============================================================

function toBase64url(buf: Buffer): string {
  return buf.toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '')
}

function fromBase64url(str: string): Buffer {
  const padding = (4 - (str.length % 4)) % 4
  const padded = str.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat(padding)
  return Buffer.from(padded, 'base64')
}

type TokenPayload = {
  order_id: string
  action: string
  expires_at: number
}

// ============================================================
// Public API
// ============================================================

export type TeamAction = 'confirmed' | 'cancelled' | 'unreachable'

export type VerifyResult =
  | { valid: true; orderId: string; action: TeamAction }
  | { valid: false; reason: string }

/**
 * Generates a signed, URL-safe token encoding order_id, action, and a 24-hour expiry.
 * Throws if TEAM_ACTION_SECRET is not set.
 */
export function generateTeamActionToken(orderId: string, action: TeamAction): string {
  const secret = process.env.TEAM_ACTION_SECRET
  if (!secret) throw new Error('TEAM_ACTION_SECRET is not set')

  const payload: TokenPayload = {
    order_id: orderId,
    action,
    expires_at: Date.now() + TOKEN_TTL_MS,
  }

  const payloadStr = toBase64url(Buffer.from(JSON.stringify(payload)))
  const sig = toBase64url(createHmac(ALGORITHM, secret).update(payloadStr).digest())

  return `${payloadStr}.${sig}`
}

/**
 * Verifies a token. Returns { valid: false } for any failure — never throws.
 */
export function verifyTeamActionToken(token: string): VerifyResult {
  const secret = process.env.TEAM_ACTION_SECRET
  if (!secret) return { valid: false, reason: 'Server misconfiguration' }

  const dotIndex = token.lastIndexOf('.')
  if (dotIndex === -1) return { valid: false, reason: 'Malformed token' }

  const payloadStr = token.slice(0, dotIndex)
  const providedSig = token.slice(dotIndex + 1)

  const expectedSig = toBase64url(
    createHmac(ALGORITHM, secret).update(payloadStr).digest()
  )

  // Timing-safe comparison to prevent signature oracle attacks
  const expectedBuf = Buffer.from(expectedSig)
  const providedBuf = Buffer.from(providedSig)
  if (
    expectedBuf.length !== providedBuf.length ||
    !timingSafeEqual(expectedBuf, providedBuf)
  ) {
    return { valid: false, reason: 'Invalid signature' }
  }

  let payload: TokenPayload
  try {
    payload = JSON.parse(fromBase64url(payloadStr).toString())
  } catch {
    return { valid: false, reason: 'Malformed payload' }
  }

  if (Date.now() > payload.expires_at) {
    return { valid: false, reason: 'Token expired' }
  }

  const validActions: TeamAction[] = ['confirmed', 'cancelled', 'unreachable']
  if (!validActions.includes(payload.action as TeamAction)) {
    return { valid: false, reason: 'Unknown action' }
  }

  return { valid: true, orderId: payload.order_id, action: payload.action as TeamAction }
}
