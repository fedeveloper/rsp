from typing import List, Optional


def load(path: str) -> list:
    return []


def names(path: str) -> list[str]:
    return []


def find(key: str) -> int | None:
    return None


def untyped(path) -> str:
    return path


def count(items: list, start: int) -> float:
    return float(len(items) + start)


import typing as t


@t.overload
def pick(value: int) -> int: ...


@t.overload
def pick(value: str) -> str: ...


def pick(value: int | str) -> int | str:
    return value
