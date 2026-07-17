'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiDelete, apiRequest, chainId, compactAddress } from '../../lib/api';
import { useSession } from '../use-session';
import { WebhookDashboard } from './webhook-dashboard';

type RuleType =
  | 'price_change'
  | 'volume_spike'
  | 'large_transfer'
  | 'contract_event'
  | 'risk_score_change'
  | 'governance_proposal';
type AlertChannel = 'in_app' | 'email' | 'telegram' | 'webhook' | 'push';
type ChannelType = 'email' | 'telegram' | 'push';

type AlertRule = {
  id: string;
  targetAddress: string;
  ruleType: RuleType;
  condition: Record<string, unknown>;
  channels: readonly AlertChannel[];
  enabled: boolean;
};
type AlertPage = { data: readonly AlertRule[] };
type NotificationChannel = {
  id: string;
  channelType: ChannelType;
  verified: boolean;
  verifiedAt: string | null;
};
type ChannelCapabilities = {
  email: boolean;
  telegram: boolean;
  push: boolean;
  webPushPublicKey: string | null;
};

const alertChannels: readonly AlertChannel[] = ['in_app', 'email', 'telegram', 'push', 'webhook'];

function ruleType(value: string): RuleType {
  switch (value) {
    case 'volume_spike':
    case 'large_transfer':
    case 'contract_event':
    case 'risk_score_change':
    case 'governance_proposal':
      return value;
    default:
      return 'price_change';
  }
}

function channelType(value: string): ChannelType {
  if (value === 'telegram' || value === 'push') return value;
  return 'email';
}

function conditionFor(input: {
  type: RuleType;
  primaryValue: string;
  secondaryValue: string;
  windowSeconds: string;
  direction: string;
  eventTypes: string;
  severity: string;
}): Record<string, unknown> {
  const severity = input.severity;
  if (input.type === 'price_change') {
    return {
      changeBps: input.primaryValue,
      windowSeconds: input.windowSeconds,
      direction: ['up', 'down'].includes(input.direction) ? input.direction : 'either',
      severity,
    };
  }
  if (input.type === 'volume_spike') {
    return {
      minimumVolumeRaw: input.primaryValue,
      multiplierBps: input.secondaryValue,
      windowSeconds: input.windowSeconds,
      severity,
    };
  }
  if (input.type === 'large_transfer') {
    return { minimumAmountRaw: input.primaryValue, severity };
  }
  if (input.type === 'risk_score_change') {
    return {
      minimumDeltaBps: input.primaryValue,
      direction: ['decrease', 'either'].includes(input.direction) ? input.direction : 'increase',
      severity,
    };
  }
  return {
    eventTypes: input.eventTypes
      .split(',')
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    severity,
  };
}

function applicationServerKey(value: string): ArrayBuffer {
  const padding = '='.repeat((4 - (value.length % 4)) % 4);
  const base64 = `${value}${padding}`.replaceAll('-', '+').replaceAll('_', '/');
  const decoded = window.atob(base64);
  const buffer = new ArrayBuffer(decoded.length);
  const bytes = new Uint8Array(buffer);
  for (let index = 0; index < decoded.length; index += 1) {
    bytes[index] = decoded.charCodeAt(index);
  }
  return buffer;
}

