def load(path, strict=False):
    return open(path).read()


def save(data: "Mapping[str, int]") -> None:
    pass


class Store:
    def add(self, sku, qty=1):
        pass
