import { useEffect, useState } from 'react';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The address phones should use to reach this app. On the host's own machine the page is open at
 * localhost, which means nothing to a phone, so ask the server for its LAN address and keep the
 * page's port (Vite's in development, the server's in production).
 */
export function useJoinBase(): string {
  const [base, setBase] = useState(window.location.origin);

  useEffect(() => {
    if (!LOOPBACK.has(window.location.hostname)) return;
    let cancelled = false;
    fetch('/api/info')
      .then((response) => response.json() as Promise<{ lanAddresses?: string[] }>)
      .then((info) => {
        const address = info.lanAddresses?.[0];
        if (!address || cancelled) return;
        const port = window.location.port ? `:${window.location.port}` : '';
        setBase(`${window.location.protocol}//${address}${port}`);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return base;
}
