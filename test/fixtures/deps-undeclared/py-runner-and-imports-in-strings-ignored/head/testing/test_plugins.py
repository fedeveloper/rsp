import pytest
from _pytest.monkeypatch import MonkeyPatch


def test_ok(pytester):
    pytester.makepyfile(
        """
        from pmxbot import logging
        import fancylib
        """
    )
    assert True
