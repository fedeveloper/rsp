def total(items):
    return sum(items)


def refund(amount):
    if amount < 0:
        raise ValueError("negative")
    return -amount
