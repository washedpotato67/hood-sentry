import { type PublicClient, type Transport, createPublicClient, webSocket } from 'viem';
import type { Chain } from 'viem';
import type { WebSocketSubscription } from './types.js';

export interface WebSocketManagerConfig {
  url: string;
  chain: Chain;
  reconnectEnabled: boolean;
  maxReconnectAttempts: number;
  reconnectBaseDelayMs: number;
  reconnectMaxDelayMs: number;
  pingIntervalMs: number;
  pongTimeoutMs: number;
}

export class WebSocketManager {
  private client: PublicClient<Transport, Chain> | null = null;
  private subscriptions: Map<string, WebSocketSubscription> = new Map();
  private reconnectAttempts = 0;
  private isConnected = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private readonly config: WebSocketManagerConfig;
  private readonly role: 'primary' | 'secondary';

  constructor(role: 'primary' | 'secondary', config: WebSocketManagerConfig) {
    this.role = role;
    this.config = config;
  }

  async connect(): Promise<void> {
    if (this.isConnected) {
      return;
    }

    try {
      this.client = createPublicClient({
        chain: this.config.chain,
        transport: webSocket(this.config.url),
      });

      this.isConnected = true;
      this.reconnectAttempts = 0;
      this.startPingTimer();

      // Restore subscriptions
      await this.restoreSubscriptions();
    } catch (error) {
      this.isConnected = false;
      this.client = null;

      if (this.config.reconnectEnabled) {
        this.scheduleReconnect();
      }

      throw error;
    }
  }

  async disconnect(): Promise<void> {
    this.stopPingTimer();

    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.client) {
      // Unsubscribe from all subscriptions
      for (const [id] of this.subscriptions.entries()) {
        try {
          await this.unsubscribe(id);
        } catch (_error) {
          // Ignore unsubscribe errors during disconnect
        }
      }

      this.client = null;
    }

    this.isConnected = false;
  }

  async subscribe(subscription: WebSocketSubscription): Promise<string> {
    if (!this.isConnected || !this.client) {
      throw new Error('WebSocket not connected');
    }

    this.subscriptions.set(subscription.id, subscription);

    try {
      if (subscription.type === 'newHeads') {
        await this.client.watchBlocks({
          onBlock: (block) => {
            subscription.callback(block);
          },
        });
      } else if (subscription.type === 'logs') {
        await this.client.watchEvent({
          onLogs: (logs) => {
            subscription.callback(logs);
          },
          ...(subscription.filter as object),
        });
      } else if (subscription.type === 'newPendingTransactions') {
        await this.client.watchPendingTransactions({
          onTransactions: (transactions) => {
            subscription.callback(transactions);
          },
        });
      }

      return subscription.id;
    } catch (error) {
      this.subscriptions.delete(subscription.id);
      throw error;
    }
  }

  async unsubscribe(subscriptionId: string): Promise<void> {
    this.subscriptions.delete(subscriptionId);
    // Note: Viem handles unsubscription internally when the watcher is stopped
  }

  getClient(): PublicClient<Transport, Chain> | null {
    return this.client;
  }

  getIsConnected(): boolean {
    return this.isConnected;
  }

  getRole(): 'primary' | 'secondary' {
    return this.role;
  }

  getSubscriptionCount(): number {
    return this.subscriptions.size;
  }

  private scheduleReconnect(): void {
    if (this.reconnectAttempts >= this.config.maxReconnectAttempts) {
      return;
    }

    const delay = Math.min(
      this.config.reconnectBaseDelayMs * 2 ** this.reconnectAttempts,
      this.config.reconnectMaxDelayMs,
    );

    this.reconnectAttempts++;

    this.reconnectTimer = setTimeout(async () => {
      try {
        await this.connect();
      } catch (_error) {
        // Reconnect failed, will retry
      }
    }, delay);
  }

  private async restoreSubscriptions(): Promise<void> {
    const subscriptions = Array.from(this.subscriptions.values());
    this.subscriptions.clear();

    for (const subscription of subscriptions) {
      try {
        await this.subscribe(subscription);
      } catch (_error) {
        // Failed to restore subscription, will retry on next reconnect
      }
    }
  }

  private startPingTimer(): void {
    this.pingTimer = setInterval(async () => {
      if (!this.client) {
        return;
      }

      try {
        // Simple ping by requesting block number
        await this.client.getBlockNumber();
      } catch (_error) {
        // Connection lost, trigger reconnect
        this.isConnected = false;
        this.client = null;
        this.stopPingTimer();

        if (this.config.reconnectEnabled) {
          this.scheduleReconnect();
        }
      }
    }, this.config.pingIntervalMs);
  }

  private stopPingTimer(): void {
    if (this.pingTimer) {
      clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  reset(): void {
    this.subscriptions.clear();
    this.reconnectAttempts = 0;
  }
}
