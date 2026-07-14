export type WatchlistKind = 'token' | 'wallet' | 'project' | 'pool' | 'deployer' | 'mixed';
export type Watchlist = {
  id: string;
  ownerId: string;
  name: string;
  kind: WatchlistKind;
  items: readonly `0x${string}`[];
  notes: string;
  labels: readonly string[];
  isDefault: boolean;
};
export class WatchlistService {
  private lists = new Map<string, Watchlist>();
  constructor(private readonly limits: Readonly<Record<string, number>> = { free: 50 }) {}
  create(ownerId: string, kind: WatchlistKind, name: string, tier = 'free'): Watchlist {
    void tier;
    if (!name.trim()) throw new Error('Name required');
    const l = {
      id: `wl_${this.lists.size + 1}`,
      ownerId,
      name: name.trim(),
      kind,
      items: [],
      notes: '',
      labels: [],
      isDefault: this.lists.size === 0,
    };
    this.lists.set(l.id, l);
    return l;
  }
  add(id: string, ownerId: string, address: `0x${string}`, tier = 'free'): Watchlist {
    const l = this.require(id, ownerId);
    if (!/^0x[0-9a-fA-F]{40}$/.test(address)) throw new Error('Invalid address');
    if (l.items.includes(address.toLowerCase() as `0x${string}`)) return l;
    const limit = this.limits[tier] ?? this.limits.free ?? 50;
    if (l.items.length >= limit) throw new Error('Watchlist tier limit reached');
    const next = { ...l, items: [...l.items, address.toLowerCase() as `0x${string}`] };
    this.lists.set(id, next);
    return next;
  }
  remove(id: string, ownerId: string, address: `0x${string}`) {
    const l = this.require(id, ownerId);
    const next = { ...l, items: l.items.filter((a) => a !== address.toLowerCase()) };
    this.lists.set(id, next);
    return next;
  }
  delete(id: string, ownerId: string) {
    this.require(id, ownerId);
    this.lists.delete(id);
  }
  private require(id: string, ownerId: string) {
    const l = this.lists.get(id);
    if (!l || l.ownerId !== ownerId) throw new Error('Unauthorized watchlist access');
    return l;
  }
}
