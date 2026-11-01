import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const venv = path.join(
  root,
  ".venv",
  process.platform === "win32" ? "Scripts/python.exe" : "bin/python",
);
const python =
  process.env.SMARTBOARD_PYTHON || (existsSync(venv) ? venv : "python");
for (const [command, args, cwd] of [
  [
    python,
    ["-B", "-m", "pytest", "-q", "-p", "no:cacheprovider"],
    "services/api",
  ],
  [
    process.execPath,
    [
      "--experimental-strip-types",
      "--test",
      "tests/stream.test.mjs",
      "tests/transport.test.mjs",
      "tests/web-auth.test.mjs",
    ],
    "apps/web",
  ],
  [
    process.execPath,
    [path.join(root, "apps/web/node_modules/next/dist/bin/next"), "build"],
    "apps/web",
  ],
]) {
  const result = spawnSync(command, args, {
    cwd: path.join(root, cwd),
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) console.error(result.error.message);
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
