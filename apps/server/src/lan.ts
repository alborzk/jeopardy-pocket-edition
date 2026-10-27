import { networkInterfaces } from 'node:os';

function isPrivate(address: string): boolean {
  if (address.startsWith('192.168.') || address.startsWith('10.')) return true;
  const match = /^172\.(\d+)\./.exec(address);
  return match !== null && Number(match[1]) >= 16 && Number(match[1]) <= 31;
}

/** IPv4 addresses of this machine on the local network, most likely Wi-Fi/Ethernet first. */
export function getLanAddresses(): string[] {
  const found: string[] = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const entry of addresses ?? []) {
      if (entry.family === 'IPv4' && !entry.internal) found.push(entry.address);
    }
  }
  return found.sort((a, b) => Number(isPrivate(b)) - Number(isPrivate(a)));
}
