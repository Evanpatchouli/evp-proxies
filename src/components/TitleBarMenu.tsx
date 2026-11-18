import { useRef, useState, type KeyboardEvent } from "react";
import { Alert, Badge, Box, ClickAwayListener, Divider, IconButton, ListItemIcon, ListItemText,
  MenuItem, MenuList, Paper, Popper, Snackbar, Tooltip } from "@mui/material";
import { Add, AutoAwesomeOutlined, ChatBubbleOutline, ChevronRight, Close, DesktopWindowsOutlined,
  DescriptionOutlined, Fullscreen, HelpOutline, InfoOutlined, MoreHoriz, Refresh, Remove } from "@mui/icons-material";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { About, useUpdates, WhatsNew } from "./ReleaseDialogs";

type Group = "视图" | "帮助";
const panel = { minWidth: 152, borderRadius: 2, border: 1, borderColor: "divider",
  "& .MuiMenuItem-root": { minHeight: 34, borderRadius: 1, mx: 0.5 },
  "& .MuiListItemIcon-root": { minWidth: 30 }, "& .MuiSvgIcon-root": { fontSize: 18 } };

export default function TitleBarMenu() {
  const button = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const [sub, setSub] = useState<{ group: Group; anchor: HTMLElement } | null>(null);
  const [dialog, setDialog] = useState<"history" | "about" | null>(null);
  const [error, setError] = useState("");
  const zoom = useRef(10);
  const subList = useRef<HTMLUListElement>(null);
  const updates = useUpdates();

  function close(restoreFocus = true) {
    setSub(null);
    setOpen(false);
    if (restoreFocus) button.current?.focus();
  }
  function run(action: () => unknown) {
    close();
    void Promise.resolve().then(action).catch(e => setError(String(e)));
  }
  async function changeZoom(step: number) {
    const next = Math.min(20, Math.max(5, zoom.current + step));
    await getCurrentWebview().setZoom(next / 10);
    zoom.current = next;
  }
  function navigate(event: KeyboardEvent) {
    if (event.key === "Escape" || event.key === "Tab") {
      close();
      if (event.key === "Escape") event.preventDefault();
    }
  }
  function groupItem(group: Group) {
    return <MenuItem aria-haspopup="menu" aria-expanded={sub?.group === group}
      selected={sub?.group === group}
      onMouseEnter={e => setSub({ group, anchor: e.currentTarget })}
      onClick={e => setSub({ group, anchor: e.currentTarget })}
      onKeyDown={e => {
        if (["ArrowRight", "Enter", " "].includes(e.key)) {
          e.preventDefault();
          setSub({ group, anchor: e.currentTarget });
          requestAnimationFrame(() => subList.current?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')?.focus());
        }
      }}>
      <ListItemIcon>{group === "视图" ? <DesktopWindowsOutlined /> : <HelpOutline />}</ListItemIcon>
      <ListItemText>{group}</ListItemText><ChevronRight />
    </MenuItem>;
  }
  function item(label: string, icon: React.ReactNode, action: () => unknown) {
    return <MenuItem key={label} onClick={() => run(action)}>
      <ListItemIcon>{icon}</ListItemIcon><ListItemText>{label}</ListItemText>
      {label === "新功能" && updates.unread && <Badge color="primary" variant="dot" aria-label="有未读更新" sx={{ ml: 2, mr: 1 }} />}
    </MenuItem>;
  }
  return <>
    <ClickAwayListener onClickAway={() => close(false)}>
      <Box onKeyDown={navigate}>
        <Tooltip title={open ? "" : "更多"}>
          <IconButton ref={button} aria-label="更多" aria-haspopup="menu" aria-expanded={open}
            size="small" onClick={() => open ? close() : setOpen(true)}
            sx={{ borderRadius: 1.5, bgcolor: open ? "action.selected" : undefined }}>
            <MoreHoriz />
          </IconButton>
        </Tooltip>
        <Popper open={open} anchorEl={button.current} placement="bottom-end" sx={{ zIndex: "modal" }}>
          <Paper elevation={4} sx={panel}>
            <MenuList dense autoFocus aria-label="应用菜单">
              {groupItem("视图")}
              {groupItem("帮助")}
              <Divider />
              <MenuItem onFocus={() => setSub(null)} onMouseEnter={() => setSub(null)} onClick={() => run(() => getCurrentWindow().close())}>
                <ListItemIcon><Close /></ListItemIcon><ListItemText>关闭</ListItemText>
              </MenuItem>
            </MenuList>
          </Paper>
        </Popper>
        <Popper open={Boolean(sub)} anchorEl={sub?.anchor} placement="left-start" sx={{ zIndex: "modal" }}>
          <Paper elevation={4} sx={panel}>
            <MenuList dense ref={subList} aria-label={sub?.group} onKeyDown={e => {
              if (e.key === "ArrowLeft") {
                e.preventDefault();
                sub?.anchor.focus();
                setSub(null);
              }
            }}>
              {sub?.group === "视图" ? [
                item("放大", <Add />, () => changeZoom(1)),
                item("缩小", <Remove />, () => changeZoom(-1)),
                item("切换全屏", <Fullscreen />, async () => {
                  const window = getCurrentWindow();
                  await window.setFullscreen(!await window.isFullscreen());
                }),
              ] : [
                <Tooltip key="docs" title="敬请期待" placement="left">
                  <Box component="li" role="presentation">
                    <MenuItem component="div" disabled aria-label="文档"><ListItemIcon><DescriptionOutlined /></ListItemIcon><ListItemText>文档</ListItemText></MenuItem>
                  </Box>
                </Tooltip>,
                item("新功能", <AutoAwesomeOutlined />, () => setDialog("history")),
                item("反馈", <ChatBubbleOutline />, () => openUrl("https://github.com/Evanpatchouli/evp-proxies/issues")),
                item("检查更新", <Refresh />, () => updates.check(true)),
                item("关于", <InfoOutlined />, () => setDialog("about")),
              ]}
            </MenuList>
          </Paper>
        </Popper>
      </Box>
    </ClickAwayListener>
    {dialog === "about" && <About onClose={() => setDialog(null)} />}
    {dialog === "history" && <WhatsNew onClose={() => setDialog(null)} onRead={updates.onRead} />}
    {updates.updateDialog}
    <Snackbar open={Boolean(error)} autoHideDuration={5000} onClose={() => setError("")}>
      <Alert severity="error" onClose={() => setError("")}>{error}</Alert>
    </Snackbar>
  </>;
}
