import type { Rule } from "../types.js";
import { checksDisabled } from "./checks-disabled.js";
import { depsUndeclared } from "./deps-undeclared.js";
import { envMissingExample } from "./env-missing-example.js";

export const ALL_RULES: Rule[] = [checksDisabled, depsUndeclared, envMissingExample];
