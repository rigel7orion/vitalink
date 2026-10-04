import { randomBytes } from 'node:crypto'

/**
 * DEMO payment gateway. It approves every charge instantly and moves no real money.
 *
 * To go live, replace `charge` with a real provider (e.g. Razorpay or Stripe):
 *   1. create an order for `amountPaise` server-side,
 *   2. let the browser open the provider's checkout (the provider handles card/UPI details),
 *   3. confirm payment from the provider's signed WEBHOOK (never trust the browser),
 *   4. then call `markPaid` with the provider's payment id.
 * Card numbers must never touch this server, so the pay endpoint rejects any extra fields.
 */
export const PAYMENTS_MODE = 'demo' as const

export function charge(_input: { amountPaise: number; method: 'upi' | 'card' | 'netbanking'; invoiceNo: string }): { ref: string } {
  return { ref: `PAY-${randomBytes(5).toString('hex').toUpperCase()}` }
}

export const cashRef = () => `CASH-${randomBytes(4).toString('hex').toUpperCase()}`
