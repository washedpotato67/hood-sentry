'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

export function SearchBox() {
  const router = useRouter();
  const [query, setQuery] = useState('');
  return (
    <form
      className="search-form"
      onSubmit={(event) => {
        event.preventDefault();
        const value = query.trim();
        if (/^0x[0-9a-fA-F]{40}$/.test(value)) router.push(`/token/${value}`);
        else if (value.length > 0) router.push(`/discover?query=${encodeURIComponent(value)}`);
      }}
    >
      <input
        className="search"
        aria-label="Search addresses, tokens, and wallets"
        placeholder="Token name, symbol, or address"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
    </form>
  );
}
