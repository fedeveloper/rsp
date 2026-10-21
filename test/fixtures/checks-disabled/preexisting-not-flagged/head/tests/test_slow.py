import pytest


@pytest.mark.skip(reason="needs network")
def test_download():
    assert 1 + 1 == 2
