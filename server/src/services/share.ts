import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Signed, expiring links so an invoice PDF can be opened from an email or WhatsApp message
 * without the recipient being signed in. The signature binds the invoice id AND the expiry,
 * so changing either invalidates it. The key is derived from the JWT secret for this purpose only.
 */
const derive = (secret: string) => createHmac('sha256', secret).update('vitalink/invoice-share/v1').digest()

export const signShare = (secret: string, invoiceId: string, exp: number) =>
  createHmac('sha256', derive(secret)).update(`${invoiceId}.${exp}`).digest('base64url')

export type ShareCheck = 'ok' | 'bad' | 'expired'

export function checkShare(secret: string, invoiceId: string, exp: number, sig: string, nowMs: number): ShareCheck {
  if (!Number.isFinite(exp) || !sig) return 'bad'
  const want = Buffer.from(signShare(secret, invoiceId, exp))
  const got = Buffer.from(sig)
  if (want.length !== got.length || !timingSafeEqual(want, got)) return 'bad' // signature BEFORE expiry
  return exp < nowMs ? 'expired' : 'ok'
}

export function shareLink(base: string, secret: string, invoiceId: string, nowMs: number, ttlHours: number) {
  const exp = nowMs + ttlHours * 3_600_000
  const sig = signShare(secret, invoiceId, exp)
  return { url: `${base}/api/public/invoices/${invoiceId}/pdf?exp=${exp}&sig=${sig}`, expiresAt: new Date(exp).toISOString() }
}
