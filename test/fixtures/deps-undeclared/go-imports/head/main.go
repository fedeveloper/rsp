package main

import (
	"fmt"
	"os"

	"example.com/app/internal/x"
	"github.com/acme/fork/pkg"
	"github.com/google/uuid"
	"github.com/spf13/cobra/doc"
	y "gopkg.in/yaml.v3"
)

const tmpl = `
import "github.com/not/real"
`

func main() {
	fmt.Println(uuid.New(), os.Args, tmpl, y.Marshal, doc.GenMan, pkg.P)
	x.X()
}
