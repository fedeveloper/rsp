import { runAction } from "./action.js";

runAction().then(
  (code) => {
    process.exitCode = code;
  },
  (err: unknown) => {
    process.stdout.write(`::error::rsp failed: ${err instanceof Error ? err.message : String(err)}\n`);
    process.exitCode = 1;
  },
);
