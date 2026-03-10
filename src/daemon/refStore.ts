import type { RefDescriptor } from "../lib/types";

export class RefStore {
  private readonly store = new Map<string, Map<string, RefDescriptor>>();

  set(sessionId: string, refs: RefDescriptor[]): void {
    const map = new Map<string, RefDescriptor>();
    for (const descriptor of refs) {
      map.set(descriptor.ref, descriptor);
    }

    this.store.set(sessionId, map);
  }

  get(sessionId: string, ref: string): RefDescriptor | undefined {
    return this.store.get(sessionId)?.get(ref);
  }

  list(sessionId: string): RefDescriptor[] {
    return Array.from(this.store.get(sessionId)?.values() ?? []);
  }

  clear(sessionId: string): void {
    this.store.delete(sessionId);
  }

  has(sessionId: string): boolean {
    return this.store.has(sessionId);
  }
}
