import { useSyncExternalStore } from 'react'

// Tiny external store so the HTML section and the 3D watch share one "anomaly" flag.
type State = { anomaly: boolean }
let state: State = { anomaly: false }
const listeners = new Set<() => void>()

export const vitals = {
  get: () => state,
  set(next: Partial<State>) {
    state = { ...state, ...next }
    listeners.forEach((l) => l())
  },
  subscribe(l: () => void) {
    listeners.add(l)
    return () => listeners.delete(l)
  },
}

export const useVitals = () => useSyncExternalStore(vitals.subscribe, vitals.get)
