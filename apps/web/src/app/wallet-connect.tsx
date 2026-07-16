'use client';

import { useEffect, useState } from 'react';
import { apiRequest, compactAddress } from '../lib/api';

export type EthereumProvider = {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
}

type Session = {
  authenticated: boolean;
  wallets: readonly { chainId: number; address: string; isPrimary: boolean }[];
};

type Nonce = {
  nonce: string;
  domain: string;
  uri: string;
  chainId: number;
  issuedAt: string;
  expirationTime: string;
};

function chainMetadata(chainId: number) {
  return chainId === 4663
    ? {
        chainName: 'Robinhood Chain',
        rpcUrls: ['https://rpc.mainnet.chain.robinhood.com'],
        blockExplorerUrls: ['https://robinhoodchain.blockscout.com'],
      }
    : {
        chainName: 'Robinhood Chain Testnet',
        rpcUrls: ['https://rpc.testnet.chain.robinhood.com'],
        blockExplorerUrls: ['https://explorer.testnet.chain.robinhood.com'],
      };
}

async function selectChain(provider: EthereumProvider, chainId: number): Promise<void> {
  const chainHex = `0x${chainId.toString(16)}`;
  try {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: chainHex }],
    });
  } catch {
    const metadata = chainMetadata(chainId);
    await provider.request({
      method: 'wallet_addEthereumChain',
      params: [
        {
          chainId: chainHex,
          chainName: metadata.chainName,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: metadata.rpcUrls,
          blockExplorerUrls: metadata.blockExplorerUrls,
        },
      ],
    });
  }
}

export function WalletConnect() {
  const [session, setSession] = useState<Session | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void apiRequest<Session>('/v1/auth/session').then((result) => {
      setSession(result.ok ? result.data : { authenticated: false, wallets: [] });
    });
  }, []);

  async function connect() {
    const provider = window.ethereum;
    if (provider === undefined) {
      setError('Install an EVM wallet extension to sign in.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const nonceResult = await apiRequest<Nonce>('/v1/auth/siwe/nonce', {
        method: 'POST',
        body: '{}',
      });
      if (!nonceResult.ok) throw new Error(nonceResult.message);
      const nonce = nonceResult.data;
      await selectChain(provider, nonce.chainId);
      const accounts = await provider.request({ method: 'eth_requestAccounts' });
      const address =
        Array.isArray(accounts) && typeof accounts[0] === 'string' ? accounts[0] : null;
      if (address === null) throw new Error('The wallet did not return an account.');
      const message = `${nonce.domain} wants you to sign in with your Ethereum account:\n${address}\n\nSign in to Hood Sentry.\n\nURI: ${nonce.uri}\nVersion: 1\nChain ID: ${nonce.chainId}\nNonce: ${nonce.nonce}\nIssued At: ${nonce.issuedAt}\nExpiration Time: ${nonce.expirationTime}`;
      const signature = await provider.request({
        method: 'personal_sign',
        params: [message, address],
      });
      if (typeof signature !== 'string') throw new Error('The wallet did not return a signature.');
      const verified = await apiRequest<Session>('/v1/auth/siwe/verify', {
        method: 'POST',
        body: JSON.stringify({ message, signature }),
      });
      if (!verified.ok) throw new Error(verified.message);
      setSession(verified.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Wallet sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function logout() {
    setBusy(true);
    const result = await apiRequest<{ authenticated: false }>('/v1/auth/logout', {
      method: 'POST',
      body: '{}',
    });
    setBusy(false);
    if (result.ok) setSession({ authenticated: false, wallets: [] });
  }

  const wallet = session?.wallets.find((entry) => entry.isPrimary) ?? session?.wallets[0];
  return (
    <div className="wallet-control">
      {session?.authenticated && wallet !== undefined ? (
        <button type="button" onClick={logout} disabled={busy} title="Sign out">
          {compactAddress(wallet.address)}
        </button>
      ) : (
        <button type="button" onClick={connect} disabled={busy}>
          {busy ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
      {error === null ? null : <span className="inline-error">{error}</span>}
    </div>
  );
}
