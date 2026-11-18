import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const readJson = (file) => JSON.parse(readFileSync(join(root, file), "utf8"));
const { version, releaseDate, name } = readJson("package.json");
const [entry] = readJson("resources/changelog.json");
const target = "x86_64-pc-windows-msvc";
const cargoDir = resolve(root, "src-tauri/target");

if (process.platform !== "win32") throw new Error("请在 Windows 上构建安装包");
if (!/^\d+\.\d+\.\d+$/.test(version) || entry.tag_name !== `v${version}` ||
    entry.published_at !== releaseDate || !entry.body?.trim()) {
  throw new Error("请同步版本号、发布日期与首条更新记录");
}
const env = { ...process.env, CARGO_TARGET_DIR: cargoDir, RUSTUP_TOOLCHAIN: "stable-x86_64-pc-windows-msvc" };
const metadata = JSON.parse(execFileSync("cargo", ["metadata", "--format-version", "1", "--no-deps",
  "--locked", "--manifest-path", "src-tauri/Cargo.toml"], { cwd: root, env, encoding: "utf8" }));
if (metadata.packages.find((pkg) => pkg.name === name)?.version !== version) {
  throw new Error("Cargo.toml 与 package.json 版本不一致");
}
execFileSync(process.execPath, [join(root, "node_modules/@tauri-apps/cli/tauri.js"), "build",
  "--ci", "--target", target, "--bundles", "nsis", "--", "--locked"], { cwd: root, env, stdio: "inherit" });

const output = join(root, "release", version);
const setup = `EvpProxies.Setup.${version}.exe`;
const bundle = join(cargoDir, target, "release/bundle/nsis", `${name}_${version}_x64-setup.exe`);
const digest = createHash("sha256").update(readFileSync(bundle)).digest("hex");
mkdirSync(output, { recursive: true });
copyFileSync(bundle, join(output, setup));
writeFileSync(join(output, "SHA256SUMS.txt"), `${digest}  ${setup}\n`);
writeFileSync(join(output, "notes.md"), entry.body + "\n");
console.log(`已生成 ${output}/${setup}\nSHA-256  ${digest}`);
