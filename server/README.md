# VITALINK API

Node + TypeScript + Express 5 + SQLite (built-in `node:sqlite`, no native build). Needs **Node 22.13+**.

```bash
npm run dev:all          # from the project root: website on :5173 and API on :8787
npm --prefix server test # 46 integration tests (in-memory DB, controlled clock)
```

Dev seed (empty DB only): patient `demo@vitalink.test` / `demo1234`; doctors `doctor1@vitalink.test` … `doctor8@vitalink.test` / `doctor123`.
Doctors: 1 Dermatology, 2 General Medicine, 3 Pediatrics, 4 Cardiology, 5 Geriatrics, 6 Orthopedics, 7 ENT, 8 Dermatology.

## What each deck feature maps to

| Deck | Endpoints |
|---|---|
| Instant e-appointments | `GET /doctors`, `GET /doctors/:id/slots?date=`, `POST /appointments` |
| One-tap cancellation | `DELETE /appointments/:id` |
| The invisible wait | `GET /doctors/:id/queue` |
| CITYCARE AI intent booking | `POST /intent/parse` (never books; patient confirms with `POST /appointments`) |
| AI symptom pre-check | `POST /triage` |
| E-prescriptions | `POST /prescriptions` (doctor), `GET /prescriptions` |
| Unified patient history | `GET /patients/:id/history` (`me` for yourself), `GET /patients` (doctor) |
| Medicine delivery | `POST /orders`, `GET /orders`, `PATCH /orders/:id/status`, `DELETE /orders/:id` |
| VitalBand | `POST /devices`, `POST /vitals` (header `x-device-key`), `GET /vitals` |
| Instant auto-alert | created by `POST /vitals`; `GET /alerts`, `PATCH /alerts/:id/ack`, live `GET /stream?token=` (SSE) |
| Family alert contacts | `GET/POST/DELETE /family` |
| Bills & invoices | `GET /invoices`, `GET /invoices/:id`, `GET /appointments/:id/invoice`, `POST /invoices/:id/pay`, `GET /invoices/:id/pdf` |

Auth: `POST /auth/register`, `POST /auth/login`, `GET/PATCH /me`; send `Authorization: Bearer <token>`.
All errors are JSON: `{ "error": "...", "code": "slot_taken" }` (validation errors add `details`).

## Billing (Amazon / Flipkart style)

Booking returns the appointment **plus its invoice** (`POST /appointments` -> `{ ...appointment, invoice }`).

- **Created atomically:** the invoice is inserted in the same transaction as the booking, so you never get a booking without a bill or the reverse. A failed booking (e.g. slot taken) burns no invoice number.
- **Numbering:** `VL/2627/000001`, gapless, restarting each Indian financial year (April to March). Credit notes use `CN/2627/000001`.
- **Money is integer paise** end to end. Totals = consultation fee + platform fee, with GST rounded half-up per line.
- **Pay:** `POST /invoices/:id/pay` with `{ "method": "upi" | "card" | "netbanking" | "pay_at_clinic" }`. Anything else in the body (like a card number) is rejected with 400. `pay_at_clinic` keeps the bill pending until the doctor completes the visit, then marks it paid in cash.
- **Cancel:** paid -> refunded in full with a credit note; unpaid -> void.
- **PDF:** `GET /invoices/:id/pdf` (needs the bearer token, so the site fetches it as a blob). Shows status, GST lines, amount in words, payment and credit-note details, with a real rupee sign.
- **Access:** the patient who owns it and the treating doctor. Everyone else gets 403. Only the patient can pay.

Configure in `.env`: `PLATFORM_FEE_PAISE` (default 2500 = Rs 25), `PLATFORM_GST_PCT` (18), `CONSULT_GST_PCT` (0), `SELLER_NAME`, `SELLER_ADDRESS`, `SELLER_GSTIN`.

## How the important parts work

- **No double booking:** a partial unique index on `(doctor_id, start_ts) WHERE status='booked'` makes the database refuse it, so it holds under concurrent requests (tested with 6 simultaneous bookings: exactly one wins). A patient also can't hold two bookings at the same time.
- **Slots** are generated from each doctor's shift in the clinic timezone (30 min, closed Sundays, past slots hidden).
- **Intent parsing** is rule-based (specialty words, today/tomorrow/weekday/"in N days", morning/afternoon/evening/"after 5 pm", nearby, "don't want to wait"). Options are real free slots, ranked by time, distance and queue length depending on what the patient asked for.
- **Triage** is rule-based with red-flag symptoms (chest pain, breathing trouble, stroke signs…) → `emergency`; combinations like fever + redness → `urgent`; infant/senior adjustments. It guides urgency and is **not a diagnosis**.
- **Anomaly detection** (`services/anomaly.ts`): heart-rate ranges per age group (infant/child/adult/senior), fever ≥ 38 °C (infant fever is always critical), hypothermia, falls, sudden heart-rate jumps. Identical alerts are de-duplicated for 5 minutes.
- **Alert dispatch:** picks the nearest on-duty doctor (geriatrics for seniors, pediatrics for infants/children, else general medicine), stores one notification per recipient (doctor + each family contact) and pushes the alert over SSE.
- **Security:** scrypt password hashing, HS256 tokens, device keys stored hashed and shown once, role checks on every route, doctors can see only patients they've treated, prescription-only drugs can't be ordered without a matching prescription, auth rate limiting, 100 kB body limit, parameterized SQL everywhere.

## What is *not* real yet

- **Payments are a demo gateway.** `services/payments.ts` approves every charge instantly and moves no real money. To take real payments, swap it for Razorpay/Stripe and confirm payment from the provider's signed webhook (see the comment in that file).
- **Tax rates and the platform fee are placeholders.** Defaults assume consultations are GST-exempt and the platform fee is taxed at 18%. Confirm real rates, SAC codes and invoice format with a chartered accountant before charging anyone.
- Invoices are not emailed yet; they are downloadable from the site.

- **No SMS/WhatsApp/push provider is built in.** Without `NOTIFY_WEBHOOK_URL`, notifications are recorded in the database and shown in the app only (`channel: "log"`). Set the webhook to forward them to a real provider.
- Intent parsing and triage are **rules, not a trained model**. The deck's Python ML layer can replace `services/intent.ts`, `services/triage.ts` and `services/anomaly.ts` behind the same function signatures.
- One process + one SQLite file: fine for a pilot or demo. SSE and rate limiting are in-memory, so run a single instance (or move those to Redis/Postgres to scale out).
- Medicine "delivery" tracks order status only. There is no pharmacy inventory or courier integration.

## Before going live

Set `JWT_SECRET`, `CORS_ORIGIN` and `NODE_ENV=production` (the server refuses to start in production without a secret), serve behind HTTPS, set `SEED=false`, back up `data/vitalink.db`, and get legal and clinical review: this handles health data and automated triage.
