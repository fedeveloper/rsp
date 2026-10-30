import format, { type Item, totalQuantity } from "./store.js";

export function report(items: Item[]): string {
  return items.map(format).join("\n") + totalQuantity(items);
}
