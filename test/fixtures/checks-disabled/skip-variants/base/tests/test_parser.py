import unittest

import pytest

from app.parser import parse


class ParserTest(unittest.TestCase):
    def test_empty(self):
        self.assertEqual(parse(""), [])


def test_numbers():
    assert parse("1 2") == [1, 2]


def test_unicode():
    assert parse("é") == ["é"]
