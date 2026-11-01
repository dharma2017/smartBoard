import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  copyFileSync,
  rmSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const generated = path.join(root, ".cache/android-web");
// Only this explicitly owned generated directory may be replaced.
if (
  !generated.startsWith(root + path.sep) ||
  path.basename(generated) !== "android-web"
)
  throw new Error("Invalid generated path");
mkdirSync(generated, { recursive: true });
for (const file of ["package.json", "tsconfig.json", "next-env.d.ts"])
  copyFileSync(path.join(root, "apps/web", file), path.join(generated, file));
const generatedSrc = path.join(generated, "src");
if (existsSync(generatedSrc)) rmSync(generatedSrc, { recursive: true });
cpSync(path.join(root, "apps/web/src"), generatedSrc, {
  recursive: true,
  filter: (source) => source !== path.join(root, "apps/web/src/app/api"),
});
writeFileSync(
  path.join(generated, "next.config.ts"),
  'import type { NextConfig } from "next";\nconst config:NextConfig={output:"export",poweredByHeader:false,turbopack:{root:' +
    JSON.stringify(root) +
    "}};\nexport default config;\n",
);
// Next's generated project resolves dependencies from the existing web installation.
const modules = path.join(generated, "node_modules");
if (!existsSync(modules)) {
  const { symlinkSync } = await import("node:fs");
  symlinkSync(
    path.join(root, "apps/web/node_modules"),
    modules,
    process.platform === "win32" ? "junction" : "dir",
  );
}
function run(command, args, cwd) {
  const result = spawnSync(command, args, {
    cwd,
    stdio: "inherit",
    windowsHide: true,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status || 1);
}
run(
  process.execPath,
  [path.join(root, "apps/web/node_modules/next/dist/bin/next"), "build"],
  generated,
);
const assets = path.join(root, "apps/android/app/src/main/assets");
// Replace only generated web assets, preserving the native connection page.
for (const entry of [
  "_next",
  "index.html",
  "index.txt",
  "404.html",
  "404",
  "_not-found",
]) {
  const target = path.join(assets, entry);
  if (existsSync(target)) rmSync(target, { recursive: true, force: true });
}
cpSync(path.join(generated, "out"), assets, { recursive: true });
const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (sdk)
  writeFileSync(
    path.join(root, "apps/android/local.properties"),
    "sdk.dir=" + sdk.replaceAll("\\", "/").replaceAll(":", "\\:") + "\n",
  );
const wrapper = path.join(
  root,
  "apps/android",
  process.platform === "win32" ? "gradlew.bat" : "gradlew",
);
if (!existsSync(wrapper))
  throw new Error(
    "Gradle wrapper is missing. Generate it with Gradle 8.13 first.",
  );
if (process.platform === "win32")
  run(
    process.env.ComSpec || "cmd.exe",
    ["/d", "/c", "gradlew.bat --no-daemon assembleDebug"],
    path.join(root, "apps/android"),
  );
else
  run(
    wrapper,
    ["--no-daemon", "assembleDebug"],
    path.join(root, "apps/android"),
  );
const output = path.join(root, "artifacts/android");
mkdirSync(output, { recursive: true });
const version = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
).version;
const apk = path.join(output, `Smartboard-${version}.apk`);
copyFileSync(
  path.join(root, "apps/android/app/build/outputs/apk/debug/app-debug.apk"),
  apk,
);
console.log("\nAPK ready: " + apk);
const venv = path.join(root,".venv",process.platform==="win32"?"Scripts/python.exe":"bin/python");
const python=process.env.SMARTBOARD_PYTHON||(existsSync(venv)?venv:"python");
run(python,[path.join(root,"scripts/verify-apk.py"),apk],root);
