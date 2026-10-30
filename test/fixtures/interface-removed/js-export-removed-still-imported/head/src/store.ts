export interface Item {
  sku: string;
  quantity: number;
}

export function sumQuantities(items: Item[]): number {
  return items.reduce((s, i) => s + i.quantity, 0);
}

export function formatItem(item: Item): string {
  return `${item.sku} x${item.quantity}`;
}
