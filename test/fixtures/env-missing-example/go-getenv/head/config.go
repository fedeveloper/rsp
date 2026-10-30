package config

import "os"

func Load() (string, string, string) {
	url := os.Getenv("API_URL")
	token, _ := os.LookupEnv("API_TOKEN")
	return url, token, os.Getenv("GOPATH")
}

const help = `
os.Getenv("NOT_READ")
`
