import { describe, expect, it } from "vitest";
import { Store, totalQuantity } from "../src/store.js";

describe("Store", () => {
  it("adds and accumulates quantity", () => {
    const store = new Store();
    store.add("pear", "Pear", 2);
    const item = store.add("pear", "Pear", 3);
    expect(item.quantity).toBe(5);
    expect(store.get("pear")).toEqual(item);
  });

  it("rejects removing more than is left", () => {
    const store = new Store();
    store.add("fig", "Fig", 1);
    expect(() => store.remove("fig", 2)).toThrow(/only 1/);
  });

  it("totals quantities", () => {
    expect(totalQuantity([{ sku: "a", name: "A", quantity: 2 }, { sku: "b", name: "B", quantity: 3 }])).toBe(5);
  });
});
