export type AlertKind =
  | 'price_threshold'
  | 'percentage_change'
  | 'volume_spike'
  | 'liquidity_change'
  | 'risk_score_change'
  | 'new_risk_finding'
  | 'proxy_upgrade'
  | 'oracle_pause'
  | 'launchpad_graduation'
  | 'launchpad_migration'
  | 'whale_transfer';
export type AlertRule = {
  id: string;
  ownerId: string;
  kind: AlertKind;
  target: `0x${string}`;
  thresholdRaw?: bigint;
  enabled: boolean;
  cooldownSeconds: number;
  quietHours?: { start: number; end: number };
  finality: 'pending' | 'confirmed';
};
export type AlertEvent = {
  id: string;
  ruleId: string;
  eventKey: string;
  occurredAt: number;
  canonical: boolean;
};
export class AlertService {
  private rules = new Map<string, AlertRule>();
  private events = new Map<string, AlertEvent>();
  create(rule: AlertRule) {
    if (rule.cooldownSeconds < 0 || rule.cooldownSeconds > 86400)
      throw new Error('Invalid cooldown');
    if (rule.thresholdRaw !== undefined && rule.thresholdRaw < 0n)
      throw new Error('Invalid threshold');
    this.rules.set(rule.id, rule);
    return rule;
  }
  evaluate(ruleId: string, eventKey: string, now: number, canonical = true) {
    const r = this.rules.get(ruleId);
    if (!r || !r.enabled) return null;
    const previous = [...this.events.values()].find(
      (e) => e.ruleId === ruleId && e.canonical && now - e.occurredAt < r.cooldownSeconds,
    );
    if (previous) return null;
    const e = { id: `alert_${this.events.size + 1}`, ruleId, eventKey, occurredAt: now, canonical };
    this.events.set(e.id, e);
    return e;
  }
  correctReorg(eventId: string) {
    const e = this.events.get(eventId);
    if (e) this.events.set(eventId, { ...e, canonical: false });
  }
}
