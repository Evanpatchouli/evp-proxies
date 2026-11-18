import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Channel, invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Alert, Box, Button, Dialog, DialogActions, DialogContent, DialogTitle,
  Divider, LinearProgress, Link, Stack, Typography } from "@mui/material";
import { releaseDate, version } from "../../package.json";
import bundledHistory from "../../resources/changelog.json";

type Release = { tag_name: string; published_at: string; body: string | null };
type Check = { available: boolean; release: Release | null };
type Progress = { stage: "download" | "verify" | "install"; received: number; total: number };
type History = { time: number; releases: Release[] };
const historyKey = "evp-proxies.release-history";
const seenKey = "evp-proxies.last-seen-release";
const checkKey = "evp-proxies.update-check." + version;
const Markdown = lazy(() => import("react-markdown"));
let historyRequest: Promise<Release[]> | undefined;

function cached<T>(key: string): T | null {
  try { return JSON.parse(localStorage.getItem(key) ?? "null"); }
  catch { return null; }
}

function Notes({ release }: { release: Release }) {
  return <Box sx={{ overflowWrap: "anywhere", "& h2, & h3": { fontSize: "1rem" }, "& ul": { pl: 3 } }}>
    <Typography variant="subtitle1" fontWeight={700}>{release.tag_name}</Typography>
    <Typography variant="caption" color="text.secondary">{release.published_at.slice(0, 10)}</Typography>
    <Suspense fallback={<Typography variant="body2">正在加载说明…</Typography>}>
    <Markdown skipHtml components={{
      img: () => null,
      a: ({ href, children }) => href && /^https?:\/\//i.test(href)
        ? <Link href={href} onClick={event => { event.preventDefault(); void openUrl(href); }}>{children}</Link>
        : <>{children}</>,
    }}>{release.body || "此版本未提供更新说明。"}</Markdown>
    </Suspense>
  </Box>;
}

export function About({ onClose }: { onClose: () => void }) {
  return <Dialog open onClose={onClose} aria-labelledby="about-title" fullWidth maxWidth="xs">
    <DialogTitle id="about-title">关于 EvpProxies</DialogTitle>
    <DialogContent dividers>
      <Typography gutterBottom>HTTP 代理映射管理工具</Typography>
      <Typography variant="body2">当前版本　v{version}</Typography>
      <Typography variant="body2">发布日期　{releaseDate}</Typography>
    </DialogContent>
    <DialogActions><Button onClick={onClose}>关闭</Button></DialogActions>
  </Dialog>;
}

export function WhatsNew({ onClose, onRead }: { onClose: () => void; onRead: (tag: string) => void }) {
  const [history, setHistory] = useState<Release[]>(() => cached<History>(historyKey)?.releases ?? bundledHistory);
  const [busy, setBusy] = useState(false);
  const [hint, setHint] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      const saved = cached<History>(historyKey);
      if (!refresh && saved?.releases.length && Date.now() - saved.time < 6 * 3600_000) {
        onRead(saved.releases[0].tag_name);
        return;
      }
      setBusy(true);
      try {
        historyRequest ??= invoke<Release[]>("release_history").finally(() => { historyRequest = undefined; });
        const releases = await historyRequest;
        if (!active) return;
        if (releases.length) {
          setHistory(releases);
          localStorage.setItem(historyKey, JSON.stringify({ time: Date.now(), releases }));
          onRead(releases[0].tag_name);
          setHint("");
        } else {
          setHistory(bundledHistory);
          setHint("项目暂未发布 Release，当前显示内置记录。");
        }
      } catch {
        if (active) setHint(saved ? "获取失败，当前显示上次保存的记录。" : "获取失败，当前显示内置记录。");
      } finally {
        if (active) setBusy(false);
      }
    }
    void load();
    return () => { active = false; };
  }, [refresh, onRead]);
  return <Dialog open onClose={onClose} aria-labelledby="history-title" fullWidth maxWidth="sm">
    <DialogTitle id="history-title">新功能</DialogTitle>
    {busy && <LinearProgress aria-label="正在获取更新记录" />}
    <DialogContent dividers>
      {hint && <Typography variant="body2" color="text.secondary" gutterBottom>{hint}</Typography>}
      <Stack spacing={2} divider={<Divider />}>
        {history.slice(0, expanded ? undefined : 5).map(r => <Notes key={r.tag_name} release={r} />)}
      </Stack>
      {history.length > 5 && <Button onClick={() => setExpanded(!expanded)}>{expanded ? "收起" : "查看更早版本"}</Button>}
    </DialogContent>
    <DialogActions><Button disabled={busy} onClick={() => setRefresh(n => n + 1)}>刷新</Button><Button onClick={onClose}>关闭</Button></DialogActions>
  </Dialog>;
}

