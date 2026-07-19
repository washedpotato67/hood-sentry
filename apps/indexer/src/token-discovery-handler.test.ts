import { getAddress, numberToHex, padHex } from 'viem';
import { describe, expect, it, vi } from 'vitest';
import { type DiscoveryBlockData, TokenDiscoveryHandler } from './token-discovery-handler.js';

const BLOCK_HASH = '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const TRANSACTION_HASH = '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
const APPROVAL_TRANSACTION_HASH =
  '0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc';
const CREATOR_ADDRESS = getAddress('0x1111111111111111111111111111111111111111');
const CONTRACT_ADDRESS = getAddress('0x2222222222222222222222222222222222222222');
const TOKEN_ADDRESS = getAddress('0x3333333333333333333333333333333333333333');
const FROM_ADDRESS = getAddress('0x4444444444444444444444444444444444444444');
const TO_ADDRESS = getAddress('0x5555555555555555555555555555555555555555');
const SPENDER_ADDRESS = getAddress('0x6666666666666666666666666666666666666666');
const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef';
const APPROVAL_TOPIC = '0x8c5be1e5ebec7d5bd14f70ef71315f9003819d0370313b11d1b585155b528b34';

function emptyBlockData(): DiscoveryBlockData {
  return {
    block: { number: 0n, hash: BLOCK_HASH },
    transactions: [],
    receipts: [],
    logs: [],
  };
}

