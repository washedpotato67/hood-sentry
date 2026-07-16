import type { FlagMap, FlagName, FlagState } from './types.js';

export interface FlagStore {
  getFlag(name: FlagName): Promise<FlagState>;
  getAllFlags(): Promise<FlagMap>;
  setFlag(name: FlagName, state: FlagState): Promise<void>;
}

export class InMemoryFlagStore implements FlagStore {
  private flags: Map<FlagName, FlagState>;

  constructor(initial?: Partial<Record<FlagName, boolean>>) {
    this.flags = new Map();
    for (const name of [
      'TRADING_ENABLED',
      'TOKEN_GATE_ENABLED',
      'GAS_SPONSORSHIP_ENABLED',
      'AI_EXPLANATIONS_ENABLED',
      'WEBHOOKS_ENABLED',
      'MAINNET_WRITES_ENABLED',
      'PROJECT_CLAIMS_ENABLED',
      'COMMUNITY_REPORTS_ENABLED',
      'RISK_SCORES_ENABLED',
    ] as const) {
      this.flags.set(name, {
        enabled: initial?.[name] ?? false,
        updatedAt: new Date(),
      });
    }
  }

  async getFlag(name: FlagName): Promise<FlagState> {
    return this.flags.get(name) ?? { enabled: false, updatedAt: new Date() };
  }

  async getAllFlags(): Promise<FlagMap> {
    const result = {} as FlagMap;
    for (const [key, value] of this.flags) {
      result[key] = value;
    }
    return result;
  }

  async setFlag(name: FlagName, state: FlagState): Promise<void> {
    this.flags.set(name, state);
  }
}

export class FeatureFlagService {
  constructor(private readonly store: FlagStore) {}

  async isEnabled(name: FlagName): Promise<boolean> {
    const state = await this.store.getFlag(name);
    return state.enabled;
  }

  async requireEnabled(name: FlagName): Promise<void> {
    const enabled = await this.isEnabled(name);
    if (!enabled) {
      throw new Error(`Feature flag ${name} is disabled`);
    }
  }

  async getAllFlags(): Promise<FlagMap> {
    return this.store.getAllFlags();
  }
}
