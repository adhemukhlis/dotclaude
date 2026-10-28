#!/usr/bin/env bun
// Vendors ECC (agents, commands, skills, rules, hooks and their scripts) into vendor/ecc
// at the version pinned in dotclaude.config.json, with hooks made portable across clones.
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseArgs } from "node:util";

const ROOT = join(import.meta.dir, "..");
const CONFIG_PATH = join(ROOT, "dotclaude.config.json");
const VENDOR_DIR = join(ROOT, "vendor/ecc");
const VENDORED_DIRS = ["agents", "commands", "skills", "rules", "scripts", "hooks", "mcp-configs"];

// ECC's project install bakes the absolute install root into each hook as a base64 literal.
// Resolving it from CLAUDE_PROJECT_DIR at runtime makes the hooks work in any clone.
const EMBEDDED_ROOT = /Buffer\.from\('[A-Za-z0-9+/=]+','base64'\)\.toString\('utf8'\)/g;
const PORTABLE_ROOT = "(process.env.CLAUDE_PROJECT_DIR?p.join(process.env.CLAUDE_PROJECT_DIR,'.claude'):'')";

type HookGroup = { id?: string; matcher?: string; hooks: { command: string }[] };
type Hooks = Record<string, HookGroup[]>;

const { values } = parseArgs({
  args: Bun.argv.slice(2),
  options: { version: { type: "string" }, profile: { type: "string" } },
});

const config = JSON.parse(await readFile(CONFIG_PATH, "utf8"));
const requested = values.version ?? config.ecc.version;
const profile = values.profile ?? config.ecc.profile;

function makePortable(hooks: Hooks): Hooks {
  for (const group of Object.values(hooks).flat()) {
    for (const hook of group.hooks) {
      const matches = hook.command.match(EMBEDDED_ROOT) ?? [];
      if (matches.length !== 1) {
        throw new Error(`Hook ${group.id ?? group.matcher} has ${matches.length} embedded roots; ECC changed its hook format`);
      }
      hook.command = hook.command.replace(EMBEDDED_ROOT, PORTABLE_ROOT);
    }
  }
  return hooks;
}

const work = await mkdtemp(join(tmpdir(), "dotclaude-ecc-"));
try {
  console.log(`Installing ecc-universal@${requested} (profile ${profile}) into a temp project`);
  const proc = Bun.spawn(
    ["bunx", `ecc-universal@${requested}`, "install", "--target", "claude-project", "--profile", profile, "--enable-hooks", "--json"],
    { cwd: work, stdout: "ignore", stderr: "inherit" },
  );
  if ((await proc.exited) !== 0) throw new Error("ECC install failed");

  const installed = join(work, ".claude");
  const state = JSON.parse(await readFile(join(installed, "ecc/install-state.json"), "utf8"));
  const version: string = state.source.repoVersion;
  const settings = JSON.parse(await readFile(join(installed, "settings.json"), "utf8"));

  await rm(VENDOR_DIR, { recursive: true, force: true });
  for (const dir of VENDORED_DIRS) {
    if (existsSync(join(installed, dir))) {
      await cp(join(installed, dir), join(VENDOR_DIR, ".claude", dir), { recursive: true });
    }
  }
  await writeFile(join(VENDOR_DIR, "hooks.json"), JSON.stringify(makePortable(settings.hooks), null, 2) + "\n");

  config.ecc.version = version;
  config.ecc.profile = profile;
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
  console.log(`Vendored ECC ${version} into vendor/ecc`);
} finally {
  await rm(work, { recursive: true, force: true });
}
