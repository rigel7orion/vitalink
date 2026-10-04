import { DatabaseSync } from 'node:sqlite'
import { randomUUID } from 'node:crypto'
import type { Config } from './config.js'
import { hashPassword } from './auth.js'

export type DB = DatabaseSync

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  pass_hash TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('patient','doctor')),
  age_group TEXT NOT NULL DEFAULT 'adult' CHECK (age_group IN ('infant','child','adult','senior')),
  lat REAL, lng REAL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS doctors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id),
  specialty TEXT NOT NULL,
  code TEXT NOT NULL,
  city TEXT NOT NULL,
  lat REAL NOT NULL, lng REAL NOT NULL,
  room TEXT NOT NULL,
  fee INTEGER NOT NULL,
  shift_start INTEGER NOT NULL,
  shift_end INTEGER NOT NULL,
  avg_consult_min REAL NOT NULL DEFAULT 7,
  on_duty INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS appointments (
  id TEXT PRIMARY KEY,
  booking_id TEXT NOT NULL UNIQUE,
  patient_id TEXT NOT NULL REFERENCES users(id),
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  start_ts INTEGER NOT NULL,
  end_ts INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('booked','cancelled','completed')),
  token TEXT NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  cancelled_at INTEGER
);
-- the database itself refuses double-booking, even under concurrent requests
CREATE UNIQUE INDEX IF NOT EXISTS uq_doctor_slot ON appointments(doctor_id, start_ts) WHERE status = 'booked';
CREATE UNIQUE INDEX IF NOT EXISTS uq_patient_slot ON appointments(patient_id, start_ts) WHERE status = 'booked';
CREATE INDEX IF NOT EXISTS ix_appt_doctor_day ON appointments(doctor_id, start_ts);

