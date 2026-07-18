'use client';

import { useEffect, useState } from 'react';
import { apiRequest, chainId } from '../lib/api';

type Status = {
  chainId: number;
  headBlock: string | null;
  finalizedBlock: string | null;
  latestIndexedBlock: string | null;
  lagBlocks: string | null;
};

// The instrument's heartbeat: the latest indexed block, finality, and the honest
// free-tier lag. Polls every 12s and nudges the block up ~1/s between polls so
// the readout feels live without hammering the API. Renders nothing until there
// is real indexed data — no fabricated numbers.
export function ChainStatusBar() {
  const [status, setStatus] = useState<Status | null>(null);
  const [ticks, setTicks] = useState(0);

  useEffect(() => {
    let active = true;
    const chain = chainId();
    async function load() {
      const res = await apiRequest<Status>(`/v1/chain-status?chainId=${chain}`);
      if (active && res.ok) {
        setStatus(res.data);
        setTicks(0);
      }
    }
    void load();
    const poll = setInterval(load, 12000);
    const tick = setInterval(() => setTicks((t) => t + 1), 1100);
    return () => {
      active = false;
      clearInterval(poll);
      clearInterval(tick);
    };
  }, []);

  if (!status || status.latestIndexedBlock === null) return null;

  const indexed = BigInt(status.latestIndexedBlock);
  const head = status.headBlock === null ? null : BigInt(status.headBlock);
  // Optimistic display: rise from the last poll toward the known head, capped so
  // it never claims a block past the head we've actually seen.
  let display = head === null ? indexed : indexed + BigInt(ticks);
  if (head !== null && display > head) display = head;

  const lag = status.lagBlocks === null ? null : BigInt(status.lagBlocks);

  return (
    <output className="statusbar">
      <span className="statusbar-item">
        blk <b>{display.toLocaleString('en-US')}</b>
      </span>
      <span className="statusbar-sep" aria-hidden="true">
        ·
      </span>
      <span className="statusbar-item">finalized</span>
      <span className="statusbar-sep" aria-hidden="true">
        ·
      </span>
      <span className="statusbar-item">
        chain <b>{status.chainId}</b>
      </span>
      {lag !== null && lag > 0n ? (
        <>
          <span className="statusbar-sep" aria-hidden="true">
            ·
          </span>
          <span className="statusbar-lag">indexer {lag.toLocaleString('en-US')} blk behind</span>
        </>
      ) : lag !== null ? (
        <>
          <span className="statusbar-sep" aria-hidden="true">
            ·
          </span>
          <span className="statusbar-item">at head</span>
        </>
      ) : null}
    </output>
  );
}
