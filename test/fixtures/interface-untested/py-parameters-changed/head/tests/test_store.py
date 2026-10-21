from svc.config import Store


def test_store():
    Store().add("a", qty=2)
    assert Store() is not None
