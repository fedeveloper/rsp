package main

import (
	"encoding/json"
	"log"
	"net/http"
	"os"

	"github.com/go-chi/chi/v5"

	"example.com/inventory/inventory"
)

func main() {
	store := inventory.NewStore()
	r := chi.NewRouter()
	r.Get("/items/{sku}", func(w http.ResponseWriter, req *http.Request) {
		item, ok := store.Get(chi.URLParam(req, "sku"))
		if !ok {
			http.NotFound(w, req)
			return
		}
		_ = json.NewEncoder(w).Encode(item)
	})
	log.Fatal(http.ListenAndServe(os.Getenv("INVENTORY_ADDR"), r))
}
