export function formatMoney(amount: number): string {
  const sign = amount < 0 ? '-' : '';
  return `${sign}$${Math.abs(amount).toLocaleString('en-US')}`;
}

export function formatSeconds(ms: number | null): string {
  return ms === null ? '' : String(Math.ceil(ms / 1000));
}
