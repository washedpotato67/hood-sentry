import type { Hex } from 'viem';
export type TradingQuote = {
  quoteId: string;
  provider: string;
  chainId: number;
  route: readonly `0x${string}`[];
  input: `0x${string}`;
  output: `0x${string}`;
  amountIn: bigint;
  expectedOut: bigint;
  minimumOut: bigint;
  fee: bigint;
  priceImpactBps: bigint;
  gas: bigint;
  spender?: `0x${string}`;
  approval?: bigint;
  deadline: number;
  sourceBlock: bigint;
  expiresAt: number;
  target: `0x${string}`;
  selector: `0x${string}`;
  calldata: Hex;
  warnings: readonly string[];
};
export type QuoteValidator = {
  chainId: number;
  targetAllowed: (a: `0x${string}`) => boolean;
  selectorAllowed: (a: `0x${string}`, s: `0x${string}`) => boolean;
  spenderAllowed: (a: `0x${string}`) => boolean;
  simulate: (tx: { target: `0x${string}`; data: Hex; value: bigint }) => Promise<boolean>;
};
export async function validateQuote(q: TradingQuote, v: QuoteValidator, now: number, value = 0n) {
  if (q.chainId !== v.chainId || now >= q.expiresAt || now >= q.deadline)
    throw new Error('Quote expired or chain mismatch');
  if (
    !v.targetAllowed(q.target) ||
    !v.selectorAllowed(q.target, q.selector) ||
    (q.spender !== undefined && !v.spenderAllowed(q.spender))
  )
    throw new Error('Quote target, selector, or spender is not allowlisted');
  if (
    q.calldata.slice(0, 10).toLowerCase() !== q.selector.toLowerCase() ||
    q.minimumOut > q.expectedOut ||
    q.priceImpactBps > 1000n
  )
    throw new Error('Quote output or impact is invalid');
  if (!(await v.simulate({ target: q.target, data: q.calldata, value })))
    throw new Error('Quote simulation failed');
  return q;
}
