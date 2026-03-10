import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
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
} from "@mui/material";
import {
  DeleteOutline as DeleteIcon,
  AddRounded as AddIcon,
  RouterRounded as RouterIcon,
  ArrowForwardRounded as ArrowIcon,
  SettingsInputComponentRounded as ApiIcon,
  LanguageRounded as WebIcon,
} from "@mui/icons-material";

interface ProxyMapping {
  from: string;
  target: string;
  change_origin?: boolean;
  rewrite?: string;
}

export default function Dashboard() {
  const [mappings, setMappings] = useState<ProxyMapping[]>([]);
  const [from, setFrom] = useState("");
  const [target, setTarget] = useState("");
  const [rewrite, setRewrite] = useState("");

  const loadMappings = async () => {
    try {
      const data = await invoke<ProxyMapping[]>("get_proxy_mappings");
      setMappings(data);
    } catch (e) {
      console.error("Failed to load mappings", e);
    }
  };

  useEffect(() => {
    loadMappings();
  }, []);

  const handleAdd = async () => {
    if (!from || !target) return;
    await invoke("add_proxy_mapping", {
      mapping: { from, target, change_origin: true, rewrite: rewrite || undefined },
    });
    setFrom("");
    setTarget("");
    setRewrite("");
    loadMappings();
  };

  const handleDelete = async (from: string) => {
    await invoke("remove_proxy_mapping", { from });
    loadMappings();
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
              label={`${mappings.length} 条映射已启用`}
              size="small"
              sx={{
                mr: 2,
                fontWeight: 600,
                bgcolor: "primary.light",
                color: "primary.dark",
              }}
            />
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
              <Grid item xs={12} sm={4}>
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
              <Grid item xs={12} sm={4}>
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
              <Grid item xs={12} sm={2}>
                <TextField
                  label="重写 (Rewrite)"
                  value={rewrite}
                  onChange={(e) => setRewrite(e.target.value)}
                  placeholder="/api"
                  size="small"
                  fullWidth
                />
              </Grid>
              <Grid item xs={12} sm={2}>
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
      <Box sx={{ flexGrow: 1, overflowY: "auto", py: 3, px: 2 }}>
        <Container maxWidth="lg">
          <Typography
            variant="subtitle2"
            color="text.secondary"
            sx={{ mb: 2, fontWeight: 600 }}
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
            <Grid container spacing={2}>
              {mappings.map((mapping) => (
                <Grid item xs={12} sm={6} md={4} key={mapping.from}>
                  <Fade in>
                    <Paper
                      elevation={0}
                      sx={{
                        p: 2,
                        borderRadius: 3,
                        border: "1px solid",
                        borderColor: "divider",
                        position: "relative",
                        transition: "all 0.2s",
                        "&:hover": {
                          borderColor: "primary.main",
                          boxShadow: "0 4px 12px rgba(0,0,0,0.05)",
                        },
                      }}
                    >
                      <Box
                        sx={{
                          mb: 1.5,
                          display: "flex",
                          justifyContent: "space-between",
                          alignItems: "flex-start",
                        }}
                      >
                        <Box sx={{ overflow: "hidden" }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            Source
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 700,
                              fontFamily: "Monospace",
                              // nowrap
                              whiteSpace: "nowrap",
                            }}
                          >
                            {mapping.from}
                          </Typography>
                        </Box>
                        <Tooltip title="删除">
                          <IconButton
                            size="small"
                            onClick={() => handleDelete(mapping.from)}
                            sx={{
                              color: "error.light",
                              "&:hover": {
                                color: "error.main",
                                bgcolor: "#fff1f0",
                              },
                            }}
                          >
                            <DeleteIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Box>

                      <Box
                        sx={{
                          display: "flex",
                          alignItems: "center",
                          gap: 1,
                          mb: 1.5,
                        }}
                      >
                        <ArrowIcon
                          sx={{
                            color: "text.disabled",
                            fontSize: 16,
                            transform: "rotate(90deg)",
                          }}
                        />
                      </Box>

                      <Box sx={{ mb: 2 }}>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ display: "block" }}
                        >
                          Target
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

                      {mapping.rewrite && (
                        <Box sx={{ mb: 2 }}>
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{ display: "block" }}
                          >
                            Rewrite
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              fontWeight: 500,
                              color: "warning.main",
                              fontFamily: "Monospace",
                            }}
                          >
                            {mapping.rewrite}
                          </Typography>
                        </Box>
                      )}

                      <Chip
                        label="CORS Enabled"
                        size="small"
                        variant="outlined"
                        sx={{
                          height: 20,
                          fontSize: "0.65rem",
                          color: "success.main",
                          borderColor: "success.light",
                        }}
                      />
                    </Paper>
                  </Fade>
                </Grid>
              ))}
            </Grid>
          )}
        </Container>
      </Box>
    </>
  );
}
