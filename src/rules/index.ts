import type { Rule } from "../types.js";
import { checksDisabled } from "./checks-disabled.js";
import { depsLockfile } from "./deps-lockfile.js";
import { depsUndeclared } from "./deps-undeclared.js";
import { envMissingExample } from "./env-missing-example.js";
import { interfaceRemoved } from "./interface-removed.js";
import { interfaceRoutes } from "./interface-routes.js";
import { interfaceUntested } from "./interface-untested.js";
import { testsDelta } from "./tests-delta.js";

export const ALL_RULES: Rule[] = [checksDisabled, depsLockfile, depsUndeclared, envMissingExample, interfaceRemoved, interfaceRoutes, interfaceUntested, testsDelta];
