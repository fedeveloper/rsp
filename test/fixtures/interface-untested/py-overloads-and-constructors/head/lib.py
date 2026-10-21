from typing import overload


@overload
def conv(ty: None = None) -> int: ...
@overload
def conv(ty: str) -> str: ...
def conv(ty=None, default=None):
    return ty or default


class Client:
    def __init__(self, url, timeout=5):
        self.url = url
