// Gives focus back to whatever app was in use whenever the browser under test
// takes it (scripts/lib/focus_keeper.swift). Returns a stop function, or null
// where swiftc is missing.
import { spawn, execFile } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const SOURCE = new URL("./focus_keeper.swift", import.meta.url).pathname;

export async function keepFocus(bundles) {
  const exe = join(tmpdir(), "merlin-focus-keeper");
  const built = await run("swiftc", ["-O", SOURCE, "-o", exe]).then(() => true, () => false);
  if (!built) return null;
  const child = spawn(exe, bundles, { stdio: ["pipe", "pipe", "ignore"] });
  await new Promise((resolve, reject) => {
    child.stdout.once("data", resolve);
    child.once("error", reject);
    child.once("exit", () => reject(Error("focus keeper exited")));
  });
  child.unref();
  return () => {
    child.stdin.end();
    child.kill();
  };
}
