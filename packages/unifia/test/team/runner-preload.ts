// TEAM-G01 runner preload: stub for opencode test/preload.ts.
// The parent bunfig.toml at packages/unifia/bunfig.toml forces loading of
// packages/unifia/test/preload.ts which transitively imports the opencode
// runtime stack (xdg-basedir, drizzle-orm, zod, etc.). For TEAM-G01's isolated
// lock-manager tests we substitute a no-op preloader.

const dbOverride = process.env["OPENCODE_DB"];
if (!dbOverride) process.env["OPENCODE_DB"] = ":memory:";
process.env["OPENCODE_DISABLE_LSP_WARMUP"] = "true";
process.env["OPENCODE_DISABLE_DEFAULT_PLUGINS"] = "true";
process.env["XDG_DATA_HOME"] = (process.env["XDG_DATA_HOME"] || process.env["TEMP"] || "/tmp") + "/team-g01";
process.env["XDG_CACHE_HOME"] = (process.env["XDG_CACHE_HOME"] || process.env["TEMP"] || "/tmp") + "/team-g01";
process.env["XDG_CONFIG_HOME"] = (process.env["XDG_CONFIG_HOME"] || process.env["TEMP"] || "/tmp") + "/team-g01";
process.env["XDG_STATE_HOME"] = (process.env["XDG_STATE_HOME"] || process.env["TEMP"] || "/tmp") + "/team-g01";
