def total(
    items: list[float],
    tax: float = 0.2,
) -> float:
    return sum(items) * (1 + tax)
