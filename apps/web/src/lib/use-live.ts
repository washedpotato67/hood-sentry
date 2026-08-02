'use client';

import { useEffect, useRef, useState } from 'react';
import type { ApiResult } from './api';

export const LIVE_POLL_MS = 15_000;
const MAX_BACKOFF_MS = 60_000;

type LiveOptions<State, Wire> = {
  fetch: () => Promise<ApiResult<Wire>>;
  initial: State;
  merge?: (current: State, fresh: Wire) => State;
  intervalMs?: number;
  enabled?: boolean;
};

/**
 * A background poll that streams fresh server data into a client component
 * without a reload. The first fetch runs shortly after mount, then every
 * `intervalMs`; failures back off exponentially (to 60s) while the last good
 * data stays on screen, the poll pauses while the tab is hidden, and it fires
 * immediately the moment the tab is visible again.
 *
 * `merge` decides how fresh data lands: replace wholesale (ranked lists such as
 * search or holders) or merge in place (the board, so rows don't reshuffle).
 * Without a `merge`, fresh data replaces the current data. `State` is what the
 * component renders; `Wire` is what the endpoint returns — the token page, for
 * example, renders a result that may be an error, so its `State` is the
 * ApiResult itself.
 */
export function useLivePoll<State, Wire = State>(
  options: LiveOptions<State, Wire>,
): {
  data: State;
  updatedAt: string | null;
  error: string | null;
} {
  const { initial, enabled = true } = options;
  const [data, setData] = useState<State>(initial);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const failures = useRef(0);
  const latest = useRef(options);
  latest.current = options;

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      if (document.visibilityState !== 'visible') return;
      try {
        const result = await latest.current.fetch();
        if (!result.ok) throw new Error(result.code);
        if (cancelled) return;
        failures.current = 0;
        setError(null);
        setData((current) =>
          latest.current.merge === undefined
            ? (result.data as unknown as State)
            : latest.current.merge(current, result.data),
        );
        setUpdatedAt(new Date().toISOString());
      } catch (cause) {
        if (cancelled) return;
        failures.current += 1;
        setError(cause instanceof Error ? cause.message : 'SERVICE_UNREACHABLE');
      }
      const base = latest.current.intervalMs ?? LIVE_POLL_MS;
      const backoff = base * 2 ** Math.min(failures.current, 2);
      timer = setTimeout(tick, Math.min(backoff, MAX_BACKOFF_MS));
    }

    function onVisible() {
      if (document.visibilityState !== 'visible') return;
      if (timer !== undefined) clearTimeout(timer);
      void tick();
    }

    timer = setTimeout(tick, 500);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (timer !== undefined) clearTimeout(timer);
    };
  }, [enabled]);

  return { data, updatedAt, error };
}

/**
 * Merge for address-keyed ranked lists (the board's feeds): rows that still
 * appear keep their on-screen position (metrics refresh in place, so the list
 * does not reshuffle under the cursor), rows that ranked out are dropped, and
 * brand-new entries are prepended in their ranked feed order. An empty poll is
 * transient (restart, brief outage) and never wipes the list.
 */
export function mergeRanked<T>(
  current: readonly T[],
  fresh: readonly T[],
  keyOf: (item: T) => string,
  cap: number,
): readonly T[] {
  if (current.length === 0) return fresh.slice(0, cap);
  if (fresh.length === 0) return current.slice(0, cap);
  const currentKeys = new Set(current.map(keyOf));
  const freshByKey = new Map(fresh.map((item) => [keyOf(item), item]));
  const kept = current.flatMap((item) => {
    const replacement = freshByKey.get(keyOf(item));
    return replacement ? [replacement] : [];
  });
  const newcomers = fresh.filter((item) => !currentKeys.has(keyOf(item)));
  return [...newcomers, ...kept].slice(0, cap);
}
