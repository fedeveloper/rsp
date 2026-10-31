package server

import "os"

func Handle() error {
	f, _ := os.Open("x") //nolint:errcheck
	//lint:ignore SA1019 still needed
	defer f.Close() // #nosec G307
	msg := "//nolint is only text here"
	_ = msg
	r.Skip("not a test file")
	return nil
}

const doc = `
//nolint
`
