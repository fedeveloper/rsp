from dataclasses import dataclass, field
from typing import ClassVar

from pydantic import BaseModel


@dataclass(frozen=True)
class Settings:
    url: str
    timeout: int = 30  # seconds
    retries: int = 3
    VERSION: ClassVar[int] = 2


class Order(BaseModel):
    id: int
    total: float
    note: str = ""


class Item(BaseModel):
    quantity: int = 0
    sku: str


@dataclass
class Explicit:
    a: int
    b: int = 0

    def __init__(self, a: int):
        self.a = a
