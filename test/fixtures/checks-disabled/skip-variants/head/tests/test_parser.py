import unittest

import pytest

from app.parser import parse


class ParserTest(unittest.TestCase):
    @unittest.skip("TODO")
    def test_empty(self):
        self.assertEqual(parse(""), [])


@pytest.mark.xfail
def test_numbers():
    assert parse("1 2") == [1, 2]


def test_unicode():
    pytest.skip("encoding issue")
    assert parse("é") == ["é"]