CREATE TABLE IF NOT EXISTS prescriptions (
  id TEXT PRIMARY KEY,
  appointment_id TEXT NOT NULL REFERENCES appointments(id),
  patient_id TEXT NOT NULL REFERENCES users(id),
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  items TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  prescription_id TEXT REFERENCES prescriptions(id),
  items TEXT NOT NULL,
  address TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('placed','packed','out_for_delivery','delivered','cancelled')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS family_contacts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  relation TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS devices (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  label TEXT NOT NULL,
  key_hash TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen INTEGER
);
CREATE TABLE IF NOT EXISTS vitals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  patient_id TEXT NOT NULL REFERENCES users(id),
  device_id TEXT NOT NULL REFERENCES devices(id),
  ts INTEGER NOT NULL,
  hr REAL NOT NULL,
  temp_c REAL NOT NULL,
  fall INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS ix_vitals_patient_ts ON vitals(patient_id, ts);
CREATE TABLE IF NOT EXISTS alerts (
  id TEXT PRIMARY KEY,
  patient_id TEXT NOT NULL REFERENCES users(id),
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('warning','critical')),
  message TEXT NOT NULL,
  reading TEXT NOT NULL,
  doctor_id TEXT REFERENCES doctors(id),
  status TEXT NOT NULL CHECK (status IN ('open','acknowledged')) DEFAULT 'open',
  created_at INTEGER NOT NULL,
  acked_at INTEGER
);
-- gapless, per-financial-year invoice / credit-note numbering (incremented inside the booking transaction)
CREATE TABLE IF NOT EXISTS counters (
  key TEXT PRIMARY KEY,
  n INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS invoices (
  id TEXT PRIMARY KEY,
  invoice_no TEXT NOT NULL UNIQUE,
  appointment_id TEXT NOT NULL UNIQUE REFERENCES appointments(id),
  patient_id TEXT NOT NULL REFERENCES users(id),
  doctor_id TEXT NOT NULL REFERENCES doctors(id),
  status TEXT NOT NULL CHECK (status IN ('pending','paid','refunded','void')),
  lines TEXT NOT NULL,
  subtotal_paise INTEGER NOT NULL,
  tax_paise INTEGER NOT NULL,
  total_paise INTEGER NOT NULL,
  patient_name TEXT NOT NULL,
  patient_email TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  payment_method TEXT,
  payment_ref TEXT,
  paid_at INTEGER,
  refund_paise INTEGER NOT NULL DEFAULT 0,
  credit_note_no TEXT,
  refunded_at INTEGER
);
CREATE INDEX IF NOT EXISTS ix_invoice_patient ON invoices(patient_id, issued_at);
CREATE INDEX IF NOT EXISTS ix_invoice_doctor ON invoices(doctor_id, issued_at);

-- every attempt to send an invoice somewhere, so the app can show honest status
CREATE TABLE IF NOT EXISTS invoice_deliveries (
  id TEXT PRIMARY KEY,
  invoice_id TEXT NOT NULL REFERENCES invoices(id),
  channel TEXT NOT NULL CHECK (channel IN ('email','webhook')),
  recipient TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent','logged','failed')),
  error TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_delivery_invoice ON invoice_deliveries(invoice_id, channel, created_at);

CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  alert_id TEXT NOT NULL REFERENCES alerts(id),
  recipient_type TEXT NOT NULL CHECK (recipient_type IN ('doctor','family')),
  recipient_name TEXT NOT NULL,
  recipient_ref TEXT NOT NULL,
  channel TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
`

export function openDb(cfg: Config): DB {
  const db = new DatabaseSync(cfg.dbPath)
  db.exec(SCHEMA)
  if (cfg.seed) seed(db)
  return db
}

/** Run `fn` inside an immediate transaction; rolls back on throw. */
export function tx<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const out = fn()
    db.exec('COMMIT')
    return out
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}

export const isUniqueViolation = (e: unknown) =>
  e instanceof Error && /UNIQUE constraint failed/i.test(e.message)

// ---- seed (development only: empty database gets demo doctors + a demo patient) ----
const DOCTORS = [
  ['Dr. Ananya Sen', 'Dermatology', 'D', 'Kolkata', 22.5726, 88.3639, 'Room 214', 700, 11, 20, 8],
  ['Dr. Rohit Mukherjee', 'General Medicine', 'G', 'Kolkata', 22.5448, 88.3426, 'Room 101', 500, 9, 17, 7],
  ['Dr. Priya Banerjee', 'Pediatrics', 'P', 'Kolkata', 22.5958, 88.2636, 'Room 305', 600, 9, 18, 9],
  ['Dr. Sameer Khan', 'Cardiology', 'C', 'Kolkata', 22.5867, 88.4171, 'Room 410', 1200, 10, 19, 12],
  ['Dr. Meera Iyer', 'Geriatrics', 'R', 'Kolkata', 22.5018, 88.3213, 'Room 118', 800, 9, 17, 12],
  ['Dr. Arjun Das', 'Orthopedics', 'O', 'Kolkata', 22.6203, 88.4021, 'Room 222', 900, 12, 20, 10],
  ['Dr. Kavya Nair', 'ENT', 'E', 'Kolkata', 22.5355, 88.3501, 'Room 130', 650, 10, 18, 8],
  ['Dr. Imran Ali', 'Dermatology', 'D', 'Kolkata', 22.4967, 88.3714, 'Room 215', 650, 9, 17, 7],
] as const

export const DEMO = {
  patient: { email: 'demo@vitalink.test', password: 'demo1234' },
  doctorPassword: 'doctor123',
}

function seed(db: DB) {
  const n = db.prepare('SELECT COUNT(*) AS n FROM doctors').get() as { n: number }
  if (n.n > 0) return
  const now = Date.now()
  const insU = db.prepare(
    'INSERT INTO users (id,name,email,pass_hash,role,age_group,lat,lng,created_at) VALUES (?,?,?,?,?,?,?,?,?)',
  )
  const insD = db.prepare(
    'INSERT INTO doctors (id,user_id,specialty,code,city,lat,lng,room,fee,shift_start,shift_end,avg_consult_min) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
  )
  tx(db, () => {
    DOCTORS.forEach(([name, spec, code, city, lat, lng, room, fee, s, e, avg], i) => {
      const uid = randomUUID()
      const email = `doctor${i + 1}@vitalink.test`
      insU.run(uid, name, email, hashPassword(DEMO.doctorPassword), 'doctor', 'adult', lat, lng, now)
      insD.run(`doc_${i + 1}`, uid, spec, code, city, lat, lng, room, fee, s, e, avg)
    })
    insU.run(
      randomUUID(), 'Demo Patient', DEMO.patient.email, hashPassword(DEMO.patient.password),
      'patient', 'adult', 22.5726, 88.3639, now,
    )
  })
}
