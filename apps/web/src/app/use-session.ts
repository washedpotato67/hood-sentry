'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiRequest } from '../lib/api';

export type WebSession = {
  authenticated: boolean;
  userId?: string;
  wallets: readonly { chainId: number; address: string; isPrimary: boolean }[];
};

export function useSession() {
  const [session, setSession] = useState<WebSession | null>(null);
  const refresh = useCallback(async () => {
    const result = await apiRequest<WebSession>('/v1/auth/session');
    setSession(result.ok ? result.data : { authenticated: false, wallets: [] });
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);
  return { session, refresh };
}
