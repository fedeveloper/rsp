import requests

from inventory.config import load_settings


def fetch_prices(skus: list[str]) -> dict[str, float]:
    settings = load_settings()
    response = requests.get(
        "https://prices.example.com/v1/prices",
        params={"sku": ",".join(skus)},
        headers={"Authorization": f"Bearer {settings.api_key}"},
        timeout=10,
    )
    response.raise_for_status()
    return {row["sku"]: float(row["price"]) for row in response.json()}
