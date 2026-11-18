import { useRef } from "react";
import {
  Alert,
  Box,
  Button,
  ClickAwayListener,
  Fade,
  Paper,
  Popper,
  Typography,
  useMediaQuery,
  type ButtonProps,
  type PopperProps,
} from "@mui/material";
import { ErrorRounded as WarningIcon } from "@mui/icons-material";

interface PopconfirmProps {
  id: string;
  open: boolean;
  anchorEl: HTMLElement | null;
  title: string;
  description: string;
  confirmLabel: string;
  confirmColor?: ButtonProps["color"];
  pending?: boolean;
  error?: string;
  onCancel: () => void;
  onConfirm: () => void;
  onExited?: () => void;
}

const modifiers: PopperProps["modifiers"] = [
  { name: "offset", options: { offset: [0, 10] } },
  { name: "arrow", options: { padding: 10 } },
  { name: "preventOverflow", options: { padding: 8 } },
];

export default function Popconfirm({
  id,
  open,
  anchorEl,
  title,
  description,
  confirmLabel,
  confirmColor = "primary",
  pending = false,
  error,
  onCancel,
  onConfirm,
  onExited,
}: PopconfirmProps) {
  const cancelButton = useRef<HTMLButtonElement>(null);
  const reduceMotion = useMediaQuery("(prefers-reduced-motion: reduce)");

  const cancel = (restoreFocus = false) => {
    if (!open || pending) return;
    if (restoreFocus) anchorEl?.focus();
    onCancel();
  };

  return (
    <Popper
      open={open}
      anchorEl={anchorEl}
      placement="top"
      role="presentation"
      modifiers={modifiers}
      transition
      sx={{
        zIndex: "tooltip",
        pointerEvents: open ? "auto" : "none",
        '&[data-popper-placement^="top"] [data-popper-arrow]': { bottom: -5 },
        '&[data-popper-placement^="bottom"] [data-popper-arrow]': { top: -5 },
      }}
    >
      {({ TransitionProps }) => (
        <Fade
          {...TransitionProps}
          timeout={reduceMotion ? 0 : { enter: 160, exit: 120 }}
          onEnter={() => {
            TransitionProps?.onEnter();
            cancelButton.current?.focus();
          }}
          onExited={() => {
            TransitionProps?.onExited();
            onExited?.();
          }}
        >
          <Box>
            <ClickAwayListener
              mouseEvent="onMouseDown"
              touchEvent="onTouchStart"
              onClickAway={(event) => {
                if (event.target instanceof Node && anchorEl?.contains(event.target)) return;
                cancel();
              }}
            >
              <Paper
                id={id}
                role="dialog"
                aria-labelledby={`${id}-title`}
                aria-describedby={`${id}-description`}
                inert={!open}
                elevation={6}
                onKeyDown={(event) => {
                  if (event.key === "Escape") cancel(true);
                }}
                sx={{ maxWidth: "min(280px, calc(100vw - 16px))", p: 1.5, borderRadius: 2 }}
              >
                <Box
                  data-popper-arrow
                  sx={{
                    position: "absolute",
                    width: 10,
                    height: 10,
                    pointerEvents: "none",
                    "&::before": {
                      content: '""',
                      display: "block",
                      width: "100%",
                      height: "100%",
                      bgcolor: "background.paper",
                      transform: "rotate(45deg)",
                    },
                  }}
                />
                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75 }}>
                  <WarningIcon color="warning" fontSize="small" />
                  <Typography id={`${id}-title`} variant="subtitle2" fontWeight={600}>
                    {title}
                  </Typography>
                </Box>
                <Typography
                  id={`${id}-description`}
                  variant="body2"
                  color="text.secondary"
                  sx={{ mt: 0.5, overflowWrap: "anywhere" }}
                >
                  {description}
                </Typography>
                {error && <Alert severity="error" sx={{ mt: 1 }}>{error}</Alert>}
                <Box sx={{ display: "flex", justifyContent: "flex-end", gap: 1, mt: 1 }}>
                  <Button ref={cancelButton} size="small" disabled={pending} onClick={() => cancel(true)}>
                    取消
                  </Button>
                  <Button size="small" color={confirmColor} variant="contained" loading={pending} onClick={onConfirm}>
                    {confirmLabel}
                  </Button>
                </Box>
              </Paper>
            </ClickAwayListener>
          </Box>
        </Fade>
      )}
    </Popper>
  );
}
