import { useEffect } from "react";
import type { ReactNode } from "react";
import { BetweenHorizontalStart, GalleryHorizontalEnd, GalleryHorizontal, Group, Plus, Trash2, Ungroup } from "lucide-react";
import { useTranslation } from "react-i18next";

import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ContextMenuState } from "@/types/canvas";
import type { ComfyUiParameter } from "@/types/comfyui";
import type { VideoFramePosition } from "@/lib/canvas/canvas-video-frame";

export function CanvasNodeContextMenu({ menu, canCaptureVideoFrame, canGroup, canUngroup, parameterBinding, onClose, onCaptureVideoFrame, onDuplicate, onGroup, onUngroup, onDelete }: { menu: ContextMenuState; canCaptureVideoFrame: boolean; canGroup?: boolean; canUngroup?: boolean; parameterBinding?: { value?: string; options: ComfyUiParameter[]; disabled?: boolean; disabledReason?: string; onChange: (value?: string) => void }; onClose: () => void; onCaptureVideoFrame: (position: VideoFramePosition) => void; onDuplicate: () => void; onGroup?: () => void; onUngroup?: () => void; onDelete: () => void }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    useEffect(() => {
        const close = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Element && target.closest(".ant-popover")) return;
            onClose();
        };
        window.addEventListener("pointerdown", close);
        return () => window.removeEventListener("pointerdown", close);
    }, [onClose]);

    return (
        <div
            className="fixed z-[80] min-w-44 overflow-hidden rounded-xl border py-1 shadow-2xl"
            style={{ left: menu.x, top: menu.y, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
            onPointerDown={(event) => event.stopPropagation()}
        >
            {canCaptureVideoFrame ? (
                <>
                    <MenuButton icon={<BetweenHorizontalStart className="size-4" />} label={t("canvas.videoFrames.first")} onClick={() => onCaptureVideoFrame("first")} />
                    <MenuButton icon={<GalleryHorizontalEnd className="size-4" />} label={t("canvas.videoFrames.last")} onClick={() => onCaptureVideoFrame("last")} />
                    <MenuButton icon={<GalleryHorizontal className="size-4" />} label={t("canvas.videoFrames.current")} onClick={() => onCaptureVideoFrame("current")} />
                    <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} />
                </>
            ) : null}
            {menu.type === "node" && canGroup ? <MenuButton icon={<Group className="size-4" />} label={t("canvas.nodeToolbar.group")} onClick={onGroup} /> : null}
            {menu.type === "node" && canUngroup ? <MenuButton icon={<Ungroup className="size-4" />} label={t("canvas.nodeToolbar.ungroup")} onClick={onUngroup} /> : null}
            {menu.type === "connection" && parameterBinding ? <ConnectionParameterField binding={parameterBinding} /> : null}
            {menu.type === "connection" && parameterBinding ? <div className="my-1 border-t" style={{ borderColor: theme.toolbar.border }} /> : null}
            {menu.type === "node" ? <MenuButton icon={<Plus className="size-4" />} label={t("canvas.controls.duplicate")} onClick={onDuplicate} /> : null}
            <MenuButton icon={<Trash2 className="size-4" />} label={t("canvas.controls.delete")} onClick={onDelete} danger />
        </div>
    );
}

function ConnectionParameterField({ binding }: { binding: { value?: string; options: ComfyUiParameter[]; disabled?: boolean; disabledReason?: string; onChange: (value?: string) => void } }) {
    const { t } = useTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const invalidValue = binding.value && !binding.options.some((parameter) => parameter.key === binding.value) ? binding.value : undefined;
    return (
        <div className="w-64 px-3 py-2" data-canvas-no-zoom>
            <div className="mb-1 text-[11px] font-medium" style={{ color: theme.node.muted }}>{t("canvas.connection.parameterName")}</div>
            <select
                value={binding.value || ""}
                disabled={binding.disabled || !binding.options.length}
                className="h-8 w-full rounded-md border bg-transparent px-2 text-xs outline-none disabled:cursor-not-allowed disabled:opacity-50"
                style={{ borderColor: theme.toolbar.border, color: theme.node.text, background: theme.toolbar.panel }}
                onChange={(event) => binding.onChange(event.target.value || undefined)}
                onPointerDown={(event) => event.stopPropagation()}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <option value="">{t("canvas.connection.unbound")}</option>
                {invalidValue ? <option value={invalidValue}>{invalidValue} ({t("canvas.connection.invalid")})</option> : null}
                {binding.options.map((parameter) => <option key={parameter.key} value={parameter.key}>{parameter.label} ({parameter.key}) · {parameter.type}</option>)}
            </select>
            {binding.disabledReason ? <div className="mt-1 text-[10px] leading-4" style={{ color: theme.node.muted }}>{binding.disabledReason}</div> : null}
        </div>
    );
}

function MenuButton({ icon, label, onClick, danger = false }: { icon: ReactNode; label: string; onClick?: () => void; danger?: boolean }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:opacity-80" style={{ color: danger ? "#f87171" : theme.node.text }} onClick={onClick}>
            {icon}
            <span>{label}</span>
        </button>
    );
}
