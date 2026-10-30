export interface Item {
  sku: string;
  quantity: number;
}

export function totalQuantity(items: Item[]): number {
  return items.reduce((s, i) => s + i.quantity, 0);
}

export default function format(item: Item): string {
  return `${item.sku} x${item.quantity}`;
}