export function AlertSettings() {
  const { session } = useSession();
  const [rules, setRules] = useState<readonly AlertRule[]>([]);
  const [targetAddress, setTargetAddress] = useState('');
  const [selectedRuleType, setSelectedRuleType] = useState<RuleType>('price_change');
  const [primaryValue, setPrimaryValue] = useState('1000');
  const [secondaryValue, setSecondaryValue] = useState('20000');
  const [windowSeconds, setWindowSeconds] = useState('3600');
  const [direction, setDirection] = useState('either');
  const [eventTypes, setEventTypes] = useState('ownershipTransferred,paused');
  const [severity, setSeverity] = useState('high');
  const [selectedChannels, setSelectedChannels] = useState<readonly AlertChannel[]>(['in_app']);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [channels, setChannels] = useState<readonly NotificationChannel[]>([]);
  const [capabilities, setCapabilities] = useState<ChannelCapabilities | null>(null);
  const [selectedChannelType, setSelectedChannelType] = useState<ChannelType>('email');
  const [destination, setDestination] = useState('');
  const [verificationChannelId, setVerificationChannelId] = useState('');
  const [verificationCode, setVerificationCode] = useState('');

  const load = useCallback(async () => {
    const [ruleResult, channelResult, capabilityResult] = await Promise.all([
      apiRequest<AlertPage>('/v1/alerts?limit=100'),
      apiRequest<readonly NotificationChannel[]>('/v1/notification-channels'),
      apiRequest<ChannelCapabilities>('/v1/notification-channels/capabilities'),
    ]);
    if (ruleResult.ok) setRules(ruleResult.data.data);
    else setError(ruleResult.message);
    if (channelResult.ok) setChannels(channelResult.data);
    if (capabilityResult.ok) setCapabilities(capabilityResult.data);
  }, []);

  useEffect(() => {
    if (session?.authenticated) void load();
  }, [session, load]);

  function toggleDelivery(value: AlertChannel) {
    setSelectedChannels((current) =>
      current.includes(value)
        ? current.filter((channel) => channel !== value)
        : [...current, value],
    );
  }

  async function createRule() {
    setBusy(true);
    setError(null);
    const result = await apiRequest('/v1/alerts', {
      method: 'POST',
      body: JSON.stringify({
        chainId: chainId(),
        targetAddress,
        ruleType: selectedRuleType,
        condition: conditionFor({
          type: selectedRuleType,
          primaryValue,
          secondaryValue,
          windowSeconds,
          direction,
          eventTypes,
          severity,
        }),
        channels: selectedChannels,
        enabled: true,
      }),
    });
    setBusy(false);
    if (result.ok) {
      setTargetAddress('');
      setMessage('Alert rule created.');
      await load();
    } else setError(result.message);
  }

  async function updateRule(id: string, enabled: boolean) {
    setBusy(true);
    const result = await apiRequest(`/v1/alerts/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled }),
    });
    setBusy(false);
    if (result.ok) await load();
    else setError(result.message);
  }

  async function validateRule(id: string) {
    setBusy(true);
    const result = await apiRequest<{ status: string }>(`/v1/alerts/${id}/test`, {
      method: 'POST',
      body: '{}',
    });
    setBusy(false);
    if (result.ok) setMessage('Rule configuration passed validation. No chain event was created.');
    else setError(result.message);
  }

  async function removeRule(id: string) {
    setBusy(true);
    const result = await apiDelete(`/v1/alerts/${id}`);
    setBusy(false);
    if (result.ok) await load();
    else setError(result.message);
  }

  async function pushSubscriptionBody(): Promise<{
    channelType: 'push';
    endpoint: string;
    publicKey: string;
    authenticationSecret: string;
  }> {
    if (capabilities?.push !== true || capabilities.webPushPublicKey === null) {
      throw new Error('Browser push delivery is unavailable.');
    }
    if (!('serviceWorker' in navigator) || !('PushManager' in window)) {
      throw new Error('This browser does not support push notifications.');
    }
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') throw new Error('Notification permission was not granted.');
    const registration = await navigator.serviceWorker.register('/sentry-push-worker.js');
    const existing = await registration.pushManager.getSubscription();
    const subscription =
      existing ??
      (await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: applicationServerKey(capabilities.webPushPublicKey),
      }));
    const json = subscription.toJSON();
    if (
      json.endpoint === undefined ||
      json.keys?.p256dh === undefined ||
      json.keys.auth === undefined
    ) {
      throw new Error('The browser returned an incomplete push subscription.');
    }
    return {
      channelType: 'push',
      endpoint: json.endpoint,
      publicKey: json.keys.p256dh,
      authenticationSecret: json.keys.auth,
    };
  }

  async function addChannel() {
    setBusy(true);
    setError(null);
    try {
      const body =
        selectedChannelType === 'email'
          ? { channelType: selectedChannelType, email: destination }
          : selectedChannelType === 'telegram'
            ? { channelType: selectedChannelType, chatId: destination }
            : await pushSubscriptionBody();
      const result = await apiRequest<{ id: string }>('/v1/notification-channels', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      if (result.ok) {
        setVerificationChannelId(result.data.id);
        setDestination('');
        setMessage('Verification code sent.');
        await load();
      } else setError(result.message);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Channel enrollment failed.');
    } finally {
      setBusy(false);
    }
  }

  async function verifyChannel() {
    setBusy(true);
    const result = await apiRequest(`/v1/notification-channels/${verificationChannelId}/verify`, {
      method: 'POST',
      body: JSON.stringify({ code: verificationCode }),
    });
    setBusy(false);
    if (result.ok) {
      setVerificationCode('');
      setVerificationChannelId('');
      setMessage('Notification channel verified.');
      await load();
    } else setError(result.message);
  }

  async function resendChannel(id: string) {
    setBusy(true);
    const result = await apiRequest(`/v1/notification-channels/${id}/resend`, {
      method: 'POST',
      body: '{}',
    });
    setBusy(false);
    if (result.ok) {
      setVerificationChannelId(id);
      setMessage('Verification code sent again.');
    } else setError(result.message);
  }

  async function removeChannel(id: string) {
    setBusy(true);
    const result = await apiDelete(`/v1/notification-channels/${id}`);
    setBusy(false);
    if (result.ok) await load();
    else setError(result.message);
  }

  if (session === null) return <p className="muted">Loading session…</p>;
  if (!session.authenticated)
    return <p className="unavailable">Connect your wallet to manage alerts.</p>;

  const usesEvents = ['contract_event', 'governance_proposal'].includes(selectedRuleType);
  const usesDirection = ['price_change', 'risk_score_change'].includes(selectedRuleType);
  const usesWindow = ['price_change', 'volume_spike'].includes(selectedRuleType);

  return (
    <div className="stack">
      <section className="panel">
        <h2>New evidence alert</h2>
        <div className="form-grid">
          <label className="field">
            Target address
            <input
              value={targetAddress}
              onChange={(event) => setTargetAddress(event.target.value)}
              placeholder="0x…"
            />
          </label>
          <label className="field">
            Rule type
            <select
              value={selectedRuleType}
              onChange={(event) => setSelectedRuleType(ruleType(event.target.value))}
            >
              <option value="price_change">Price change</option>
              <option value="volume_spike">Volume spike</option>
              <option value="large_transfer">Large transfer</option>
              <option value="contract_event">Contract event</option>
              <option value="risk_score_change">Risk score change</option>
              <option value="governance_proposal">Governance proposal</option>
            </select>
          </label>
          {usesEvents ? (
            <label className="field">
              Event types, comma separated
              <input value={eventTypes} onChange={(event) => setEventTypes(event.target.value)} />
            </label>
          ) : (
            <label className="field">
              {selectedRuleType === 'large_transfer'
                ? 'Minimum raw amount'
                : selectedRuleType === 'volume_spike'
                  ? 'Minimum raw volume'
                  : selectedRuleType === 'risk_score_change'
                    ? 'Minimum score delta, basis points'
                    : 'Change, basis points'}
              <input
                inputMode="numeric"
                value={primaryValue}
                onChange={(event) => setPrimaryValue(event.target.value)}
              />
            </label>
          )}
          {selectedRuleType === 'volume_spike' ? (
            <label className="field">
              Previous-window multiplier, basis points
              <input
                inputMode="numeric"
                value={secondaryValue}
                onChange={(event) => setSecondaryValue(event.target.value)}
              />
            </label>
          ) : null}
          {usesWindow ? (
            <label className="field">
              Window, seconds
              <input
                inputMode="numeric"
                value={windowSeconds}
                onChange={(event) => setWindowSeconds(event.target.value)}
              />
            </label>
          ) : null}
          {usesDirection ? (
            <label className="field">
              Direction
              <select value={direction} onChange={(event) => setDirection(event.target.value)}>
                {selectedRuleType === 'price_change' ? (
                  <>
                    <option value="either">Either</option>
                    <option value="up">Up</option>
                    <option value="down">Down</option>
                  </>
                ) : (
                  <>
                    <option value="increase">Increase</option>
                    <option value="decrease">Decrease</option>
                    <option value="either">Either</option>
                  </>
                )}
              </select>
            </label>
          ) : null}
          <label className="field">
            Severity
            <select value={severity} onChange={(event) => setSeverity(event.target.value)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
        </div>
        <fieldset className="channel-grid">
          <legend>Delivery paths</legend>
          {alertChannels.map((channel) => (
            <label key={channel}>
              <input
                type="checkbox"
                checked={selectedChannels.includes(channel)}
                onChange={() => toggleDelivery(channel)}
              />{' '}
              {channel.replace('_', ' ')}
            </label>
          ))}
        </fieldset>
        <div className="actions">
          <button
            className="primary"
            type="button"
            onClick={createRule}
            disabled={busy || selectedChannels.length === 0}
          >
            Create alert
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>Notification channels</h2>
        <div className="form-grid">
          <label className="field">
            Channel
            <select
              value={selectedChannelType}
              onChange={(event) => setSelectedChannelType(channelType(event.target.value))}
            >
              <option value="email" disabled={capabilities?.email === false}>
                Email
              </option>
              <option value="telegram" disabled={capabilities?.telegram === false}>
                Telegram
              </option>
              <option value="push" disabled={capabilities?.push === false}>
                Browser push
              </option>
            </select>
          </label>
          {selectedChannelType === 'push' ? null : (
            <label className="field">
              {selectedChannelType === 'email' ? 'Email address' : 'Telegram chat ID'}
              <input
                value={destination}
                onChange={(event) => setDestination(event.target.value)}
                placeholder={
                  selectedChannelType === 'email' ? 'you@example.com' : 'Send /id to the bot'
                }
              />
            </label>
          )}
        </div>
        <div className="actions">
          <button
            type="button"
            onClick={addChannel}
            disabled={busy || (selectedChannelType !== 'push' && destination.trim().length === 0)}
          >
            {selectedChannelType === 'push' ? 'Enable browser push' : 'Send verification code'}
          </button>
        </div>
        {verificationChannelId.length === 0 ? null : (
          <div className="form-grid">
            <label className="field">
              Six-digit code
              <input
                inputMode="numeric"
                maxLength={6}
                value={verificationCode}
                onChange={(event) => setVerificationCode(event.target.value)}
              />
            </label>
            <div className="actions">
              <button
                className="primary"
                type="button"
                onClick={verifyChannel}
                disabled={busy || verificationCode.length !== 6}
              >
                Verify channel
              </button>
            </div>
          </div>
        )}
        {channels.map((channel) => (
          <div className="metric-row" key={channel.id}>
            <span>{channel.channelType}</span>
            <span className="actions">
              <span className={`badge ${channel.verified ? 'status-ready' : ''}`}>
                {channel.verified ? 'Verified' : 'Pending'}
              </span>
              {channel.verified ? null : (
                <button type="button" onClick={() => resendChannel(channel.id)} disabled={busy}>
                  Resend
                </button>
              )}
              <button type="button" onClick={() => removeChannel(channel.id)} disabled={busy}>
                Remove
              </button>
            </span>
          </div>
        ))}
      </section>

      <section className="panel">
        <h2>Alert rules</h2>
        {rules.length === 0 ? <p className="muted">No alert rules.</p> : null}
        {rules.map((rule) => (
          <div className="metric-row" key={rule.id}>
            <span>
              <strong>{rule.ruleType.replaceAll('_', ' ')}</strong>
              <br />
              <code>{compactAddress(rule.targetAddress)}</code>
              <br />
              <small className="muted">{rule.channels.join(', ')}</small>
            </span>
            <span className="actions">
              <button type="button" onClick={() => validateRule(rule.id)} disabled={busy}>
                Validate
              </button>
              <button
                type="button"
                onClick={() => updateRule(rule.id, !rule.enabled)}
                disabled={busy}
              >
                {rule.enabled ? 'Pause' : 'Resume'}
              </button>
              <button type="button" onClick={() => removeRule(rule.id)} disabled={busy}>
                Delete
              </button>
            </span>
          </div>
        ))}
      </section>

      <WebhookDashboard />
      {message === null ? null : <section className="panel status-ready">{message}</section>}
      {error === null ? null : <section className="panel danger">{error}</section>}
    </div>
  );
}
