from lib import Client


def test_client():
    assert Client("u", timeout=1).url == "u"
