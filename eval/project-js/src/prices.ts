const BASE_URL = process.env.PRICE_API_URL ?? "https://prices.example.invalid";

export async function fetchPrice(sku: string, currency = "EUR"): Promise<number> {
  const res = await fetch(`${BASE_URL}/prices/${encodeURIComponent(sku)}?currency=${currency}`);
  if (!res.ok) throw new Error(`price lookup failed: ${res.status}`);
  const body = (await res.json()) as { price: number };
  return body.price;
}
