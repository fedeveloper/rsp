package inventory

import (
	"encoding/json"
	"fmt"
	"net/http"
	"os"
)

// FetchPrice asks the price service for the price of a SKU.
func FetchPrice(client *http.Client, sku string) (float64, error) {
	base := os.Getenv("PRICE_API_URL")
	res, err := client.Get(fmt.Sprintf("%s/prices/%s", base, sku))
	if err != nil {
		return 0, err
	}
	defer res.Body.Close()
	var body struct {
		Price float64 `json:"price"`
	}
	if err := json.NewDecoder(res.Body).Decode(&body); err != nil {
		return 0, err
	}
	return body.Price, nil
}
