// This smoke test installs updates and creates proxy rules on a disposable Windows runner.
const assert = require("node:assert/strict");
const { execFileSync, spawn } = require("node:child_process");
const { readdirSync } = require("node:fs");
const { createServer } = require("node:http");
const path = require("node:path");
const { setTimeout: delay } = require("node:timers/promises");
const { chromium } = require("playwright-core");
const { version } = require("../package.json");

const executable = path.join(process.env.LOCALAPPDATA, "evp-proxies", "evp-proxies.exe");
const endpoint = "http://127.0.0.1:19347";

async function waitFor(label, probe, timeout = 90000) {
  const end = Date.now() + timeout;
  let reason;
  while (Date.now() < end) {
    try {
      const result = await probe();
      if (result) return result;
    } catch (error) { reason = error.message; }
    await delay(600);
  }
  throw new Error(`等待${label}超时：${reason ?? ""}`);
}

function running() {
  const result = execFileSync("powershell", ["-NoProfile", "-Command",
    "Get-Process evp-proxies -ErrorAction SilentlyContinue | Select-Object Id,Path,@{n='Version';e={$_.MainModule.FileVersionInfo.ProductVersion}} | ConvertTo-Json -Compress; exit 0"],
    { encoding: "utf8", windowsHide: true }).trim();
  return result ? [JSON.parse(result)].flat().find(p => p.Path?.toLowerCase() === executable.toLowerCase()) : undefined;
}

async function attach() {
  return waitFor("应用窗口", async () => {
    if (!(await (await fetch(endpoint + "/json/list")).json()).some(tab => tab.url.includes("tauri.localhost"))) return;
    const connection = await chromium.connectOverCDP(endpoint, { timeout: 3000 });
    const page = connection.contexts().flatMap(context => context.pages()).find(p => p.url().includes("tauri.localhost"));
    if (page) return page;
    await connection.close();
  });
}

function invoke(page, cmd, args = {}) {
  return page.evaluate(([cmd, args]) => window.__TAURI_INTERNALS__.invoke(cmd, args), [cmd, args]);
}

async function closeWindow(page) {
  const closed = page.waitForEvent("close");
  await page.getByRole("button", { name: "更多" }).click();
  await page.getByRole("menuitem", { name: "关闭", exact: true }).click();
  await closed;
  await waitFor("进程退出", () => !running());
}

async function verifyRouting(rules, page) {
  assert.deepEqual(await invoke(page, "get_proxy_mappings"), rules);
  await page.getByText("1 条映射已启用").waitFor();
  const active = await fetch("http://127.0.0.1:9420/qa-active/ping");
  assert.equal(await active.text(), "/restored/ping");
  assert.equal((await fetch("http://127.0.0.1:9420/qa-off/ping")).status, 404);
}

async function main() {
  assert.equal(process.env.RUNNER_ENVIRONMENT, "github-hosted", "Use a disposable GitHub-hosted Windows runner");
  const old = spawn(executable, [], { stdio: "ignore" });
  let page = await attach();
  assert.equal("v" + await invoke(page, "plugin:app|version"), process.env.FROM_TAG);
  console.log(`已启动 ${process.env.FROM_TAG}，PID ${old.pid}`);
  // Exercise the startup update prompt and the real install button.
  const dialog = page.getByRole("dialog", { name: "发现新版本" });
  await dialog.getByText("v" + version, { exact: true }).waitFor({ timeout: 60000 });
  await dialog.getByRole("button", { name: "立即更新" }).click();
  const restarted = await waitFor("安装器自动重启新版本", () => {
    const current = running();
    return current && current.Id !== old.pid && current.Version === version && current;
  }, 180000);
  console.log(`安装器已自动启动 v${version}，PID ${restarted.Id}，路径 ${restarted.Path}`);
  page = await attach();
  assert.equal(await invoke(page, "plugin:app|version"), version);

  const target = createServer((req, res) => res.end(req.url));
  await new Promise(resolve => target.listen(0, "127.0.0.1", resolve));
  try {
    const address = `http://127.0.0.1:${target.address().port}`;
    const active = { from: "/qa-active", target: address, rewrite: "/restored", change_origin: true, status: "active" };
    const inactive = { from: "/qa-off", target: address, rewrite: null, change_origin: false, status: "inactive" };
    await invoke(page, "add_proxy_mapping", { mapping: active });
    await invoke(page, "add_proxy_mapping", { mapping: { ...inactive, status: "active" } });
    await invoke(page, "set_proxy_mapping_status", { from: inactive.from, status: "inactive" });
    await invoke(page, "add_proxy_mapping", { mapping: { ...active, from: "/qa-deleted" } });
    await invoke(page, "remove_proxy_mapping", { from: "/qa-deleted" });
    await closeWindow(page);
    spawn(executable, [], { stdio: "ignore" });
    page = await attach();
    await verifyRouting([active, inactive], page);
    console.log("重启后两条规则字段一致，启用规则正确重写，停用规则返回 404，已删除规则未恢复。");
    await closeWindow(page);
    // Exercise an in-place NSIS update over an installation that already owns a database.
    const installers = readdirSync(process.env.TEMP).filter(name => /^evp-proxies-update-.*\.exe$/i.test(name));
    assert.equal(installers.length, 1);
    execFileSync(path.join(process.env.TEMP, installers[0]), ["/S", "/UPDATE", "/R"], { stdio: "ignore", timeout: 90000 });
    page = await attach();
    assert.equal(await invoke(page, "plugin:app|version"), version);
    await verifyRouting([active, inactive], page);
    console.log("以 /UPDATE 再次运行原安装包后，规则及实际转发行为均保持一致。");
    await closeWindow(page);
  } finally { target.close(); }
}

main().catch(error => { console.error(error); process.exit(1); });
