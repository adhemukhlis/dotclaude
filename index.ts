#!/usr/bin/env bun
// Installs the Claude Code template (ECC plugin + RTK output condensing) into a target repo.
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";

const TEMPLATE_DIR = join(import.meta.dir, "template");
const RTK_IMPORT = "@.claude/RTK.md";
const HOOK_PROFILES = ["off", "minimal", "standard", "strict"];

const USAGE = `Usage: dotclaude [target-dir] [options]

Options:
  --local            Write private config (settings.local.json, CLAUDE.local.md) instead of shared files
  --hooks <profile>  Also save your personal ECC hook profile: ${HOOK_PROFILES.join("|")}
  --dry-run          Show what would change without writing
  -h, --help         Show this help`;

type Json = Record<string, unknown>;
type HookGroup = { matcher?: string; hooks: { command: string }[] };

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    local: { type: "boolean", default: false },
    hooks: { type: "string" },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}
if (values.hooks && !HOOK_PROFILES.includes(values.hooks)) {
  console.error(`Unknown hook profile "${values.hooks}". Use one of: ${HOOK_PROFILES.join(", ")}`);
  process.exit(1);
}

const target = resolve(positionals[0] ?? process.cwd());
const dryRun = values["dry-run"];
const settingsFile = values.local ? "settings.local.json" : "settings.json";
const claudeMdFile = values.local ? "CLAUDE.local.md" : "CLAUDE.md";

if (!existsSync(target)) {
  console.error(`Target directory not found: ${target}`);
  process.exit(1);
}

async function write(path: string, content: string, mode?: number) {
  const rel = path.slice(target.length + 1);
  const current = existsSync(path) ? await readFile(path, "utf8") : undefined;
  if (current === content) {
    console.log(`  unchanged  ${rel}`);
    return;
  }
  console.log(`  ${current === undefined ? "create" : "update"}     ${rel}`);
  if (dryRun) return;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  if (mode) await chmod(path, mode);
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Hook groups are appended only when their command is not already registered.
function mergeHookGroups(existing: HookGroup[], incoming: HookGroup[]): HookGroup[] {
  const commands = new Set(existing.flatMap((group) => group.hooks.map((hook) => hook.command)));
  const added = incoming.filter((group) => !group.hooks.every((hook) => commands.has(hook.command)));
  return [...existing, ...added];
}

// Existing values always win; the template only fills in what is missing.
function merge(base: Json, incoming: Json, path: string[] = []): Json {
  const result: Json = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    const current = result[key];
    if (path.length === 1 && path[0] === "hooks" && Array.isArray(current) && Array.isArray(value)) {
      result[key] = mergeHookGroups(current as HookGroup[], value as HookGroup[]);
    } else if (isObject(current) && isObject(value)) {
      result[key] = merge(current, value, [...path, key]);
    } else if (current === undefined) {
      result[key] = value;
    }
  }
  return result;
}

async function installSettings() {
  const template = JSON.parse(await readFile(join(TEMPLATE_DIR, ".claude/settings.json"), "utf8"));
  const path = join(target, ".claude", settingsFile);
  const existing = existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : {};
  await write(path, JSON.stringify(merge(existing, template), null, 2) + "\n");
}

async function installManagedFiles() {
  for (const [file, mode] of [[".claude/RTK.md"], [".claude/hooks/rtk-rewrite.sh", 0o755]] as const) {
    await write(join(target, file), await readFile(join(TEMPLATE_DIR, file), "utf8"), mode);
  }
}

async function installClaudeMd() {
  const path = join(target, claudeMdFile);
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === RTK_IMPORT)) {
    console.log(`  unchanged  ${claudeMdFile}`);
    return;
  }
  await write(path, existing ? `${RTK_IMPORT}\n\n${existing}` : `${RTK_IMPORT}\n`);
}

async function saveHookProfile(profile: string) {
  const scope = values.local ? "local" : "project";
  const cmd = ["bunx", "ecc-universal@latest", "setup", "--mode", "claude-plugin", "--scope", scope, "--hooks", profile, "--yes"];
  console.log(`  run        ${cmd.join(" ")}`);
  if (dryRun) return;
  const proc = Bun.spawn(cmd, { cwd: target, stdout: "inherit", stderr: "inherit" });
  if ((await proc.exited) !== 0) throw new Error("ECC setup failed");
}

console.log(`Installing Claude template into ${target}${dryRun ? " (dry run)" : ""}`);
await installSettings();
await installManagedFiles();
await installClaudeMd();
if (values.hooks) await saveHookProfile(values.hooks);

if (!Bun.which("rtk")) {
  console.warn("\nrtk is not on PATH: Bash commands will run unfiltered until it is installed (https://github.com/rtk-ai/rtk).");
}
console.log("\nDone. Restart Claude Code or run /reload-plugins in the target repo.");
