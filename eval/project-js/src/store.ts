export interface Item {
  sku: string;
  name: string;
  quantity: number;
}

export class Store {
  private items = new Map<string, Item>();

  add(sku: string, name: string, quantity = 1): Item {
    const item = this.items.get(sku) ?? { sku, name, quantity: 0 };
    item.quantity += quantity;
    this.items.set(sku, item);
    return item;
  }

  remove(sku: string, quantity: number): Item {
    const item = this.items.get(sku);
    if (!item) throw new Error(`unknown sku ${sku}`);
    if (quantity > item.quantity) throw new Error(`only ${item.quantity} of ${sku} left`);
    item.quantity -= quantity;
    return item;
  }

  get(sku: string): Item | undefined {
    return this.items.get(sku);
  }

  list(): Item[] {
    return [...this.items.values()].sort((a, b) => a.sku.localeCompare(b.sku));
  }
}

export function totalQuantity(items: Item[]): number {
  return items.reduce((sum, item) => sum + item.quantity, 0);
}
