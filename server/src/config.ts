import { randomBytes } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

export interface Config {
  port: number
  dbPath: string
  jwtSecret: string
  corsOrigin: string
  /** Clinic timezone as minutes east of UTC (India = 330). */
  clinicOffsetMin: number
  seed: boolean
  notifyWebhook?: string
  production: boolean
  billing: BillingConfig
  /** e.g. smtps://user:pass@smtp.gmail.com:465 (needs `npm i nodemailer`). Without it, emails are only logged. */
  smtpUrl?: string
  mailFrom: string
  /** Public https origin used in links inside emails / WhatsApp. Falls back to CORS_ORIGIN. */
  publicUrl?: string
  /** POST every paid invoice here (plug in WhatsApp / SMS / n8n / Zapier). */
  invoiceWebhook?: string
  /** How long a shared invoice link stays valid. */
  shareTtlHours: number
}

/** Everything on an invoice that is a business decision lives here, not in code. */
export interface BillingConfig {
  /** Convenience / platform fee added to every booking, in paise (2500 = Rs 25.00). */
  platformFeePaise: number
  /** GST % on the platform fee (taxable service). */
  platformGstPct: number
  /** GST % on the consultation fee. Clinical-establishment health services are normally exempt (0). */
  consultGstPct: number
  sellerName: string
  sellerAddress: string
  /** Printed on the invoice when set. */
  sellerGstin?: string
}

function persistedSecret(dir: string): string {
  const file = path.join(dir, '.jwt-secret')
  if (existsSync(file)) return readFileSync(file, 'utf8').trim()
  mkdirSync(dir, { recursive: true })
  const s = randomBytes(48).toString('hex')
  writeFileSync(file, s, { mode: 0o600 })
  return s
}

const numEnv = (k: string, d: number) => {
  const v = Number(process.env[k])
  return process.env[k] !== undefined && process.env[k] !== '' && Number.isFinite(v) && v >= 0 ? v : d
}
const intEnv = (k: string, d: number) => Math.round(numEnv(k, d))

export function loadConfig(overAll: Partial<Config> = {}): Config {
  const { billing: billingOver, ...over } = overAll
  const production = process.env.NODE_ENV === 'production'
  const dataDir = path.resolve(process.env.DATA_DIR ?? 'data')
  const dbPath = over.dbPath ?? process.env.DB_PATH ?? path.join(dataDir, 'vitalink.db')
  if (dbPath !== ':memory:') mkdirSync(path.dirname(dbPath), { recursive: true })
  if (production && !process.env.JWT_SECRET && !over.jwtSecret) {
    throw new Error('JWT_SECRET must be set in production')
  }
  return {
    port: Number(process.env.PORT ?? 8787),
    dbPath,
    jwtSecret: over.jwtSecret ?? process.env.JWT_SECRET ?? persistedSecret(dataDir),
    corsOrigin: process.env.CORS_ORIGIN ?? 'http://localhost:5173',
    clinicOffsetMin: Number(process.env.CLINIC_OFFSET_MIN ?? 330),
    seed: process.env.SEED ? process.env.SEED === 'true' : !production,
    notifyWebhook: process.env.NOTIFY_WEBHOOK_URL || undefined,
    production,
    smtpUrl: process.env.SMTP_URL || undefined,
    mailFrom: process.env.MAIL_FROM ?? 'VITALINK <no-reply@vitalink.local>',
    publicUrl: process.env.PUBLIC_URL?.replace(/\/+$/, '') || undefined,
    invoiceWebhook: process.env.INVOICE_WEBHOOK_URL || undefined,
    shareTtlHours: numEnv('SHARE_TTL_HOURS', 168),
    billing: {
      platformFeePaise: intEnv('PLATFORM_FEE_PAISE', 2500),
      platformGstPct: numEnv('PLATFORM_GST_PCT', 18),
      consultGstPct: numEnv('CONSULT_GST_PCT', 0),
      sellerName: process.env.SELLER_NAME ?? 'VITALINK Health Pvt. Ltd.',
      sellerAddress: process.env.SELLER_ADDRESS ?? 'Kolkata, West Bengal, India',
      sellerGstin: process.env.SELLER_GSTIN || undefined,
      ...billingOver,
    },
    ...over,
  }
}
