'use client';

import { useState } from 'react';
import { apiRequest, chainId, compactAddress } from '../../lib/api';
import { useSession } from '../use-session';
import type { EthereumProvider } from '../wallet-connect';

type Quote = {
  quoteId: string;
  chainId: number;
  protocolKey: string;
  protocolVersion: string;
  inputTokenAddress: string;
  outputTokenAddress: string;
  amountInRaw: string;
  expectedAmountOutRaw: string;
  minimumAmountOutRaw: string;
  priceImpactBps?: string;
  protocolFeeRaw?: string;
  expiresAt: string;
  warnings: readonly { code: string; message: string; severity: string }[];
  route: readonly { poolAddress: string; inputTokenAddress: string; outputTokenAddress: string }[];
  allowanceRequirement: { spenderAddress: string; amountRaw: string } | null;
};

type Intent = {
  intentId: string;
  wallet: string;
  chainId: number;
  target: string;
  functionSelector: string;
  functionName: string;
  decodedArguments: readonly unknown[];
  calldata: string;
  nativeValue: string;
  expectedResult: string;
  simulation: { success: boolean; gasUsed?: string; revertData?: string };
  warnings: readonly string[];
  createdAt: string;
  expiresAt: string;
};

function browserProvider(): EthereumProvider | null {
  return window.ethereum ?? null;
}

