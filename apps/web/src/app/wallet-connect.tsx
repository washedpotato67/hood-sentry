'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { apiRequest, compactAddress } from '../lib/api';

export type EthereumProvider = {
  request(input: { method: string; params?: readonly unknown[] }): Promise<unknown>;
};

// EIP-6963: Multi Injected Provider Discovery. Every injected EVM wallet
// announces itself with an info block and its EIP-1193 provider, so we can
// list them all and let the user choose instead of relying on whichever
// extension happened to win `window.ethereum`.
type ProviderInfo = { uuid: string; name: string; icon: string; rdns: string };
type ProviderDetail = { info: ProviderInfo; provider: EthereumProvider };

declare global {
  interface Window {
    ethereum?: EthereumProvider;
  }
  interface WindowEventMap {
    'eip6963:announceProvider': CustomEvent<ProviderDetail>;
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

/** Turn an API failure into something a person can act on. Connectivity and
 * server faults (unreachable, 5xx, or an empty 404 from the proxy) all mean the
 * same thing to the user: the backend isn't answering right now. */
function friendlyApiError(result: { code: string; message: string; status: number }): string {
  if (result.code === 'SERVICE_UNREACHABLE' || result.status === 404 || result.status >= 500) {
    return "Wallet sign-in is unavailable right now. The Sentry API isn't responding. Please try again shortly.";
  }
  return result.message;
}

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

/** The block explorer's address page for a wallet, built from the same chain
 * metadata used to add the network — so "View on explorer" points at whichever
 * chain the session is on. */
function explorerAddressUrl(chainId: number, address: string): string {
  const base = chainMetadata(chainId).blockExplorerUrls[0] ?? '';
  return `${base}/address/${address}`;
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
  const [wallets, setWallets] = useState<readonly ProviderDetail[]>([]);
  const [menuOpen, setMenuOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const controlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    void apiRequest<Session>('/v1/auth/session').then((result) => {
      setSession(result.ok ? result.data : { authenticated: false, wallets: [] });
    });
  }, []);

  // Discover every injected EVM wallet via EIP-6963, de-duplicated by rdns.
  useEffect(() => {
    const found = new Map<string, ProviderDetail>();
    const onAnnounce = (event: WindowEventMap['eip6963:announceProvider']) => {
      const detail = event.detail;
      if (detail?.info?.rdns) {
        found.set(detail.info.rdns, detail);
        setWallets([...found.values()]);
      }
    };
    window.addEventListener('eip6963:announceProvider', onAnnounce);
    window.dispatchEvent(new Event('eip6963:requestProvider'));
    return () => window.removeEventListener('eip6963:announceProvider', onAnnounce);
  }, []);

  // Close whichever menu is open — the wallet picker or the account menu — on an
  // outside click.
  useEffect(() => {
    if (!menuOpen && !accountOpen) return;
    const onDown = (event: MouseEvent) => {
      if (controlRef.current && !controlRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
        setAccountOpen(false);
      }
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen, accountOpen]);

  const connect = useCallback(async (provider: EthereumProvider) => {
    setMenuOpen(false);
    setBusy(true);
    setError(null);
    try {
      const nonceResult = await apiRequest<Nonce>('/v1/auth/siwe/nonce', {
        method: 'POST',
        body: '{}',
      });
      if (!nonceResult.ok) throw new Error(friendlyApiError(nonceResult));
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
      if (!verified.ok) throw new Error(friendlyApiError(verified));
      setSession(verified.data);
    } catch (caught) {
      // EIP-1193 user rejection (e.g. wallet "Cancel") surfaces as code 4001.
      const rejected =
        typeof caught === 'object' && caught !== null && 'code' in caught
          ? (caught as { code?: number }).code === 4001
          : false;
      setError(
        rejected
          ? 'Sign-in canceled.'
          : caught instanceof Error
            ? caught.message
            : 'Wallet sign-in failed.',
      );
    } finally {
      setBusy(false);
    }
  }, []);

  function onConnectClick() {
    setError(null);
    // One wallet: connect directly. Several: let the user pick. None announced:
    // fall back to a legacy single injected provider, else prompt to install.
    const only = wallets[0];
    if (wallets.length === 1 && only) {
      void connect(only.provider);
      return;
    }
    if (wallets.length === 0) {
      if (typeof window !== 'undefined' && window.ethereum) {
        void connect(window.ethereum);
        return;
      }
      setError(
        'No EVM wallet detected. Install one (MetaMask, Rabby, Coinbase Wallet, …) to sign in.',
      );
      return;
    }
    setMenuOpen((open) => !open);
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
    <div className="wallet-control" ref={controlRef}>
      {session?.authenticated && wallet !== undefined ? (
        <>
          <button
            type="button"
            className="wallet-chip"
            onClick={() => setAccountOpen((open) => !open)}
            aria-haspopup="menu"
            aria-expanded={accountOpen}
            title={wallet.address}
          >
            <span className="conn-dot" aria-hidden="true" />
            <span className="wallet-addr">{compactAddress(wallet.address)}</span>
            <span className="wallet-caret" aria-hidden="true">
              ▾
            </span>
          </button>
          {accountOpen ? (
            <div className="wallet-menu account-menu" role="menu">
              <div className="wallet-menu-label">Signed in</div>
              <button
                type="button"
                role="menuitem"
                className="wallet-option"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(wallet.address);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  } catch {
                    // Clipboard access can be blocked; the address is still shown on hover.
                  }
                }}
              >
                {copied ? 'Copied ✓' : 'Copy address'}
              </button>
              <a
                role="menuitem"
                className="wallet-option"
                href={explorerAddressUrl(wallet.chainId, wallet.address)}
                target="_blank"
                rel="noreferrer"
                onClick={() => setAccountOpen(false)}
              >
                View on explorer ↗
              </a>
              <button
                type="button"
                role="menuitem"
                className="wallet-option danger"
                onClick={() => {
                  setAccountOpen(false);
                  void logout();
                }}
                disabled={busy}
              >
                Sign out
              </button>
            </div>
          ) : null}
        </>
      ) : (
        <button
          type="button"
          onClick={onConnectClick}
          disabled={busy}
          aria-haspopup={wallets.length > 1 ? 'menu' : undefined}
          aria-expanded={wallets.length > 1 ? menuOpen : undefined}
        >
          {busy ? 'Connecting…' : 'Connect wallet'}
        </button>
      )}
      {menuOpen && wallets.length > 1 ? (
        <div className="wallet-menu" role="menu">
          <div className="wallet-menu-label">Choose a wallet</div>
          {wallets.map((entry) => (
            <button
              type="button"
              role="menuitem"
              className="wallet-option"
              key={entry.info.rdns}
              onClick={() => connect(entry.provider)}
              disabled={busy}
            >
              {/* icons are data: or https: URIs, both allowed by the CSP */}
              <img src={entry.info.icon} alt="" width={20} height={20} />
              <span>{entry.info.name}</span>
            </button>
          ))}
        </div>
      ) : null}
      {error === null ? null : <span className="inline-error">{error}</span>}
    </div>
  );
}
