#!/usr/bin/env bun
// Installs or updates the Claude Code template (vendored ECC + RTK) in a target repo.
// Files it manages are recorded in .claude/dotclaude.lock.json so later runs can update
// them, remove ones dropped upstream, and leave anything edited locally untouched.
import { chmod, mkdir, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = import.meta.dir;
const TEMPLATE_DIR = join(ROOT, "template");
const VENDOR_DIR = join(ROOT, "vendor/ecc");
const LOCK_FILE = ".claude/dotclaude.lock.json";
const SETTINGS_FILE = ".claude/settings.json";
const CLAUDE_MD = "CLAUDE.md";
const RTK_IMPORT = "@.claude/RTK.md";

const USAGE = `Usage: dotclaude [target-dir] [options]

Options:
  --force     Overwrite managed files even if they were edited locally
  --dry-run   Show what would change without writing
  -h, --help  Show this help`;

type Json = Record<string, unknown>;
type HookGroup = { hooks: { command: string }[] };
type Hooks = Record<string, HookGroup[]>;
type Lock = { template: string; ecc: string; files: Record<string, string>; hooks: string[] };
type Source = { path: string; mode: number };

const { values, positionals } = parseArgs({
  args: Bun.argv.slice(2),
  allowPositionals: true,
  options: {
    force: { type: "boolean", default: false },
    "dry-run": { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
});

if (values.help) {
  console.log(USAGE);
  process.exit(0);
}

const target = resolve(positionals[0] ?? process.cwd());
const dryRun = values["dry-run"];
if (!existsSync(target)) {
  console.error(`Target directory not found: ${target}`);
  process.exit(1);
}

const readJson = async <T>(path: string, fallback: T): Promise<T> =>
  existsSync(path) ? JSON.parse(await readFile(path, "utf8")) : fallback;

function sha256(content: Uint8Array): string {
  return new Bun.CryptoHasher("sha256").update(content).digest("hex");
}

function log(action: string, rel: string) {
  console.log(`  ${action.padEnd(9)} ${rel}`);
}

async function walk(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true, recursive: true });
  return entries.filter((entry) => entry.isFile()).map((entry) => relative(dir, join(entry.parentPath, entry.name)));
}

// Every file the template owns in the target, keyed by its path relative to the target root.
async function managedSources(): Promise<Map<string, Source>> {
  const sources = new Map<string, Source>();
  for (const [base, prefix] of [[join(VENDOR_DIR, ".claude"), ".claude"], [TEMPLATE_DIR, ""]] as const) {
    for (const rel of await walk(base)) {
      const dest = join(prefix, rel);
      if (dest === SETTINGS_FILE || dest === CLAUDE_MD) continue;
      sources.set(dest, { path: join(base, rel), mode: (await stat(join(base, rel))).mode & 0o777 });
    }
  }
  return sources;
}

async function writeTarget(rel: string, content: string | Uint8Array, mode?: number) {
  if (dryRun) return;
  const path = join(target, rel);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  if (mode) await chmod(path, mode);
}

async function removeWithEmptyParents(path: string) {
  await rm(path);
  for (let dir = dirname(path); dir.startsWith(join(target, ".claude") + "/"); dir = dirname(dir)) {
    if ((await readdir(dir)).length) break;
    await rm(dir, { recursive: true });
  }
}

async function syncFiles(lock: Lock): Promise<Record<string, string>> {
  const recorded: Record<string, string> = {};
  const counts = { create: 0, update: 0, unchanged: 0, remove: 0 };
  const sources = await managedSources();

  for (const [rel, source] of sources) {
    const content = await readFile(source.path);
    const hash = sha256(content);
    const dest = join(target, rel);
    if (!existsSync(dest)) {
      counts.create++;
      await writeTarget(rel, content, source.mode);
      recorded[rel] = hash;
      continue;
    }
    const current = sha256(await readFile(dest));
    if (current === hash) {
      counts.unchanged++;
      recorded[rel] = hash;
    } else if (current === lock.files[rel] || values.force) {
      counts.update++;
      await writeTarget(rel, content, source.mode);
      recorded[rel] = hash;
    } else {
      log("keep", `${rel} (edited locally; --force to overwrite)`);
      if (lock.files[rel]) recorded[rel] = lock.files[rel];
    }
  }

  for (const [rel, hash] of Object.entries(lock.files)) {
    if (sources.has(rel)) continue;
    const dest = join(target, rel);
    if (!existsSync(dest)) continue;
    if (sha256(await readFile(dest)) === hash || values.force) {
      counts.remove++;
      if (!dryRun) await removeWithEmptyParents(dest);
    } else {
      log("keep", `${rel} (removed upstream but edited locally)`);
    }
  }

  console.log(`  files     ${counts.create} created, ${counts.update} updated, ${counts.remove} removed, ${counts.unchanged} unchanged`);
  return recorded;
}

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// Existing values win; the template only fills in what is missing.
function fillMissing(base: Json, incoming: Json): Json {
  const result: Json = { ...base };
  for (const [key, value] of Object.entries(incoming)) {
    if (isObject(result[key]) && isObject(value)) result[key] = fillMissing(result[key] as Json, value);
    else if (result[key] === undefined) result[key] = value;
  }
  return result;
}

const commandsOf = (hooks: Hooks) => Object.values(hooks).flat().flatMap((group) => group.hooks.map((hook) => hook.command));

// Hook groups installed by a previous run are replaced wholesale; groups the repo added itself stay.
function replaceManagedHooks(existing: Hooks, desired: Hooks, previous: Set<string>): Hooks {
  const result: Hooks = {};
  for (const [event, groups] of Object.entries(existing)) {
    const kept = groups.filter((group) => !group.hooks.every((hook) => previous.has(hook.command)));
    if (kept.length) result[event] = kept;
  }
  const present = new Set(commandsOf(result));
  for (const [event, groups] of Object.entries(desired)) {
    const added = groups.filter((group) => !group.hooks.every((hook) => present.has(hook.command)));
    result[event] = [...(result[event] ?? []), ...added];
  }
  return result;
}

// The vendored copy replaces the ECC plugin, so drop the plugin switch to avoid running hooks twice.
function dropEccPlugin(settings: Json): boolean {
  let changed = false;
  for (const [key, entry] of [["enabledPlugins", "ecc@ecc"], ["extraKnownMarketplaces", "ecc"]] as const) {
    const section = settings[key] as Json | undefined;
    if (!section || !(entry in section)) continue;
    delete section[entry];
    if (!Object.keys(section).length) delete settings[key];
    changed = true;
  }
  return changed;
}

async function dropEccPluginFromLocalSettings() {
  const rel = ".claude/settings.local.json";
  const path = join(target, rel);
  if (!existsSync(path)) return;
  const settings = await readJson<Json>(path, {});
  if (!dropEccPlugin(settings)) return;
  log("update", `${rel} (removed ECC plugin switch)`);
  await writeTarget(rel, JSON.stringify(settings, null, 2) + "\n");
}

async function syncSettings(lock: Lock, hookProfile: string): Promise<string[]> {
  const template = await readJson<Json & { hooks: Hooks }>(join(TEMPLATE_DIR, SETTINGS_FILE), { hooks: {} });
  const eccHooks = await readJson<Hooks>(join(VENDOR_DIR, "hooks.json"), {});
  const desiredHooks = replaceManagedHooks(template.hooks, eccHooks, new Set());
  const path = join(target, SETTINGS_FILE);
  const existing = await readJson<Json>(path, {});
  dropEccPlugin(existing);
  await dropEccPluginFromLocalSettings();

  const { hooks: _, ...templateRest } = template;
  const merged = fillMissing(existing, { ...templateRest, env: { ECC_HOOK_PROFILE: hookProfile } });
  merged.hooks = replaceManagedHooks((existing.hooks as Hooks) ?? {}, desiredHooks, new Set(lock.hooks));

  const content = JSON.stringify(merged, null, 2) + "\n";
  const current = existsSync(path) ? await readFile(path, "utf8") : undefined;
  log(current === undefined ? "create" : current === content ? "unchanged" : "update", SETTINGS_FILE);
  if (current !== content) await writeTarget(SETTINGS_FILE, content);
  return commandsOf(desiredHooks);
}

async function syncClaudeMd() {
  const path = join(target, CLAUDE_MD);
  const existing = existsSync(path) ? await readFile(path, "utf8") : "";
  if (existing.split("\n").some((line) => line.trim() === RTK_IMPORT)) {
    log("unchanged", CLAUDE_MD);
    return;
  }
  log(existing ? "update" : "create", CLAUDE_MD);
  await writeTarget(CLAUDE_MD, existing ? `${RTK_IMPORT}\n\n${existing}` : await readFile(join(TEMPLATE_DIR, CLAUDE_MD), "utf8"));
}

const pkg = await readJson<{ version: string }>(join(ROOT, "package.json"), { version: "0.0.0" });
const config = await readJson<{ ecc: { version: string; hookProfile: string } }>(join(ROOT, "dotclaude.config.json"), {
  ecc: { version: "unknown", hookProfile: "standard" },
});
const lock = await readJson<Lock>(join(target, LOCK_FILE), { template: "", ecc: "", files: {}, hooks: [] });

console.log(`dotclaude ${pkg.version} (ECC ${config.ecc.version}) -> ${target}${dryRun ? " (dry run)" : ""}`);
if (lock.template) console.log(`  previous  dotclaude ${lock.template} (ECC ${lock.ecc})`);

const files = await syncFiles(lock);
const hooks = await syncSettings(lock, config.ecc.hookProfile);
await syncClaudeMd();
const nextLock: Lock = { template: pkg.version, ecc: config.ecc.version, files, hooks };
await writeTarget(LOCK_FILE, JSON.stringify(nextLock, null, 2) + "\n");

if (!Bun.which("rtk")) console.warn("\nrtk is not on PATH: Bash commands run unfiltered until it is installed (https://github.com/rtk-ai/rtk).");
if (!Bun.which("node")) console.warn("\nnode is not on PATH: ECC hooks need Node.js to run.");
console.log("\nDone. Restart Claude Code in the target repo to load the changes.");
