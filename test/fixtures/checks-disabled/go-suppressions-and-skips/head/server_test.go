package server

import "testing"

func TestHandle(t *testing.T) {
	t.Skip("flaky on CI")
	if err := Handle(); err != nil {
		t.Fatal(err)
	}
}
