module example.com/app

go 1.22

require (
	github.com/spf13/cobra v1.8.0
	golang.org/x/sync v0.7.0 // indirect
)

replace github.com/acme/fork => ../fork