describe('TokenDiscoveryHandler', () => {
  it('uses the successful receipt address for contract creation at block zero', () => {
    const logger = { warn: vi.fn() };
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, logger);
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      transactions: [
        {
          hash: TRANSACTION_HASH,
          from: CREATOR_ADDRESS,
          to: null,
          nonce: 7,
        },
      ],
      receipts: [
        {
          transactionHash: TRANSACTION_HASH,
          status: 'success',
          contractAddress: CONTRACT_ADDRESS,
        },
      ],
    };

    expect(handler.detectNewContractsAndTokens(blockData)).toEqual([
      {
        type: 'contract-creation',
        chainId: 4663n,
        blockNumber: 0n,
        blockHash: BLOCK_HASH,
        data: {
          transactionHash: TRANSACTION_HASH,
          contractAddress: CONTRACT_ADDRESS,
          creatorAddress: CREATOR_ADDRESS,
          nonce: '7',
        },
      },
    ]);
  });

  it('decodes ERC-20 transfers and approvals with decimal-safe values', () => {
    const logger = { warn: vi.fn() };
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, logger);
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      block: { number: 42n, hash: BLOCK_HASH },
      logs: [
        {
          transactionHash: TRANSACTION_HASH,
          logIndex: 1,
          address: TOKEN_ADDRESS,
          topics: [TRANSFER_TOPIC, padHex(FROM_ADDRESS), padHex(TO_ADDRESS)],
          data: numberToHex(1_000_000_000_000_000_000n, { size: 32 }),
        },
        {
          transactionHash: APPROVAL_TRANSACTION_HASH,
          logIndex: 2,
          address: TOKEN_ADDRESS,
          topics: [APPROVAL_TOPIC, padHex(FROM_ADDRESS), padHex(SPENDER_ADDRESS)],
          data: numberToHex(500n, { size: 32 }),
        },
      ],
    };

    expect(handler.detectNewContractsAndTokens(blockData)).toEqual([
      {
        type: 'token-transfer',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: {
          transactionHash: TRANSACTION_HASH,
          logIndex: 1,
          tokenAddress: TOKEN_ADDRESS,
          valueRaw: '1000000000000000000',
          fromAddress: FROM_ADDRESS,
          toAddress: TO_ADDRESS,
        },
      },
      {
        type: 'alert-evaluation',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: {
          transactionHash: TRANSACTION_HASH,
          logIndex: 1,
          tokenAddress: TOKEN_ADDRESS,
          valueRaw: '1000000000000000000',
          fromAddress: FROM_ADDRESS,
          toAddress: TO_ADDRESS,
          eventType: 'tokenTransfer',
        },
      },
      {
        type: 'wallet-activity',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: {
          transactionHash: TRANSACTION_HASH,
          logIndex: 1,
          tokenAddress: TOKEN_ADDRESS,
          valueRaw: '1000000000000000000',
          fromAddress: FROM_ADDRESS,
          toAddress: TO_ADDRESS,
          eventType: 'tokenTransfer',
        },
      },
      {
        type: 'token-approval',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: {
          transactionHash: APPROVAL_TRANSACTION_HASH,
          logIndex: 2,
          tokenAddress: TOKEN_ADDRESS,
          valueRaw: '500',
          ownerAddress: FROM_ADDRESS,
          spenderAddress: SPENDER_ADDRESS,
        },
      },
      {
        type: 'alert-evaluation',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: {
          transactionHash: APPROVAL_TRANSACTION_HASH,
          logIndex: 2,
          tokenAddress: TOKEN_ADDRESS,
          valueRaw: '500',
          ownerAddress: FROM_ADDRESS,
          spenderAddress: SPENDER_ADDRESS,
          eventType: 'tokenApproval',
        },
      },
      {
        type: 'token-metadata',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: { tokenAddress: TOKEN_ADDRESS },
      },
      {
        type: 'discovery-refresh',
        chainId: 4663n,
        blockNumber: 42n,
        blockHash: BLOCK_HASH,
        data: { tokenAddress: TOKEN_ADDRESS },
      },
    ]);
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('emits token metadata once per distinct token so repeat transfers stay cheap', () => {
    const logger = { warn: vi.fn() };
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, logger);
    const transfer = (logIndex: number): DiscoveryBlockData['logs'][number] => ({
      transactionHash: TRANSACTION_HASH,
      logIndex,
      address: TOKEN_ADDRESS,
      topics: [TRANSFER_TOPIC, padHex(FROM_ADDRESS), padHex(TO_ADDRESS)],
      data: numberToHex(1n, { size: 32 }),
    });
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      block: { number: 42n, hash: BLOCK_HASH },
      logs: [transfer(1), transfer(2), transfer(3)],
    };

    const metadata = handler
      .detectNewContractsAndTokens(blockData)
      .filter((job) => job.type === 'token-metadata');

    expect(metadata).toHaveLength(1);
  });

  it('emits one discovery refresh per token per block, not per transfer', () => {
    const logger = { warn: vi.fn() };
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, logger);
    const otherToken = getAddress('0x7777777777777777777777777777777777777777');
    const transfer = (
      address: `0x${string}`,
      logIndex: number,
    ): DiscoveryBlockData['logs'][number] => ({
      transactionHash: TRANSACTION_HASH,
      logIndex,
      address,
      topics: [TRANSFER_TOPIC, padHex(FROM_ADDRESS), padHex(TO_ADDRESS)],
      data: numberToHex(1n, { size: 32 }),
    });
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      block: { number: 42n, hash: BLOCK_HASH },
      // Three transfers, two of them for the same token.
      logs: [transfer(TOKEN_ADDRESS, 1), transfer(TOKEN_ADDRESS, 2), transfer(otherToken, 3)],
    };

    const refreshes = handler
      .detectNewContractsAndTokens(blockData)
      .filter((job) => job.type === 'discovery-refresh');

    expect(refreshes).toHaveLength(2);
    expect(refreshes.map((job) => (job.data as { tokenAddress: string }).tokenAddress)).toEqual([
      TOKEN_ADDRESS,
      otherToken,
    ]);
  });

  it('does not emit a discovery refresh for approval-only activity', () => {
    const logger = { warn: vi.fn() };
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, logger);
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      block: { number: 42n, hash: BLOCK_HASH },
      logs: [
        {
          transactionHash: APPROVAL_TRANSACTION_HASH,
          logIndex: 2,
          address: TOKEN_ADDRESS,
          topics: [APPROVAL_TOPIC, padHex(FROM_ADDRESS), padHex(SPENDER_ADDRESS)],
          data: numberToHex(500n, { size: 32 }),
        },
      ],
    };

    expect(
      handler
        .detectNewContractsAndTokens(blockData)
        .some((job) => job.type === 'discovery-refresh'),
    ).toBe(false);
  });

  it('skips malformed ERC-20 events without throwing', () => {
    const logger = { warn: vi.fn() };
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, logger);
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      logs: [
        {
          transactionHash: TRANSACTION_HASH,
          logIndex: 3,
          address: TOKEN_ADDRESS,
          topics: [TRANSFER_TOPIC, padHex(FROM_ADDRESS), padHex(TO_ADDRESS)],
          data: '0x01',
        },
      ],
    };

    expect(handler.detectNewContractsAndTokens(blockData)).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Skipping malformed ERC-20 event',
      expect.objectContaining({ reason: 'invalid ERC-20 event shape' }),
    );
  });

  it('does not report failed contract deployments', () => {
    const handler = new TokenDiscoveryHandler({ chainId: 4663n }, { warn: vi.fn() });
    const blockData: DiscoveryBlockData = {
      ...emptyBlockData(),
      transactions: [
        {
          hash: TRANSACTION_HASH,
          from: CREATOR_ADDRESS,
          to: null,
          nonce: 8,
        },
      ],
      receipts: [
        {
          transactionHash: TRANSACTION_HASH,
          status: 'reverted',
          contractAddress: null,
        },
      ],
    };

    expect(handler.detectNewContractsAndTokens(blockData)).toEqual([]);
  });
});
