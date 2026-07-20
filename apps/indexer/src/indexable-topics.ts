import { ERC20_APPROVAL_TOPIC, ERC20_TRANSFER_TOPIC } from './token-discovery-handler.js';

/**
 * The minimum an adapter has to expose for its events to be indexable. Declared
 * structurally rather than importing the adapter interface so the allowlist
 * stays derived from what adapters actually publish.
 */
interface EventDeclaringAdapter {
  getEventDefinitions(): readonly { topic0: string }[];
}

/**
 * Every event topic some consumer in this system actually reads: the ERC-20
 * events token discovery is built on, plus whatever the active protocol
 * adapters declare.
 *
 * Storing every log a chain emits is what filled the database: most of them
 * belong to contracts nothing here decodes. Deriving the set from the adapters
 * rather than listing it by hand means enabling an adapter widens the filter
 * automatically, instead of silently starving it.
 */
export function indexableTopics(adapters: readonly EventDeclaringAdapter[]): readonly string[] {
  const topics = new Set<string>([ERC20_TRANSFER_TOPIC, ERC20_APPROVAL_TOPIC]);
  for (const adapter of adapters) {
    for (const definition of adapter.getEventDefinitions()) {
      topics.add(definition.topic0.toLowerCase());
    }
  }
  return [...topics];
}

/**
 * A log with no topics carries no event identity, so nothing can decode it and
 * it is never worth storing.
 */
export function isIndexableLog(
  log: { topics: readonly string[] },
  topics: readonly string[],
): boolean {
  const topic0 = log.topics[0]?.toLowerCase();
  if (topic0 === undefined) return false;
  return topics.some((candidate) => candidate.toLowerCase() === topic0);
}
