import { useState, useEffect, useId, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  Alert,
  Box,
  TextField,
  Button,
  IconButton,
  Typography,
  Paper,
  Grid,
  AppBar,
  Toolbar,
  Chip,
  Container,
  InputAdornment,
  Tooltip,
  Fade,
  Card,
  CardHeader,
  CardContent,
  CardActions,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Snackbar,
} from "@mui/material";
import {
  DeleteOutline as DeleteIcon,
  AddRounded as AddIcon,
  RouterRounded as RouterIcon,
  ArrowForwardRounded as ArrowIcon,
  SettingsInputComponentRounded as ApiIcon,
  LanguageRounded as WebIcon,
  NavigationOutlined,
  PlayCircleOutlined,
  StopCircleOutlined,
} from "@mui/icons-material";
import Popconfirm from "./Popconfirm";
import TitleBarMenu from "./TitleBarMenu";

interface ProxyMapping {
  from: string;
  target: string;
  change_origin?: boolean;
  rewrite?: string;
  status: "active" | "inactive";
}

export default function Dashboard() {
  const [mappings, setMappings] = useState<ProxyMapping[]>([]);
  const [from, setFrom] = useState("");
  const [target, setTarget] = useState("");
  const [rewrite, setRewrite] = useState("");
  const [updatingStatuses, setUpdatingStatuses] = useState<Set<string>>(() => new Set());
  const [mappingError, setMappingError] = useState("");
  const [details, setDetails] = useState<{ from: string; open: boolean } | null>(null);
  const [deleteConfirmation, setDeleteConfirmation] = useState<{
    from: string;
    anchor: HTMLButtonElement;
    status: "ready" | "deleting" | "failed" | "dismissed" | "deleted";
  } | null>(null);
  const mappingsRequestId = useRef(0);
  const detailsTitleId = useId();
  const deleteConfirmationId = useId();
  const isDeleting = deleteConfirmation?.status === "deleting";
  const isDeleteConfirmationOpen = deleteConfirmation !== null &&
    deleteConfirmation.status !== "dismissed" && deleteConfirmation.status !== "deleted";
  const openDeleteFrom = isDeleteConfirmationOpen ? deleteConfirmation?.from : undefined;
  const activeMappingCount = mappings.filter((mapping) => mapping.status === "active").length;
  const detailMapping = mappings.find((mapping) => mapping.from === details?.from);

  const loadMappings = async () => {
    const requestId = ++mappingsRequestId.current;
    try {
      const data = await invoke<ProxyMapping[]>("get_proxy_mappings");
      if (requestId === mappingsRequestId.current) setMappings(data);
    } catch (e) {
      console.error("Failed to load mappings", e);
      if (requestId === mappingsRequestId.current) setMappingError(`读取映射失败：${String(e)}`);
    }
  };

  useEffect(() => {
    loadMappings();
  }, []);

  const handleAdd = async () => {
    if (!from || !target) return;
    try {
      await invoke("add_proxy_mapping", {
        mapping: { from, target, change_origin: true, rewrite: rewrite || undefined },
      });
    } catch (e) {
      setMappingError(`保存映射失败：${String(e)}`);
      return;
    }
    setFrom("");
    setTarget("");
    setRewrite("");
    loadMappings();
  };

  const toggleStatus = async (mapping: ProxyMapping) => {
    if (updatingStatuses.has(mapping.from)) return;

    const status = mapping.status === "active" ? "inactive" : "active";
    setUpdatingStatuses((current) => new Set(current).add(mapping.from));
    try {
      await invoke("set_proxy_mapping_status", { from: mapping.from, status });
      setMappings((current) => current.map((item) => (
        item.from === mapping.from ? { ...item, status } : item
      )));
      await loadMappings();
    } catch (error) {
      console.error("Failed to update mapping status", error);
      setMappingError(`更新映射状态失败：${String(error)}`);
    } finally {
      setUpdatingStatuses((current) => {
        const next = new Set(current);
        next.delete(mapping.from);
        return next;
      });
    }
  };

  const closeDetails = () => {
    setDetails((current) => current && { ...current, open: false });
  };

  const toggleDeleteConfirmation = (from: string, anchor: HTMLButtonElement) => {
    if (isDeleting || deleteConfirmation?.status === "deleted") return;

    if (isDeleteConfirmationOpen && deleteConfirmation?.anchor === anchor) {
      dismissDeleteConfirmation();
      return;
    }
    setDeleteConfirmation({ from, anchor, status: "ready" });
  };

  const dismissDeleteConfirmation = () => {
    if (!deleteConfirmation) return;
    setDeleteConfirmation({ ...deleteConfirmation, status: "dismissed" });
  };

  const confirmDelete = async () => {
    if (!deleteConfirmation || !isDeleteConfirmationOpen || isDeleting) return;

    setDeleteConfirmation({ ...deleteConfirmation, status: "deleting" });
    try {
      await invoke("remove_proxy_mapping", { from: deleteConfirmation.from });
      setDeleteConfirmation({ ...deleteConfirmation, status: "deleted" });
    } catch (error) {
      console.error("Failed to delete mapping", error);
      setDeleteConfirmation({ ...deleteConfirmation, status: "failed" });
    }
  };

  const finishDeleteConfirmation = () => {
    setDeleteConfirmation(null);
    if (deleteConfirmation?.status === "deleted") void loadMappings();
  };

  return (
    <>
      {/* 顶栏 */}
      <AppBar
        position="static"
        elevation={0}
        sx={{
          bgcolor: "rgba(255, 255, 255, 0.8)",
          backdropFilter: "blur(10px)",
          borderBottom: "1px solid",
          borderColor: "divider",
          color: "text.primary",
        }}
      >
        <Container maxWidth="xl">
          <Toolbar sx={{ px: { xs: 0 } }}>
            <RouterIcon sx={{ mr: 1.5, color: "primary.main", fontSize: 28 }} />
            <Typography
              variant="h6"
              sx={{ flexGrow: 1, fontWeight: 700, letterSpacing: -0.5 }}
            >
              Evp<span style={{ color: "#1976d2" }}>Proxies</span>
            </Typography>
            <Chip
              label={`${activeMappingCount} 条映射已启用`}
              size="small"
              sx={{
                mr: 2,
                fontWeight: 600,
                bgcolor: "primary.light",
                color: "common.white",
              }}
            />
            <TitleBarMenu />
          </Toolbar>
        </Container>
      </AppBar>

      {/* 中上区域：配置表单 */}
      <Box
        sx={{
          py: 3,
          borderBottom: "1px solid",
          borderColor: "divider",
          bgcolor: "white",
          width: "100%",
          boxSizing: "border-box",
        }}
        display={"flex"}
        flexDirection={"column"}
        justifyContent={"center"}
        alignItems={"center"}
      >
        <Container sx={{ width: "fit-content" }}>
          <Typography
            variant="subtitle2"
            color="text.secondary"
            sx={{ mb: 2, fontWeight: 600, textAlign: "center" }}
            fontSize={"1.1rem"}
          >
            新建映射规则
          </Typography>
          <Paper
            elevation={0}
            sx={{
              p: 2,
              borderRadius: 3,
              border: "1px solid",
              borderColor: "divider",
            }}
          >
            <Grid container spacing={2} alignItems="center">
              <Grid>
                <TextField
                  label="源路径 (Source)"
                  value={from}
                  onChange={(e) => setFrom(e.target.value)}
                  placeholder="/api/v1"
                  size="small"
                  fullWidth
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <ApiIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
              <Grid>
                <TextField
                  label="目标地址 (Target)"
                  value={target}
                  onChange={(e) => setTarget(e.target.value)}
                  placeholder="http://localhost:8080"
                  size="small"
                  fullWidth
                  InputProps={{
                    startAdornment: (
                      <InputAdornment position="start">
                        <WebIcon fontSize="small" />
                      </InputAdornment>
                    ),
                  }}
                />
              </Grid>
              <Grid>
                <TextField
                  label="重写 (Rewrite)"
                  value={rewrite}
                  onChange={(e) => setRewrite(e.target.value)}
                  placeholder="/api"
                  size="small"
                  fullWidth
                />
              </Grid>
              <Grid>
                <Button
                  variant="contained"
                  onClick={handleAdd}
                  fullWidth
                  disableElevation
                  startIcon={<AddIcon />}
                  disabled={!from || !target}
                  sx={{
                    borderRadius: 2,
                    textTransform: "none",
                    fontWeight: 600,
                    py: 1,
                  }}
                >
                  添加
                </Button>
              </Grid>
            </Grid>
          </Paper>
        </Container>
      </Box>

      {/* 下方区域：列表区域（可滚动） */}
      <Box sx={{ flexGrow: 1, overflowY: "auto", py: 3, px: 2, width: "100%", boxSizing: "border-box" }}>
        <Container maxWidth="xl">
          <Typography
            variant="subtitle2"
            color="text.secondary"
            textAlign="center"
            fontWeight={600}
            mb={2}
          >
            实时映射列表
          </Typography>

          {mappings.length === 0 ? (
            <Paper
              sx={{
                p: 6,
                textAlign: "center",
                borderRadius: 4,
                border: "1px dashed #ccc",
                bgcolor: "transparent",
              }}
            >
              <Typography color="text.disabled">
                暂无代理规则，请在上方添加
              </Typography>
            </Paper>
          ) : (
            <Grid container spacing={2} justifyContent="center">
              {mappings.map((mapping) => (
                <Grid key={mapping.from}>
                  <Fade in>
                    <Card
                      variant="outlined"
                      sx={{
                        borderRadius: 3,
                        border: "1px solid",
                        borderColor: "divider",
                        position: "relative",
                        transition: "all 0.2s",
                        "&:hover": {
                          borderColor: "primary.main",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                        },
                        width: 300,
                        aspectRatio: "16 / 9",
                        display: "flex",
                        flexDirection: "column",
                      }}
                    >
                      <CardHeader
                        title={
                          <Typography
                            variant="subtitle2"
                            sx={{
                              fontWeight: 600,
                              color: mapping.status === "inactive" ? "text.disabled" : "text.primary",
                              maxWidth: "180px",
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap"
                            }}>
                            {mapping.from}
                          </Typography>
                        }
                        action={
                          <>
                            <Tooltip title={mapping.status === "inactive" ? "启用" : "停用"}>
                              <IconButton
                                size="small"
                                aria-disabled={updatingStatuses.has(mapping.from)}
                                onClick={() => toggleStatus(mapping)}
                                sx={{
                                  color: mapping.status === "inactive" ? "success.light" : "error.light",
                                  "&:hover": {
                                    color: mapping.status === "inactive" ? "success.main" : "error.main",
                                  },
                                }}
                              >
                                {
                                  mapping.status === "inactive" ?
                                    <PlayCircleOutlined fontSize="small" />
                                    :
                                    <StopCircleOutlined fontSize="small" />
                                }
                              </IconButton>
                            </Tooltip>
                            <Tooltip title="详情">
                              <IconButton
                                size="small"
                                aria-haspopup="dialog"
                                onClick={() => setDetails({ from: mapping.from, open: true })}
                                sx={{
                                  color: "primary.light",
                                  "&:hover": {
                                    color: "primary.main",
                                  },
                                }}
                              >
                                <NavigationOutlined fontSize="small" sx={{ rotate: "45deg" }} />
                              </IconButton>
                            </Tooltip>
                            <Tooltip title={openDeleteFrom === mapping.from ? "" : "删除"}>
                              <IconButton
                                size="small"
                                aria-label="删除"
                                aria-haspopup="dialog"
                                aria-expanded={openDeleteFrom === mapping.from}
                                aria-controls={openDeleteFrom === mapping.from ? deleteConfirmationId : undefined}
                                onClick={(event) => toggleDeleteConfirmation(mapping.from, event.currentTarget)}
                                sx={{
                                  color: "error.light",
                                  "&:hover": {
                                    color: "error.main",
                                  },
                                }}
                              >
                                <DeleteIcon fontSize="small" />
                              </IconButton>
                            </Tooltip>
                          </>
                        }
                      />

                      <CardContent
                        sx={{
                          flex: 1,
                          display: "flex",
                          alignItems: "start",
                          gap: 2,
                          pt: 0
                        }}
                      >
                        <Box  >
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            源路径
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 700,
                              color: "success.main",
                              fontFamily: "Monospace",
                              // nowrap
                              whiteSpace: "nowrap",
                            }}
                          >
                            {mapping.from}
                          </Typography>
                        </Box>

                        <Box
                          sx={{
                            display: "flex",
                            alignItems: "center",
                            gap: 1,
                            mt: 1.5, // 1.5rem
                          }}
                        >
                          <ArrowIcon
                            sx={{
                              color: "text.disabled",
                              fontSize: 16,
                              transform: "rotate(0deg)",
                            }}
                          />
                        </Box>

                        <Box sx={{ overflow: "hidden" }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            目的地
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 500,
                              color: "primary.main",
                              fontFamily: "Monospace",
                              wordBreak: "break-all",
                            }}
                          >
                            {mapping.target}
                          </Typography>
                        </Box>
                      </CardContent>

                      <CardActions>
                        {
                          mapping.change_origin && (
                            <Chip
                              label="CORS 已启用" // CORS ENABLED
                              size="small"
                              variant="outlined"
                              sx={{
                                height: 20,
                                fontSize: "0.65rem",
                                color: "success.main",
                                borderColor: "success.light",
                              }}
                            />
                          )
                        }
                      </CardActions>
                    </Card>
                  </Fade>
                </Grid>
              ))}
            </Grid>
          )}
        </Container>
      </Box>

      <Dialog
        open={Boolean(details?.open && detailMapping)}
        onClose={closeDetails}
        aria-labelledby={detailsTitleId}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle id={detailsTitleId}>映射详情</DialogTitle>
        <DialogContent dividers>
          {detailMapping && (
            <Box component="dl" sx={{ m: 0, display: "grid", gap: 1.5 }}>
              {[
                { label: "源路径", value: detailMapping.from },
                { label: "目标地址", value: detailMapping.target },
                { label: "更改 Origin", value: detailMapping.change_origin ? "是" : "否" },
                { label: "路径重写", value: detailMapping.rewrite ?? "未设置" },
                { label: "状态", value: detailMapping.status === "active" ? "已启用" : "已停用" },
              ].map(({ label, value }) => (
                <Box key={label} sx={{ display: "grid", gridTemplateColumns: "6rem minmax(0, 1fr)", gap: 1 }}>
                  <Typography component="dt" variant="body2" color="text.secondary">{label}</Typography>
                  <Typography component="dd" variant="body2" sx={{ m: 0, overflowWrap: "anywhere" }}>
                    {value}
                  </Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDetails} autoFocus>关闭</Button>
        </DialogActions>
      </Dialog>

      <Snackbar open={Boolean(mappingError)} autoHideDuration={6000} onClose={() => setMappingError("")}>
        <Alert severity="error" onClose={() => setMappingError("")}>{mappingError}</Alert>
      </Snackbar>

      <Popconfirm
        id={deleteConfirmationId}
        open={isDeleteConfirmationOpen}
        anchorEl={deleteConfirmation?.anchor ?? null}
        title="删除这条映射规则？"
        description={`源路径「${deleteConfirmation?.from ?? ""}」`}
        confirmLabel="确认删除"
        confirmColor="error"
        pending={isDeleting}
        error={deleteConfirmation?.status === "failed" ? "删除失败，请重试。" : undefined}
        onCancel={dismissDeleteConfirmation}
        onConfirm={confirmDelete}
        onExited={finishDeleteConfirmation}
      />
    </>
  );
}
