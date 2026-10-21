from typing import cast

from pydantic import BaseModel


class Item(BaseModel):
    sku: str
    quantity: int


class Store:
    def __init__(self) -> None:
        self._items: dict[str, Item] = {}

    def add(self, sku: str, quantity: int) -> Item:
        if quantity <= 0:
            raise ValueError("quantity must be positive")
        current = self._items.get(sku)
        total = quantity + (current.quantity if current else 0)
        item = Item(sku=sku, quantity=total)
        self._items[sku] = item
        return item

    def remove(self, sku: str, quantity: int) -> Item:
        item = self._items[sku]
        if quantity > item.quantity:
            raise ValueError("not enough stock")
        updated = Item(sku=sku, quantity=item.quantity - quantity)
        self._items[sku] = updated
        return updated

    def get(self, sku: str) -> Item | None:
        return self._items.get(sku)


def legacy_total(store: Store) -> int:
    return cast(int, sum(i.quantity for i in store._items.values()))  # type: ignore[attr-defined]
