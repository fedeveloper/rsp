package server

import "testing"

func TestHandle(t *testing.T) {
	if err := Handle(); err != nil {
		t.Fatal(err)
	}
}
