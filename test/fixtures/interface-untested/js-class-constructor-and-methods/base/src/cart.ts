export interface Item {
  sku: string;
}

export class Cart {
  constructor(private items: Item[] = []) {}

  add(item: Item, qty = 1): void {
    this.items.push(item);
  }

  private recalc(force: boolean): void {
    this.items.sort();
  }

  get size(): number {
    return this.items.length;
  }

  static empty(): Cart {
    return new Cart();
  }
}
