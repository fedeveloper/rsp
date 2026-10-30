from typing import List, Optional


def load(path: str) -> dict:
    return {}


def names(path: str) -> List[str]:
    return []


def find(key: str) -> Optional[int]:
    return None


def untyped(path):
    return path


def count(items: list) -> int:
    return len(items)


import typing as t


@t.overload
def pick(value: int) -> int: ...


@t.overload
def pick(value: str) -> str: ...


def pick(value: t.Any) -> t.Any:
    return value