export function useUpdates() {
  const [opened, setOpened] = useState(false);
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState<Check | null>(null);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState<Progress | null>(null);
  const [latest, setLatest] = useState("");
  const [seen, setSeen] = useState(() => localStorage.getItem(seenKey));
  const inFlight = useRef<Promise<Check> | null>(null);
  const installing = useRef(false);
  const onRead = useCallback((tag: string) => {
    localStorage.setItem(seenKey, tag);
    setSeen(tag);
    setLatest(tag);
  }, []);

  const check = useCallback(async (manual = false) => {
    if (installing.current) return;
    if (manual) setOpened(true);
    if (inFlight.current) return;
    setChecking(true);
    setError("");
    try {
      inFlight.current = invoke<Check>("check_update");
      const next = await inFlight.current;
      setResult(next);
      localStorage.setItem(checkKey, JSON.stringify(next));
      setLatest(next.release?.tag_name ?? "");
      if (next.available) setOpened(true);
    } catch (e) {
      const saved = cached<Check>(checkKey);
      setResult(saved);
      setError(`无法检查更新：${String(e)}${saved ? "。当前显示上次检查结果。" : ""}`);
    } finally {
      inFlight.current = null;
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    const start = window.setTimeout(() => void check(), 2000);
    const timer = window.setInterval(() => void check(), 15 * 60_000);
    return () => { window.clearTimeout(start); window.clearInterval(timer); };
  }, [check]);

  async function install() {
    if (installing.current || !result?.available || !result.release) return;
    installing.current = true;
    setError("");
    setProgress({ stage: "download", received: 0, total: 0 });
    const channel = new Channel<Progress>();
    channel.onmessage = setProgress;
    try {
      await invoke("install_update", { tag: result.release.tag_name, progress: channel });
    } catch (e) {
      setError(String(e));
    } finally {
      installing.current = false;
      setProgress(null);
    }
  }
  const close = () => { if (!installing.current) setOpened(false); };
  const updateDialog = <Dialog open={opened} onClose={close} aria-labelledby="update-title" fullWidth maxWidth="sm">
    <DialogTitle id="update-title">{result?.available && !checking ? "发现新版本" : "检查更新"}</DialogTitle>
    <DialogContent dividers>
      {error && <Alert severity="warning" sx={{ mb: 1 }}>{error}</Alert>}
      {checking ? <><Typography>正在检查更新…</Typography><LinearProgress /></>
        : result?.available && result.release ? <Notes release={result.release} />
        : result && <Typography>{result.release ? `已是最新版本（v${version}）` : "项目暂未发布 Release"}</Typography>}
      {progress && <Box aria-live="polite">
        <Typography variant="body2">{progress.stage === "verify" ? "正在校验 SHA-256…" : progress.stage === "install"
          ? "正在安装，应用即将重启…" : progress.total ? `正在下载　${Math.floor(100 * progress.received / progress.total)}%` : "正在准备下载…"}</Typography>
        <LinearProgress variant={progress.total ? "determinate" : "indeterminate"} value={progress.total ? 100 * progress.received / progress.total : 0} />
      </Box>}
    </DialogContent>
    <DialogActions>
      {progress?.stage === "download" && <Button onClick={() => void invoke("cancel_download").catch(e => setError(String(e)))}>取消下载</Button>}
      {!progress && <>
        <Button onClick={close}>{result?.available ? "稍后再说" : "关闭"}</Button>
        {error && <Button disabled={checking} onClick={() => void check(true)}>重新检查</Button>}
        {result?.available && <Button variant="contained" disabled={checking} onClick={install}>立即更新</Button>}
      </>}
    </DialogActions>
  </Dialog>;
  return { check, unread: Boolean(latest && latest !== seen), onRead, updateDialog };
}
