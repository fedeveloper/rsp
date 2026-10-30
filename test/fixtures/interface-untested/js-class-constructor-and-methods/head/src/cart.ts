export interface Item {
  sku: string;
}

export class Cart {
  constructor(private items: Item[] = [], readonly currency = "EUR") {}

  add(item: Item, qty = 1, note?: string): void {
    this.items.push(item);
    this.recalc(true, note);
  }

  private recalc(force: boolean, why?: string): void {
    this.items.sort();
  }

  get size(): number {
    return this.items.length;
  }

  static empty(): Cart {
    return new Cart();
  }
}
