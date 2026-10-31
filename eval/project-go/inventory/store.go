// Package inventory keeps stock counts in memory.
package inventory

import (
	"errors"
	"fmt"
	"sync"
)

// ErrUnknownSKU is returned for a SKU the store has never seen.
var ErrUnknownSKU = errors.New("unknown sku")

// Item is one product and its quantity.
type Item struct {
	SKU      string
	Name     string
	Quantity int
}

// Store holds items by SKU.
type Store struct {
	mu    sync.Mutex
	items map[string]*Item
}

// NewStore returns an empty store.
func NewStore() *Store {
	return &Store{items: map[string]*Item{}}
}

// Add puts quantity units of a SKU in the store.
func (s *Store) Add(sku, name string, quantity int) *Item {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[sku]
	if !ok {
		item = &Item{SKU: sku, Name: name}
		s.items[sku] = item
	}
	item.Quantity += quantity
	return item
}

// Remove takes quantity units of a SKU out of the store.
func (s *Store) Remove(sku string, quantity int) (*Item, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[sku]
	if !ok {
		return nil, ErrUnknownSKU
	}
	if quantity > item.Quantity {
		return nil, fmt.Errorf("only %d of %s left", item.Quantity, sku)
	}
	item.Quantity -= quantity
	return item, nil
}

// Get returns the item for a SKU, if any.
func (s *Store) Get(sku string) (*Item, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	item, ok := s.items[sku]
	return item, ok
}
