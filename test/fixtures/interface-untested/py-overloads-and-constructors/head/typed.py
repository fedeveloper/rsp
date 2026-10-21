from typing import overload


@overload
def to_list(value: str) -> list[str]: ...
@overload
def to_list(value: bytes) -> list[int]: ...
def to_list(value):
    return list(value)
