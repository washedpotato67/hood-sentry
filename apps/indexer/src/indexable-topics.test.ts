import { describe, expect, it } from 'vitest';
import { indexableTopics, isIndexableLog } from './indexable-topics.js';
import { ERC20_APPROVAL_TOPIC, ERC20_TRANSFER_TOPIC } from './token-discovery-handler.js';

const POOL_CREATED = '0x0d3648bd0f6ba80134a33ba9275ac585d9d315f0ad8355cddefde31afa28d0e9';
const SWAP = '0xd78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822';

function definitions(topic0: string) {
  return [{ kind: 'swap', contractRole: 'pool', signature: 'Swap()', topic0 }] as const;
}

describe('indexable topics', () => {
  it('always includes the ERC-20 events discovery is built on', () => {
    const topics = indexableTopics([]);

    expect(topics).toContain(ERC20_TRANSFER_TOPIC);
    expect(topics).toContain(ERC20_APPROVAL_TOPIC);
  });

  it('includes every event the active protocol adapters declare', () => {
    const topics = indexableTopics([
      { getEventDefinitions: () => definitions(POOL_CREATED) },
      { getEventDefinitions: () => definitions(SWAP) },
    ]);

    expect(topics).toContain(POOL_CREATED);
    expect(topics).toContain(SWAP);
  });

  it('matches case-insensitively, since providers vary in hex casing', () => {
    const topics = indexableTopics([
      { getEventDefinitions: () => definitions(SWAP.toUpperCase()) },
    ]);

    expect(isIndexableLog({ topics: [SWAP] }, topics)).toBe(true);
  });

  it('rejects a log whose event no consumer reads', () => {
    const topics = indexableTopics([]);

    expect(isIndexableLog({ topics: [SWAP] }, topics)).toBe(false);
  });

  it('rejects a log with no topics, which carries no event identity', () => {
    const topics = indexableTopics([]);

    expect(isIndexableLog({ topics: [] }, topics)).toBe(false);
  });
});
