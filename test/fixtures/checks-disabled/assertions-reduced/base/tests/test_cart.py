from shop.cart import Cart


def test_total():
    cart = Cart()
    cart.add("apple", 2)
    assert cart.total() == 2
    assert cart.items() == ["apple"]
    assert not cart.empty()
