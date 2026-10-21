from typing import overload


@overload
def conv(ty: None = None) -> int: ...
@overload
def conv(ty: str) -> str: ...
def conv(ty=None):
    return ty


class Client:
    def __init__(self, url):
        self.url = url
