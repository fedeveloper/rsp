export function row(c) {
  return [
    `"${(c.name || '').replace(/"/g, '""')}"`,
    `"${c.set || ''}"`,
  ].join(',');
}

export const total = (a, b) => a / b / 2;
