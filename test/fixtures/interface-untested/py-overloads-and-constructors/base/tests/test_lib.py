from lib import Client


def test_client():
    assert Client("u").url == "u"
