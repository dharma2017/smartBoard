import { spawn } from "node:child_process";
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
const next = path.join(root, "apps/web/node_modules/next/dist/bin/next");
if (!existsSync(next)) {
  console.error(
    "Install frontend dependencies first: npm --prefix apps/web install",
  );
  process.exit(1);
}
const children = [];
let stopping = false;
function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  for (const child of children) child.kill();
  process.exitCode = code;
}
function launch(command, args, cwd) {
  const child = spawn(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
  });
  children.push(child);
  child.on("error", (error) => {
    console.error(error.message);
    stop(1);
  });
  child.on("exit", (code) => {
    if (!stopping) stop(code || 0);
  });
}
launch(
  python,
  [
    "-m",
    "uvicorn",
    "smartboard.main:app",
    "--host",
    "127.0.0.1",
    "--port",
    "8000",
  ],
  path.join(root, "services/api"),
);
launch(
  process.execPath,
  [next, "dev", "--hostname", "127.0.0.1", "--port", "3000"],
  path.join(root, "apps/web"),
);
process.on("SIGINT", () => stop());
process.on("SIGTERM", () => stop());
console.log(
  "\nSmartboard: http://127.0.0.1:3000\nAPI docs: http://127.0.0.1:8000/docs\nCtrl+C stops both services.\n",
);
