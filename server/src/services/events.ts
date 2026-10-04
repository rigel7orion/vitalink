// In-process pub/sub used for the live (Server-Sent Events) stream.
export interface LiveEvent {
  type: string
  data: unknown
}
type Listener = (e: LiveEvent) => void

export class EventBus {
  private subs = new Map<string, Set<Listener>>()
  subscribe(userId: string, fn: Listener) {
    if (!this.subs.has(userId)) this.subs.set(userId, new Set())
    this.subs.get(userId)!.add(fn)
    return () => this.subs.get(userId)?.delete(fn)
  }
  publish(userIds: string[], e: LiveEvent) {
    for (const id of new Set(userIds)) this.subs.get(id)?.forEach((fn) => fn(e))
  }
}
