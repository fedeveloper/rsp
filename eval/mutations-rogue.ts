// Labelled changes applied to a second real application: rogue, a terminal
// roguelike in plain Python by the maintainer, at a pinned commit. It has no
// dependency manifest, no example env file, no tests and no CI, so most rules
// must stay silent until a change introduces the convention they check.
import { benign, CD, DEP, ENV, IF, type Mutation, replace, risky } from "./mutations.js";

export const ROGUE_REPO = "https://github.com/fedeveloper/rogue";
export const ROGUE_COMMIT = "3dd88145e96aa0263b10d67332e59b9b54d8ccbe";

const TEST_ENTITIES = (body: string) => `import pytest\n\nfrom entities import Player, generate_potion\n\n\n${body}`;

const POTION_TEST =
  "def test_potion_heals_more_at_higher_levels():\n    assert generate_potion(5).heal_amount > generate_potion(1).heal_amount\n";

export const ROGUE_MUTATIONS: Mutation[] = [
  risky("type-ignore", [CD], "Silence a type error in the potion generator", (f) =>
    replace(f, "entities.py", "    cat = c_data.get(\"category\", \"heal\")\n", "    cat = c_data.get(\"category\", \"heal\")  # type: ignore[assignment]\n")),
  risky("noqa", [CD], "Import a module only for its side effects, silencing the linter", (f) =>
    replace(f, "roguelike.py", "import traceback\n", "import traceback\nimport readline  # noqa: F401\n")),
  risky("skipped-test", [CD], "Add a first test suite with one test skipped", (f) =>
    f.set("tests/test_entities.py", TEST_ENTITIES(`${POTION_TEST}\n\n@pytest.mark.skip(reason="needs a profile.json")\ndef test_player_starts_alive():\n    assert Player("warrior", "none", []).hp > 0\n`))),
  risky("undeclared-beside-requirements", [DEP], "Add requirements.txt for colorama, then import rich without declaring it", (f) => {
    f.set("requirements.txt", "colorama>=0.4\n");
    replace(f, "ui.py", "import time\n", "import time\n\nimport colorama\nfrom rich.console import Console\n");
  }),
  risky("env-beside-example", [ENV], "Add .env.example for ROGUE_SEED, then read ROGUE_DEBUG too", (f) => {
    f.set(".env.example", "ROGUE_SEED=\n");
    replace(f, "roguelike.py", "def main():\n", "SEED = os.getenv(\"ROGUE_SEED\")\nDEBUG = os.getenv(\"ROGUE_DEBUG\") == \"1\"\n\n\ndef main():\n");
    replace(f, "roguelike.py", "import random\n", "import os\nimport random\n");
  }),
  risky("param-beside-new-tests", [IF], "Add a test suite for potions and change the parameters of generate_weapon", (f) => {
    f.set("tests/test_entities.py", TEST_ENTITIES(POTION_TEST));
    replace(f, "entities.py", "def generate_weapon(level: int, is_epic: bool = False) -> Weapon:", "def generate_weapon(level: int, is_epic: bool = False, element: str | None = None) -> Weapon:");
  }),

  benign("third-party-without-manifest", "Import colorama in a project that declares no dependencies", (f) =>
    replace(f, "ui.py", "import time\n", "import time\n\nimport colorama\n")),
  benign("dependency-declared", "Add requirements.txt and import what it declares", (f) => {
    f.set("requirements.txt", "colorama>=0.4\n");
    replace(f, "ui.py", "import time\n", "import time\n\nimport colorama\n");
  }),
  benign("env-without-example", "Read ROGUE_SEED in a project with no example env file", (f) => {
    replace(f, "roguelike.py", "import random\n", "import os\nimport random\n");
    replace(f, "roguelike.py", "def main():\n", "if os.getenv(\"ROGUE_SEED\"):\n    random.seed(int(os.environ[\"ROGUE_SEED\"]))\n\n\ndef main():\n");
  }),
  benign("platform-import", "Import winsound only on Windows", (f) =>
    replace(f, "ui.py", "if os.name == 'nt': os.system('')\n", "if os.name == 'nt':\n    os.system('')\n    import winsound\n")),
  benign("param-without-tests", "Add a parameter to a public function in a project without tests", (f) =>
    replace(f, "entities.py", "def generate_weapon(level: int, is_epic: bool = False) -> Weapon:", "def generate_weapon(level: int, is_epic: bool = False, element: str | None = None) -> Weapon:")),
  benign("param-with-test", "Change generate_potion and add a test that calls it", (f) => {
    f.set("tests/test_entities.py", TEST_ENTITIES(POTION_TEST));
    replace(f, "entities.py", "def generate_potion(level: int) -> Consumable:", "def generate_potion(level: int, category: str | None = None) -> Consumable:");
  }),
  benign("test-suite-added", "Add a first test suite with assertions", (f) =>
    f.set("tests/test_entities.py", TEST_ENTITIES(POTION_TEST))),
  benign("function-moved", "Move display_msg from ui.py to a new module", (f) => {
    const ui = f.get("ui.py")!;
    const start = ui.indexOf("def display_msg");
    const end = ui.indexOf("def get_choice");
    f.set("messages.py", ui.slice(start, end).trimEnd() + "\n");
    f.set("ui.py", ui.slice(0, start) + ui.slice(end));
  }),
  benign("game-data-edited", "Rebalance weapons in the JSON data", (f) => {
    const weapons = JSON.parse(f.get("data/weapons.json")!);
    weapons.weapons[0].base_atk += 1;
    f.set("data/weapons.json", `${JSON.stringify(weapons, null, 2)}\n`);
  }),
  benign("docs-mention-suppressions", "Document coding conventions in the technical docs", (f) =>
    f.set("DOCUMENTAZIONE_TECNICA.md", `${f.get("DOCUMENTAZIONE_TECNICA.md")}\n\n## Convenzioni\n\nNon usare \`# type: ignore\` né \`@pytest.mark.skip\`; leggi la configurazione con \`os.getenv("ROGUE_SEED")\`.\n`)),
];
