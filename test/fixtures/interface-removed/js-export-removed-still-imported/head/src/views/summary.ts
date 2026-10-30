import {
  type Item,
  totalQuantity,
} from "../store";

export const summary = (items: Item[]) => totalQuantity(items);
