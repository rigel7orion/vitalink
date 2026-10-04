import { useState } from 'react'
import { ApiError, downloadInvoicePdf, emailInvoiceToMe, inr, payInvoice, shareInvoice, type Invoice, type PayMethod } from '../lib/api'

const METHODS: [PayMethod, string][] = [
  ['upi', 'UPI'],
  ['card', 'Card'],
  ['netbanking', 'Net banking'],
  ['pay_at_clinic', 'Pay at clinic'],
]
const METHOD_LABEL: Record<string, string> = { upi: 'UPI', card: 'Card', netbanking: 'Net banking', pay_at_clinic: 'Pay at clinic' }
const STATUS_LABEL = { pending: 'Payment pending', paid: 'Paid', refunded: 'Refunded', void: 'Cancelled' } as const

/** Order-summary style bill shown right after booking (Amazon / Flipkart checkout pattern). */
export function Bill({ invoice, onChange }: { invoice: Invoice; onChange: (i: Invoice) => void }) {
  const [method, setMethod] = useState<PayMethod>('upi')
  const [busy, setBusy] = useState<'pay' | 'pdf' | 'wa' | 'mail' | null>(null)
  const [err, setErr] = useState('')
  const [note, setNote] = useState('')

  const guard = (kind: 'pay' | 'pdf' | 'wa' | 'mail', fn: () => Promise<void>) => async () => {
    setBusy(kind)
    setErr('')
    try {
      await fn()
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Something went wrong')
    } finally {
      setBusy(null)
    }
  }
  const pay = guard('pay', async () => onChange(await payInvoice(invoice.id, method)))
  const pdf = guard('pdf', () => downloadInvoicePdf(invoice))
  const whatsapp = guard('wa', async () => {
    // open the tab first (inside the click) so mobile browsers do not block it, then point it at the link
    const w = window.open('', '_blank')
    try {
      const { whatsappUrl } = await shareInvoice(invoice.id)
      if (w) w.location.href = whatsappUrl
      else window.location.href = whatsappUrl
    } catch (e) {
      w?.close()
      throw e
    }
  })
  const mail = guard('mail', async () => {
    const r = await emailInvoiceToMe(invoice.id)
    setNote(r.status === 'sent' ? `Invoice emailed to ${r.to}.` : r.status === 'logged' ? 'Email is not set up on this server yet (demo): it was logged instead.' : 'Could not send the email. Please try again.')
  })

  const atClinic = invoice.status === 'pending' && invoice.payment?.method === 'pay_at_clinic'
  const payable = invoice.status === 'pending' && !atClinic

  return (
    <section className="bill" aria-label="Your bill">
      <header className="bill-head">
        <span className="label dark">YOUR BILL · {invoice.invoiceNo}</span>
        <span className={`pill ${invoice.status}`}>{STATUS_LABEL[invoice.status]}</span>
      </header>

      <ul className="bill-lines">
        {invoice.lines.map((l) => (
          <li key={l.description}>
            <span>
              {l.description}
              {l.taxPaise > 0 && <small>+ {inr(l.taxPaise)} GST ({l.taxPct}%)</small>}
            </span>
            <b>{inr(l.amountPaise + l.taxPaise)}</b>
          </li>
        ))}
      </ul>
      <dl className="bill-total">
        <div>
          <dt>Subtotal</dt>
          <dd>{inr(invoice.subtotalPaise)}</dd>
        </div>
        <div>
          <dt>GST</dt>
          <dd>{inr(invoice.taxPaise)}</dd>
        </div>
        <div className="grand">
          <dt>Total</dt>
          <dd>{inr(invoice.totalPaise)}</dd>
        </div>
      </dl>

      {payable && (
        <fieldset className="methods" disabled={busy !== null}>
          <legend className="label dark">PAY WITH</legend>
          {METHODS.map(([m, label]) => (
            <label key={m} className={`method ${method === m ? 'sel' : ''}`}>
              <input type="radio" name="pay-method" checked={method === m} onChange={() => setMethod(m)} />
              {label}
            </label>
          ))}
        </fieldset>
      )}

      <div className="row tight">
        {payable && (
          <button className="btn btn-solid" disabled={busy !== null} onClick={pay}>
            {busy === 'pay' ? 'Processing…' : method === 'pay_at_clinic' ? 'Confirm: pay at clinic' : `Pay ${inr(invoice.totalPaise)}`}
          </button>
        )}
        <button className="btn btn-ghost" disabled={busy !== null} onClick={pdf}>
          {busy === 'pdf' ? 'Preparing…' : 'Download invoice (PDF)'}
        </button>
      </div>
      <div className="row tight">
        <button className="btn btn-ghost" disabled={busy !== null} onClick={whatsapp}>
          {busy === 'wa' ? 'Opening…' : 'Share on WhatsApp'}
        </button>
        <button className="btn btn-ghost" disabled={busy !== null} onClick={mail}>
          {busy === 'mail' ? 'Sending…' : 'Email me this'}
        </button>
      </div>

      <p className="muted small" aria-live="polite">
        {err ? (
          <span className="error">{err}</span>
        ) : note ? (
          note
        ) : invoice.status === 'paid' && invoice.payment ? (
          `Paid via ${METHOD_LABEL[invoice.payment.method]} · Ref ${invoice.payment.ref}`
        ) : atClinic ? (
          `Pay ${inr(invoice.totalPaise)} at the clinic during your visit.`
        ) : (
          'Demo checkout: payments are simulated and no real money moves.'
        )}
      </p>
    </section>
  )
}
