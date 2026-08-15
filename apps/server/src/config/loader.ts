import { existsSync, readFileSync } from "node:fs";
import { parse as parseYaml } from "yaml";
import { configFileSchema, DEFAULT_CONFIG, type ConfigFile } from "./schema.js";
import { readEnvOverlay, readRuntimeEnv, type EnvLeaf } from "./env.js";

export type ConfigSource = "env" | "file" | "database" | "default";

export interface EffectiveConfig {
  values: ConfigFile;
  /** Dot-path -> which source last set this leaf's value. */
  leafSources: Map<string, ConfigSource>;
  /** Dot-paths that are locked (env or mounted file) and must not be UI-editable. */
  lockedPaths: Set<string>;
  runtime: ReturnType<typeof readRuntimeEnv>;
}

function deepClone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function setPath(target: Record<string, unknown>, path: string, value: unknown): void {
  const parts = path.split(".");
  let cursor: Record<string, unknown> = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const key = parts[i] as string;
    if (!isPlainObject(cursor[key])) cursor[key] = {};
    cursor = cursor[key] as Record<string, unknown>;
  }
  cursor[parts[parts.length - 1] as string] = value;
}

/** Recursively applies an overlay object onto target, recording per-leaf source. Arrays and primitives are leaves. */
function applyOverlay(
  target: Record<string, unknown>,
  overlay: Record<string, unknown>,
  source: ConfigSource,
  sources: Map<string, ConfigSource>,
  prefix = "",
): void {
  for (const [key, value] of Object.entries(overlay)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (isPlainObject(value)) {
      if (!isPlainObject(target[key])) target[key] = {};
      applyOverlay(target[key] as Record<string, unknown>, value, source, sources, path);
    } else {
      target[key] = value;
      sources.set(path, source);
    }
  }
}

function applyLeaves(
  target: Record<string, unknown>,
  leaves: EnvLeaf[],
  source: ConfigSource,
  sources: Map<string, ConfigSource>,
  locked: Set<string>,
): void {
  for (const leaf of leaves) {
    setPath(target, leaf.path, leaf.value);
    sources.set(leaf.path, source);
    locked.add(leaf.path);
  }
}

export interface DatabaseSettingsRow {
  path: string;
  value: unknown;
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /** Rows previously saved through the dashboard (`settings` table). */
  databaseSettings?: DatabaseSettingsRow[];
}

export class ConfigLoadError extends Error {}

export function loadConfig(opts: LoadConfigOptions = {}): EffectiveConfig {
  const env = opts.env ?? process.env;
  const runtime = readRuntimeEnv(env);

  const merged: Record<string, unknown> = deepClone(DEFAULT_CONFIG) as unknown as Record<string, unknown>;
  const sources = new Map<string, ConfigSource>();
  const locked = new Set<string>();

  // 5. Built-in defaults are already the base object (no explicit source entries needed).

  // 4. Runtime settings saved through the dashboard.
  if (opts.databaseSettings) {
    for (const row of opts.databaseSettings) {
      setPath(merged, row.path, row.value);
      sources.set(row.path, "database");
    }
  }

  // 3. Mounted /config/config.yaml.
  if (runtime.configFile && existsSync(runtime.configFile)) {
    const raw = readFileSync(runtime.configFile, "utf-8");
    let parsed: unknown;
    try {
      parsed = parseYaml(raw);
    } catch (err) {
      throw new ConfigLoadError(`failed to parse mounted config YAML at ${runtime.configFile}: ${String(err)}`);
    }
    const result = configFileSchema.partial().safeParse(parsed);
    if (!result.success) {
      throw new ConfigLoadError(
        `mounted config file ${runtime.configFile} failed schema validation: ${result.error.message}`,
      );
    }
    applyOverlay(merged, result.data as Record<string, unknown>, "file", sources);
    // Every leaf touched by the file overlay is locked, whether object-nested or not.
    for (const path of sources.keys()) {
      if (sources.get(path) === "file") locked.add(path);
    }
  }

  // 2. Environment variables explicitly marked as locked.
  const envLeaves = readEnvOverlay(env);
  applyLeaves(merged, envLeaves, "env", sources, locked);

  const parsedFinal = configFileSchema.parse(merged);

  return {
    values: parsedFinal,
    leafSources: sources,
    lockedPaths: locked,
    runtime,
  };
}
