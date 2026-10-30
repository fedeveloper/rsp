package inventory

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAddAccumulates(t *testing.T) {
	s := NewStore()
	s.Add("apple", "Apple", 2)
	item := s.Add("apple", "Apple", 3)
	assert.Equal(t, 5, item.Quantity)
}

func TestRemoveRejectsTooMany(t *testing.T) {
	s := NewStore()
	s.Add("pear", "Pear", 1)
	_, err := s.Remove("pear", 2)
	require.Error(t, err)
}

func TestRemoveUnknown(t *testing.T) {
	s := NewStore()
	_, err := s.Remove("kiwi", 1)
	assert.ErrorIs(t, err, ErrUnknownSKU)
}
