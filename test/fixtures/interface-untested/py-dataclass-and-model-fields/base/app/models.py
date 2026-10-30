from dataclasses import dataclass, field
from typing import ClassVar

from pydantic import BaseModel


@dataclass(frozen=True)
class Settings:
    url: str
    timeout: int = 10
    VERSION: ClassVar[int] = 1


class Order(BaseModel):
    id: int
    total: float


class Item(BaseModel):
    sku: str
    quantity: int = 0


@dataclass
class Explicit:
    a: int

    def __init__(self, a: int):
        self.a = a
