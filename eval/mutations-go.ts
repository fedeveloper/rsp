// Labelled changes applied to eval/project-go, a small inventory service in
// Go. Same conventions as eval/mutations.ts.
import { benign, CD, DEP, ENV, LOCK, type Mutation, replace, risky } from "./mutations.js";

export const MUTATIONS_GO: Mutation[] = [
  risky("t-skip", [CD], "Skip a failing test with t.Skip", (f) =>
    replace(f, "inventory/store_test.go", "func TestRemoveRejectsTooMany(t *testing.T) {\n", 'func TestRemoveRejectsTooMany(t *testing.T) {\n\tt.Skip("flaky")\n')),
  risky("nolint", [CD], "Silence a linter with //nolint", (f) =>
    replace(f, "inventory/prices.go", "\tdefer res.Body.Close()\n", "\tdefer res.Body.Close() //nolint:errcheck\n")),
  risky("nosec", [CD], "Silence gosec with #nosec", (f) =>
    replace(f, "inventory/prices.go", "\tres, err := client.Get(", "\tres, err := client.Get( // #nosec G107\n\t\t")),
  risky("lint-ignore", [CD], "Silence staticcheck with lint:ignore", (f) =>
    replace(f, "inventory/store.go", "// NewStore returns an empty store.\n", "// NewStore returns an empty store.\n//lint:ignore U1000 kept for later\n")),
  risky("test-file-deleted", [CD], "Delete the store tests", (f) => {
    f.delete("inventory/store_test.go");
  }),
  risky("ci-lint-removed", [CD], "Remove golangci-lint from CI", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: golangci-lint run\n", "")),
  risky("ci-test-or-true", [CD], "Let the test step pass whatever happens", (f) =>
    replace(f, ".github/workflows/ci.yml", "      - run: go test -race ./...\n", "      - run: go test -race ./... || true\n")),
  risky("import-undeclared", [DEP], "Import a module that go.mod does not require", (f) => {
    replace(f, "inventory/store.go", '\t"sync"\n)', '\t"sync"\n\n\t"github.com/google/uuid"\n)');
    replace(f, "inventory/store.go", "\t\titem = &Item{SKU: sku, Name: name}", "\t\t_ = uuid.New()\n\t\titem = &Item{SKU: sku, Name: name}");
  }),
  risky("require-without-sum", [LOCK], "Require a module in go.mod by hand, without go.sum, and import it", (f) => {
    replace(f, "go.mod", "\tgithub.com/go-chi/chi/v5 v5.1.0\n", "\tgithub.com/go-chi/chi/v5 v5.1.0\n\tgithub.com/google/uuid v1.6.0\n");
    replace(f, "cmd/inventory/main.go", '\t"github.com/go-chi/chi/v5"\n', '\t"github.com/go-chi/chi/v5"\n\t"github.com/google/uuid"\n');
    replace(f, "cmd/inventory/main.go", "\tstore := inventory.NewStore()\n", "\tstore := inventory.NewStore()\n\tlog.Println(uuid.New())\n");
  }),
  risky("env-undocumented", [ENV], "Read a new environment variable missing from .env.example", (f) =>
    replace(f, "inventory/prices.go", '\tbase := os.Getenv("PRICE_API_URL")\n', '\tbase := os.Getenv("PRICE_API_URL")\n\tclient.Timeout = parse(os.Getenv("PRICE_API_TIMEOUT"))\n')),
  benign("require-with-sum", "Add a module with go get: go.mod, go.sum and the import", (f) => {
    replace(f, "go.mod", "\tgithub.com/go-chi/chi/v5 v5.1.0\n", "\tgithub.com/go-chi/chi/v5 v5.1.0\n\tgithub.com/google/uuid v1.6.0\n");
    f.set("go.sum", `github.com/google/uuid v1.6.0 h1:NIvaJDMOsjHA8n1jAhLSgzrAzy1Hgr+hNrb57e+94F0=\ngithub.com/google/uuid v1.6.0/go.mod h1:TIyPZe4MgqvfeYDBFedMoGGpEw/LqOeaOT+nhxU+yHo=\n${f.get("go.sum")}`);
    replace(f, "inventory/store.go", '\t"sync"\n)', '\t"sync"\n\n\t"github.com/google/uuid"\n)');
  }),
  benign("bump-with-sum", "Bump chi in go.mod and go.sum, as Dependabot does", (f) => {
    replace(f, "go.mod", "github.com/go-chi/chi/v5 v5.1.0", "github.com/go-chi/chi/v5 v5.2.0");
    replace(f, "go.sum", "github.com/go-chi/chi/v5 v5.1.0 h1:", "github.com/go-chi/chi/v5 v5.2.0 h1:");
    replace(f, "go.sum", "github.com/go-chi/chi/v5 v5.1.0/go.mod", "github.com/go-chi/chi/v5 v5.2.0/go.mod");
  }),
  benign("stdlib-and-subpackage", "Import from the standard library, the module itself and a subpackage of a required module", (f) => {
    replace(f, "cmd/inventory/main.go", '\t"github.com/go-chi/chi/v5"\n', '\t"github.com/go-chi/chi/v5"\n\t"github.com/go-chi/chi/v5/middleware"\n');
    replace(f, "cmd/inventory/main.go", "\tr := chi.NewRouter()\n", "\tr := chi.NewRouter()\n\tr.Use(middleware.Logger)\n");
    replace(f, "inventory/prices.go", '\t"os"\n', '\t"os"\n\t"strings"\n');
  }),
  benign("env-documented", "Read a variable that .env.example documents", (f) =>
    replace(f, "cmd/inventory/main.go", '\tstore := inventory.NewStore()\n', '\tstore := inventory.NewStore()\n\t_ = os.Getenv("PRICE_API_URL")\n')),
  benign("skip-in-string", "Mention t.Skip and nolint inside strings", (f) =>
    replace(f, "inventory/store.go", "var ErrUnknownSKU = errors.New(\"unknown sku\")", "var ErrUnknownSKU = errors.New(\"unknown sku (t.Skip //nolint)\")")),
  benign("test-added", "Add a test with more assertions", (f) =>
    f.set("inventory/get_test.go", 'package inventory\n\nimport (\n\t"testing"\n\n\t"github.com/stretchr/testify/assert"\n)\n\nfunc TestGet(t *testing.T) {\n\ts := NewStore()\n\ts.Add("fig", "Fig", 1)\n\titem, ok := s.Get("fig")\n\tassert.True(t, ok)\n\tassert.Equal(t, 1, item.Quantity)\n}\n')),
];
