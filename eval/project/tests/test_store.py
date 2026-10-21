import pytest

from inventory.store import Store


def test_add_accumulates_quantity():
    store = Store()
    store.add("apple", 2)
    item = store.add("apple", 3)
    assert item.quantity == 5


def test_add_rejects_non_positive_quantity():
    store = Store()
    with pytest.raises(ValueError):
        store.add("apple", 0)


def test_remove_decreases_quantity():
    store = Store()
    store.add("pear", 4)
    item = store.remove("pear", 1)
    assert item.quantity == 3
    assert store.get("pear") == item


def test_remove_rejects_overdraw():
    store = Store()
    store.add("pear", 1)
    with pytest.raises(ValueError):
        store.remove("pear", 2)