export function TradePanel({ initialInput = '' }: { initialInput?: string }) {
  const { session } = useSession();
  const [inputTokenAddress, setInputTokenAddress] = useState(initialInput);
  const [outputTokenAddress, setOutputTokenAddress] = useState('');
  const [amountInRaw, setAmountInRaw] = useState('');
  const [slippageBps, setSlippageBps] = useState('100');
  const [quote, setQuote] = useState<Quote | null>(null);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const chain = chainId();

  async function requestQuote() {
    setBusy(true);
    setError(null);
    setIntent(null);
    setTransactionHash(null);
    const result = await apiRequest<Quote>('/v1/quotes', {
      method: 'POST',
      body: JSON.stringify({
        chainId: chain,
        inputTokenAddress,
        outputTokenAddress,
        amountInRaw,
        slippageBps,
      }),
    });
    setBusy(false);
    if (result.ok) setQuote(result.data);
    else setError(result.message);
  }

  async function prepareSwap() {
    if (quote === null) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest<Intent>('/v1/trades/prepare', {
      method: 'POST',
      body: JSON.stringify({ quoteId: quote.quoteId }),
    });
    setBusy(false);
    if (result.ok) setIntent(result.data);
    else setError(result.message);
  }

  async function prepareApproval() {
    if (quote?.allowanceRequirement === null || quote?.allowanceRequirement === undefined) return;
    setBusy(true);
    setError(null);
    const result = await apiRequest<Intent>('/v1/approvals/prepare', {
      method: 'POST',
      body: JSON.stringify({
        chainId: chain,
        tokenAddress: quote.inputTokenAddress,
        spenderAddress: quote.allowanceRequirement.spenderAddress,
        amountRaw: quote.allowanceRequirement.amountRaw,
      }),
    });
    setBusy(false);
    if (result.ok) setIntent(result.data);
    else setError(result.message);
  }

  async function sendIntent() {
    if (intent === null) return;
    if (!intent.simulation.success || new Date(intent.expiresAt).getTime() <= Date.now()) {
      setError('The simulated intent expired. Prepare a new transaction.');
      return;
    }
    const provider = browserProvider();
    if (provider === null) {
      setError('No EVM wallet provider is available.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const currentChain = await provider.request({ method: 'eth_chainId' });
      if (typeof currentChain !== 'string' || BigInt(currentChain) !== BigInt(intent.chainId)) {
        throw new Error('The wallet chain does not match the simulated intent.');
      }
      const accounts = await provider.request({ method: 'eth_accounts' });
      const active = Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : '';
      if (active.toLowerCase() !== intent.wallet.toLowerCase()) {
        throw new Error('The active wallet does not match the simulated intent.');
      }
      const hash = await provider.request({
        method: 'eth_sendTransaction',
        params: [
          {
            from: intent.wallet,
            to: intent.target,
            data: intent.calldata,
            value: `0x${BigInt(intent.nativeValue).toString(16)}`,
          },
        ],
      });
      if (typeof hash !== 'string')
        throw new Error('The wallet did not return a transaction hash.');
      setTransactionHash(hash);
      let recorded = false;
      for (let attempt = 0; attempt < 5 && !recorded; attempt += 1) {
        const result = await apiRequest<{ status: string }>(
          `/v1/transaction-intents/${intent.intentId}/broadcast`,
          { method: 'POST', body: JSON.stringify({ transactionHash: hash }) },
        );
        if (result.ok) recorded = true;
        else if (result.code !== 'TRANSACTION_NOT_VISIBLE') throw new Error(result.message);
        else await new Promise((resolve) => window.setTimeout(resolve, 1_000));
      }
      if (!recorded) throw new Error('The RPC provider has not observed the transaction yet.');
      for (let attempt = 0; attempt < 40; attempt += 1) {
        const receipt = await provider.request({
          method: 'eth_getTransactionReceipt',
          params: [hash],
        });
        if (receipt !== null) {
          const confirmed = await apiRequest<{ status: string }>(
            `/v1/transaction-intents/${intent.intentId}/confirm`,
            { method: 'POST', body: JSON.stringify({ transactionHash: hash }) },
          );
          if (!confirmed.ok) throw new Error(confirmed.message);
          break;
        }
        await new Promise((resolve) => window.setTimeout(resolve, 3_000));
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Wallet transaction failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack">
      <section className="panel">
        <div className="form-grid">
          <label className="field">
            Input token
            <input
              value={inputTokenAddress}
              onChange={(event) => setInputTokenAddress(event.target.value)}
              placeholder="0x…"
            />
          </label>
          <label className="field">
            Output token
            <input
              value={outputTokenAddress}
              onChange={(event) => setOutputTokenAddress(event.target.value)}
              placeholder="0x…"
            />
          </label>
          <label className="field">
            Raw input amount
            <input
              inputMode="numeric"
              value={amountInRaw}
              onChange={(event) => setAmountInRaw(event.target.value)}
              placeholder="1000000000000000000"
            />
          </label>
          <label className="field">
            Slippage, basis points
            <input
              inputMode="numeric"
              value={slippageBps}
              onChange={(event) => setSlippageBps(event.target.value)}
            />
          </label>
        </div>
        <div className="actions">
          <button className="primary" type="button" onClick={requestQuote} disabled={busy}>
            Get verified quote
          </button>
        </div>
      </section>
      {quote === null ? null : (
        <section className="panel">
          <h2>Quote review</h2>
          <div className="metric-row">
            <span>Protocol</span>
            <strong>
              {quote.protocolKey} {quote.protocolVersion}
            </strong>
          </div>
          <div className="metric-row">
            <span>Expected output</span>
            <strong>{quote.expectedAmountOutRaw}</strong>
          </div>
          <div className="metric-row">
            <span>Minimum received</span>
            <strong>{quote.minimumAmountOutRaw}</strong>
          </div>
          <div className="metric-row">
            <span>Price impact</span>
            <strong>{quote.priceImpactBps ?? 'Unavailable'} bps</strong>
          </div>
          <div className="metric-row">
            <span>Route</span>
            <strong>
              {quote.route.length} pool{quote.route.length === 1 ? '' : 's'}
            </strong>
          </div>
          <div className="metric-row">
            <span>Expires</span>
            <strong>{new Date(quote.expiresAt).toLocaleTimeString()}</strong>
          </div>
          <div className="actions">
            {quote.allowanceRequirement === null ? null : (
              <button
                type="button"
                onClick={prepareApproval}
                disabled={busy || !session?.authenticated}
              >
                Prepare exact approval
              </button>
            )}
            <button
              className="primary"
              type="button"
              onClick={prepareSwap}
              disabled={busy || !session?.authenticated}
            >
              Simulate swap
            </button>
          </div>
          {!session?.authenticated ? (
            <p className="warning">Sign in before transaction preparation.</p>
          ) : null}
        </section>
      )}
      {intent === null ? null : (
        <section className="panel">
          <h2>Transaction intent</h2>
          <div className="metric-row">
            <span>Action</span>
            <strong>{intent.functionName}</strong>
          </div>
          <div className="metric-row">
            <span>Wallet</span>
            <code>{compactAddress(intent.wallet)}</code>
          </div>
          <div className="metric-row">
            <span>Target</span>
            <code>{intent.target}</code>
          </div>
          <div className="metric-row">
            <span>Selector</span>
            <code>{intent.functionSelector}</code>
          </div>
          <div className="metric-row">
            <span>Expected result</span>
            <strong>{intent.expectedResult}</strong>
          </div>
          <div className="metric-row">
            <span>Simulation</span>
            <strong className={intent.simulation.success ? 'success' : 'danger'}>
              {intent.simulation.success
                ? `Passed, gas ${intent.simulation.gasUsed ?? 'unknown'}`
                : 'Failed'}
            </strong>
          </div>
          <details>
            <summary>Review calldata</summary>
            <div className="result-box">
              <code>{intent.calldata}</code>
            </div>
          </details>
          <div className="actions">
            <button
              className="primary"
              type="button"
              onClick={sendIntent}
              disabled={busy || !intent.simulation.success}
            >
              Send in wallet
            </button>
          </div>
        </section>
      )}
      {transactionHash === null ? null : (
        <section className="panel success">
          Wallet broadcast submitted. Transaction hash: <code>{transactionHash}</code>
        </section>
      )}
      {error === null ? null : <section className="panel danger">{error}</section>}
    </div>
  );
}
