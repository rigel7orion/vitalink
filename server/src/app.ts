import express, { type NextFunction, type Request, type RequestHandler, type Response } from 'express'
import { ZodError } from 'zod'
import { authenticate } from './auth.js'
import { loadConfig, type Config } from './config.js'
import { openDb, type DB } from './db.js'
import { HttpError } from './errors.js'
import { EventBus } from './services/events.js'
import { smtpMailer, type Mailer } from './services/delivery.js'
import { authRoutes } from './routes/auth.js'
import { doctorRoutes } from './routes/doctors.js'
import { appointmentRoutes } from './routes/appointments.js'
import { intentRoutes } from './routes/intent.js'
import { invoiceRoutes } from './routes/invoices.js'
import { dashboardRoutes } from './routes/dashboard.js'
import { clinicalRoutes } from './routes/clinical.js'
import { vitalsRoutes } from './routes/vitals.js'

export interface Ctx {
  db: DB
  cfg: Config
  bus: EventBus
  /** Mail transport for invoice emails; null = emails are only logged. */
  mailer: Mailer | null
  /** Injectable clock so tests can control "now". */
  now: () => number
  authLimiter: RequestHandler
}

function limiter(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, { n: number; reset: number }>()
  return (req, res, next) => {
    const t = Date.now()
    const k = req.ip ?? 'unknown'
    const h = hits.get(k)
    if (!h || h.reset < t) {
      hits.set(k, { n: 1, reset: t + windowMs })
      return next()
    }
    if (++h.n > max) {
      res.setHeader('retry-after', Math.ceil((h.reset - t) / 1000))
      return res.status(429).json({ error: 'Too many attempts. Try again shortly.', code: 'rate_limited' })
    }
    next()
  }
}

export interface AppOptions {
  config?: Partial<Config>
  now?: () => number
  authRateLimit?: number
  /** Inject a mail transport (tests); omit to use SMTP_URL when configured. */
  mailer?: Mailer | null
}

export function createApp(opts: AppOptions = {}) {
  const cfg = loadConfig(opts.config)
  const db = openDb(cfg)
  const ctx: Ctx = {
    db,
    cfg,
    bus: new EventBus(),
    mailer: opts.mailer !== undefined ? opts.mailer : cfg.smtpUrl ? smtpMailer(cfg.smtpUrl) : null,
    now: opts.now ?? Date.now,
    authLimiter: limiter(opts.authRateLimit ?? 30, 60_000),
  }

  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', cfg.production ? 1 : false)
  app.use(express.json({ limit: '100kb' }))

  app.use('/api', (req: Request, res: Response, next: NextFunction) => {
    res.setHeader('x-content-type-options', 'nosniff')
    res.setHeader('referrer-policy', 'no-referrer')
    res.setHeader('cache-control', 'no-store')
    res.setHeader('access-control-allow-origin', cfg.corsOrigin)
    res.setHeader('vary', 'Origin')
    res.setHeader('access-control-allow-headers', 'content-type, authorization, x-device-key')
    res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') return res.status(204).end()
    next()
  })
  app.use('/api', authenticate(cfg.jwtSecret))

  app.get('/api/health', (_req, res) => {
    const doctors = (db.prepare('SELECT COUNT(*) AS n FROM doctors').get() as { n: number }).n
    res.json({ ok: true, time: new Date(ctx.now()).toISOString(), doctors })
  })
  app.use('/api', authRoutes(ctx), doctorRoutes(ctx), appointmentRoutes(ctx), invoiceRoutes(ctx), dashboardRoutes(ctx), intentRoutes(ctx), clinicalRoutes(ctx), vitalsRoutes(ctx))

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found', code: 'not_found' }))

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return
    if (err instanceof ZodError) {
      return res.status(400).json({
        error: 'Invalid request',
        code: 'validation',
        details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      })
    }
    if (err instanceof HttpError) return res.status(err.status).json({ error: err.message, code: err.code })
    // body-parser errors (malformed JSON, payload too large, ...) carry their own 4xx status
    const status = (err as { status?: number })?.status
    if (typeof status === 'number' && status >= 400 && status < 500) {
      if (status === 413) return res.status(413).json({ error: 'Request body too large', code: 'too_large' })
      return res.status(status).json({ error: err instanceof SyntaxError ? 'Malformed JSON' : 'Bad request', code: 'bad_request' })
    }
    console.error(err)
    res.status(500).json({ error: 'Internal server error', code: 'internal' })
  })

  return { app, db, cfg, ctx, close: () => db.close() }
}
