export type DeliveryChannel = 'in_app' | 'browser_push' | 'telegram' | 'email' | 'webhook';
export type DeliveryStatus =
  | 'queued'
  | 'processing'
  | 'delivered'
  | 'failed'
  | 'retrying'
  | 'permanently_failed'
  | 'corrected';
export type Delivery = {
  id: string;
  channel: DeliveryChannel;
  eventId: string;
  status: DeliveryStatus;
  attempts: number;
  secretSafe: boolean;
};
export class NotificationService {
  private deliveries = new Map<string, Delivery>();
  enqueue(channel: DeliveryChannel, eventId: string): Delivery {
    const key = `${channel}:${eventId}`;
    const existing = [...this.deliveries.values()].find(
      (d) => `${d.channel}:${d.eventId}` === key && d.status !== 'corrected',
    );
    if (existing) return existing;
    const d = {
      id: `delivery_${this.deliveries.size + 1}`,
      channel,
      eventId,
      status: 'queued' as const,
      attempts: 0,
      secretSafe: true,
    };
    this.deliveries.set(d.id, d);
    return d;
  }
  update(id: string, status: DeliveryStatus) {
    const d = this.deliveries.get(id);
    if (!d) throw new Error('Delivery not found');
    this.deliveries.set(id, { ...d, status, attempts: d.attempts + 1 });
    return this.deliveries.get(id)!;
  }
  correct(eventId: string) {
    for (const [id, d] of this.deliveries)
      if (d.eventId === eventId) this.deliveries.set(id, { ...d, status: 'corrected' });
  }
}
