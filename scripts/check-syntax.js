"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const ROOT_DIR = path.resolve(__dirname, "..");
const CHECK_DIRS = [".codex", "bin", "desktop", "design", "public", "scripts", "server", "test"];
const CHECK_EXTENSIONS = new Set([".js", ".cjs"]);
const SKIP_DIRS = new Set([".git", ".second", "node_modules", "coverage", "dist", "build", "out"]);

function walk(dir, files = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") && SKIP_DIRS.has(entry.name)) continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) walk(fullPath, files);
      continue;
    }
    if (entry.isFile() && CHECK_EXTENSIONS.has(path.extname(entry.name))) {
      files.push(fullPath);
    }
  }
  return files;
}

function checkFile(file) {
  const relative = path.relative(ROOT_DIR, file);
  const result = spawnSync(process.execPath, ["--check", file], {
    cwd: ROOT_DIR,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.stderr.write(`Syntax check failed: ${relative}\n`);
    return false;
  }
  return true;
}

const files = CHECK_DIRS.flatMap((dir) => {
  const fullPath = path.join(ROOT_DIR, dir);
  return fs.existsSync(fullPath) ? walk(fullPath) : [];
}).sort();

let ok = true;
for (const file of files) {
  ok = checkFile(file) && ok;
}

if (!ok) process.exit(1);
process.stdout.write(`Syntax check passed: ${files.length} files\n`);
