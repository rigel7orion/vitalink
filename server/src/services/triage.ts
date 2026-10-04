import { detectSpecialty } from './intent.js'

export type Urgency = 'emergency' | 'urgent' | 'routine'
type AgeGroup = 'infant' | 'child' | 'adult' | 'senior'

interface Rule {
  label: string
  level: Urgency
  re: RegExp
}

// Heuristic, rule-based pre-visit screening. It guides urgency; it does not diagnose.
const RULES: Rule[] = [
  { label: 'chest pain or pressure', level: 'emergency', re: /\bchest (pain|pressure|tightness)\b|\bcrushing pain\b/i },
  { label: 'difficulty breathing', level: 'emergency', re: /\b(can'?t|cannot|trouble|difficulty|struggling to) breath\w*|\bshort(ness)? of breath\b|\bgasping\b/i },
  { label: 'fainting or unresponsive', level: 'emergency', re: /\b(faint(ed|ing)?|passed out|unconscious|unresponsive|collapsed)\b/i },
  { label: 'seizure', level: 'emergency', re: /\b(seizure|convulsion|fits)\b/i },
  { label: 'stroke signs', level: 'emergency', re: /\bface droop\w*|\bslurred speech\b|\bsudden (weakness|numbness)\b/i },
  { label: 'severe bleeding', level: 'emergency', re: /\b(severe|heavy|uncontrolled|won'?t stop) bleeding\b|\bbleeding (heavily|a lot)\b/i },
  { label: 'severe allergic reaction', level: 'emergency', re: /\b(swelling of (the )?(face|lips|tongue|throat)|throat (is )?(closing|swelling)|anaphyla\w*)\b/i },
  { label: 'thoughts of self-harm', level: 'emergency', re: /\b(suicid\w*|kill myself|end my life|self[- ]harm)\b/i },

  { label: 'high fever', level: 'urgent', re: /\b(high|very high|burning) fever\b|\bfever (of |above |over )?(39|40|10[2-5])\b/i },
  { label: 'persistent vomiting', level: 'urgent', re: /\b(persistent|continuous|non[- ]stop|repeated) vomiting\b|\bcan'?t keep (food|water|anything) down\b/i },
  { label: 'severe pain', level: 'urgent', re: /\b(severe|unbearable|worst) (pain|headache)\b/i },
  { label: 'blood in stool or urine', level: 'urgent', re: /\bblood in (my |the )?(stool|urine|vomit)\b/i },
  { label: 'signs of dehydration', level: 'urgent', re: /\bdehydrat\w*|\bno urine\b/i },
  { label: 'possible fracture', level: 'urgent', re: /\b(broken|fractured?) (bone|arm|leg|wrist|ankle)\b|\bcan'?t (put weight|walk|move)\b/i },
  { label: 'fall with injury', level: 'urgent', re: /\bfell\b[^.]*\b(hurt|injur\w*|pain|hit (my )?head)\b|\bhit (my )?head\b/i },

  { label: 'fever', level: 'routine', re: /\bfever|temperature\b/i },
  { label: 'redness', level: 'routine', re: /\bredness|red patch(es)?\b/i },
  { label: 'itching', level: 'routine', re: /\bitch\w*/i },
  { label: 'cough or cold', level: 'routine', re: /\b(cough|cold|sore throat|runny nose)\b/i },
  { label: 'headache', level: 'routine', re: /\bheadache\b/i },
  { label: 'stomach upset', level: 'routine', re: /\b(stomach|nausea|diarrh\w*|vomit\w*)\b/i },
  { label: 'rash', level: 'routine', re: /\brash\b/i },
]

const ORDER: Record<Urgency, number> = { routine: 0, urgent: 1, emergency: 2 }

const ADVICE: Record<Urgency, { advice: string; bookWithin: string }> = {
  emergency: {
    advice: 'These symptoms can be serious. Do not wait for an appointment: call your local emergency number or go to the nearest emergency department now.',
    bookWithin: 'now: emergency care',
  },
  urgent: {
    advice: 'Please see a doctor today or within 24 hours. If symptoms get worse, go to emergency care.',
    bookWithin: '24 hours',
  },
  routine: {
    advice: 'A routine appointment is appropriate. Book a slot, and seek urgent care if symptoms worsen.',
    bookWithin: 'a few days',
  },
}

export function triage(input: { text?: string; symptoms?: string[]; ageGroup?: AgeGroup }) {
  const text = [input.text ?? '', ...(input.symptoms ?? [])].join('. ')
  const matched = RULES.filter((r) => r.re.test(text)).map((r) => ({ symptom: r.label, level: r.level }))
  const has = (label: string) => matched.some((m) => m.symptom === label)
  let level: Urgency = matched.reduce<Urgency>((a, m) => (ORDER[m.level] > ORDER[a] ? m.level : a), 'routine')
  const reasons: string[] = []

  // combinations the single rules would miss
  if (has('fever') && (has('redness') || /\b(swelling|pus|spreading)\b/i.test(text)) && ORDER[level] < ORDER.urgent) {
    level = 'urgent'
    reasons.push('Fever together with redness or swelling can mean an infection, so it should be checked within 24 hours.')
  }
  if ((input.ageGroup === 'infant') && has('fever') && ORDER[level] < ORDER.urgent) {
    level = 'urgent'
    reasons.push('Fever in an infant needs prompt medical review.')
  }
  if (input.ageGroup === 'senior' && (has('fall with injury') || has('difficulty breathing')) && ORDER[level] < ORDER.emergency) {
    level = 'emergency'
    reasons.push('This symptom carries higher risk in older adults.')
  }

  return {
    urgency: level,
    matched,
    reasons,
    suggestedSpecialty: level === 'emergency' ? null : detectSpecialty(text) ?? 'General Medicine',
    ...ADVICE[level],
    disclaimer:
      'Automated pre-visit screening based on simple rules. It is not a diagnosis and does not replace a doctor.',
  }
}
