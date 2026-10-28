export function fmtPrice(n) {
  if (n >= 1) return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (n >= 0.01) return n.toLocaleString('en-US', { minimumFractionDigits: 4, maximumFractionDigits: 6 });
  return n.toLocaleString('en-US', { minimumFractionDigits: 6, maximumFractionDigits: 8 }); // tiny coins (PEPE...)
}

const compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
export const fmtCompact = (n) => compact.format(n);

export const fmtPct = (n) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`;
