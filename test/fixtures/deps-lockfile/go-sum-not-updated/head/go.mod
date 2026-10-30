module example.com/svc

go 1.22

require (
	github.com/google/uuid v1.6.0
	github.com/spf13/cobra v1.8.1
	golang.org/x/text v0.15.0
	github.com/acme/local v0.0.0
)

replace github.com/acme/local => ./local
