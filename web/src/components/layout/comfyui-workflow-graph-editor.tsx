import { Button, Checkbox, Input, InputNumber, Select, Space, Tag, Tooltip } from "antd";
import { Check, CircleAlert, Maximize2, Plus, ZoomIn, ZoomOut } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, WheelEvent as ReactWheelEvent } from "react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ComfyUiNode, ComfyUiParameter, ComfyUiParameterType, ComfyUiValueType, ComfyUiWorkflow } from "@/types/comfyui";

type WorkflowGraphEditorProps = {
    draft: ComfyUiWorkflow;
    patch: (value: Partial<ComfyUiWorkflow>) => void;
};

type GraphNode = {
    id: string;
    node: ComfyUiNode;
    title: string;
    category: "prompt" | "sampler" | "image" | "input";
    x: number;
    y: number;
};

type GraphEdge = { from: string; to: string; path: string };
type GraphData = { nodes: GraphNode[]; edges: GraphEdge[]; width: number; height: number };

const NODE_WIDTH = 184;
const NODE_HEIGHT = 78;
const X_GAP = 76;
const Y_GAP = 22;
const GRAPH_PADDING = 30;
const PARAMETER_TYPES: Array<{ value: ComfyUiParameterType; label: string }> = [
    { value: "text", label: "单行文本" },
    { value: "textarea", label: "多行文本" },
    { value: "number", label: "数字" },
    { value: "select", label: "枚举" },
    { value: "boolean", label: "开关" },
    { value: "seed", label: "Seed" },
];

export function ComfyUiWorkflowGraphEditor({ draft, patch }: WorkflowGraphEditorProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const graph = useMemo(() => buildGraph(draft.workflow), [draft.workflow]);
    const [activeNodeId, setActiveNodeId] = useState(graph.nodes[0]?.id || "");
    const [zoom, setZoom] = useState(1);
    const [pan, setPan] = useState({ x: 0, y: 0 });
    const [isPanning, setIsPanning] = useState(false);
    const graphRef = useRef<HTMLDivElement>(null);
    const panRef = useRef<{ x: number; y: number; originX: number; originY: number; moved: boolean } | null>(null);

    useEffect(() => {
        if (!graph.nodes.some((node) => node.id === activeNodeId)) setActiveNodeId(graph.nodes[0]?.id || "");
    }, [activeNodeId, graph.nodes]);

    const activeNode = draft.workflow[activeNodeId] || null;
    const exposedParameters = draft.parameters.filter((parameter) => parameter.bindings.some((binding) => binding.nodeId === activeNodeId));
    const exposedByInput = useMemo(() => {
        const map = new Map<string, ComfyUiParameter>();
        draft.parameters.forEach((parameter) => parameter.bindings.filter((binding) => binding.nodeId === activeNodeId).forEach((binding) => map.set(binding.inputKey, parameter)));
        return map;
    }, [activeNodeId, draft.parameters]);
    const invalidParameterCount = draft.parameters.filter((parameter) => !parameter.key.trim() || !/^[A-Za-z_][A-Za-z0-9_-]{0,63}$/.test(parameter.key) || !parameter.bindings.length).length;

    const selectNode = (nodeId: string) => setActiveNodeId(nodeId);
    const updateParameters = (parameters: ComfyUiParameter[]) => patch({ parameters });
    const toggleInputParameter = (inputKey: string, value: unknown) => {
        if (!activeNode) return;
        const existing = exposedByInput.get(inputKey);
        if (existing) {
            const nextBindings = existing.bindings.filter((binding) => !(binding.nodeId === activeNodeId && binding.inputKey === inputKey));
            updateParameters(nextBindings.length ? draft.parameters.map((parameter) => parameter === existing ? { ...parameter, bindings: nextBindings } : parameter) : draft.parameters.filter((parameter) => parameter !== existing));
            return;
        }
        if (isLink(value)) return;
        const baseKey = suggestedParameterKey(inputKey, activeNode, draft.parameters);
        const next = createParameter(baseKey, inputKey, value, activeNodeId);
        updateParameters([...draft.parameters, next]);
    };

    const updateParameter = (parameter: ComfyUiParameter, value: Partial<ComfyUiParameter>) => {
        updateParameters(draft.parameters.map((item) => item === parameter ? { ...item, ...value } : item));
    };

    const applyGraphTransform = (nextZoom: number, nextPan: { x: number; y: number }) => {
        setZoom(Math.max(0.45, Math.min(2.4, nextZoom)));
        setPan(nextPan);
    };

    const fitGraph = () => {
        const width = graphRef.current?.clientWidth || 720;
        const height = graphRef.current?.clientHeight || 520;
        const nextZoom = Math.max(0.45, Math.min(1.2, Math.min((width - 48) / graph.width, (height - 48) / graph.height)));
        applyGraphTransform(nextZoom, { x: (graph.width - graph.width * nextZoom) / 2, y: (graph.height - graph.height * nextZoom) / 2 });
    };

    const zoomGraph = (direction: 1 | -1) => {
        const nextZoom = zoom * (direction > 0 ? 1.18 : 1 / 1.18);
        const centerX = graph.width / 2;
        const centerY = graph.height / 2;
        const factor = nextZoom / zoom;
        applyGraphTransform(nextZoom, { x: centerX - (centerX - pan.x) * factor, y: centerY - (centerY - pan.y) * factor });
    };

    const onGraphWheel = (event: ReactWheelEvent<HTMLDivElement>) => {
        event.preventDefault();
        const rect = graphRef.current?.getBoundingClientRect();
        if (!rect) return;
        const cursorX = ((event.clientX - rect.left) / rect.width) * graph.width;
        const cursorY = ((event.clientY - rect.top) / rect.height) * graph.height;
        const nextZoom = zoom * (event.deltaY < 0 ? 1.12 : 1 / 1.12);
        const factor = nextZoom / zoom;
        applyGraphTransform(nextZoom, { x: cursorX - (cursorX - pan.x) * factor, y: cursorY - (cursorY - pan.y) * factor });
    };

    const onGraphPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
        if ((event.target as Element).closest("[data-workflow-node]")) return;
        panRef.current = { x: event.clientX, y: event.clientY, originX: pan.x, originY: pan.y, moved: false };
        setIsPanning(true);
        event.currentTarget.setPointerCapture(event.pointerId);
    };

    const onGraphPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
        const state = panRef.current;
        if (!state) return;
        const dx = event.clientX - state.x;
        const dy = event.clientY - state.y;
        state.moved = Math.abs(dx) + Math.abs(dy) > 4 || state.moved;
        setPan({ x: state.originX + (dx / (graphRef.current?.clientWidth || 1)) * graph.width, y: state.originY + (dy / (graphRef.current?.clientHeight || 1)) * graph.height });
    };

    const stopPanning = (event: ReactPointerEvent<SVGSVGElement>) => {
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        panRef.current = null;
        setIsPanning(false);
    };

    return (
        <div className="grid min-h-[620px] overflow-hidden rounded-lg border" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.text }}>
            <div className="grid min-h-0 grid-cols-[230px_minmax(0,1fr)_300px] max-[900px]:grid-cols-1">
                <aside className="min-h-0 overflow-y-auto border-r p-3 max-[900px]:order-2 max-[900px]:max-h-[240px] max-[900px]:border-b max-[900px]:border-r-0" style={{ borderColor: theme.node.stroke }}>
                    <div className="mb-3 flex items-start justify-between gap-2">
                        <div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: theme.node.faint }}>工作流图</div><div className="mt-1 truncate text-sm font-semibold">{draft.name}</div><div className="mt-0.5 truncate text-[10px]" style={{ color: theme.node.muted }}>ComfyUI API · {draft.capability === "image" ? "生图" : "视频"}</div></div>
                        <Tooltip title="适应窗口"><Button type="text" size="small" icon={<Maximize2 className="size-3.5" />} onClick={fitGraph} /></Tooltip>
                    </div>
                    <div className="mb-4 grid grid-cols-2 gap-1.5">
                        <SummaryStat label="节点" value={Object.keys(draft.workflow).length} theme={theme} />
                        <SummaryStat label="参数" value={`${draft.parameters.length}`} suffix={invalidParameterCount ? `${invalidParameterCount} 个错误` : "已定义"} theme={theme} />
                        <SummaryStat label="输出" value={draft.outputs.length} suffix="个节点" theme={theme} />
                        <SummaryStat label="状态" value={invalidParameterCount ? "检查" : "可用"} suffix={invalidParameterCount ? "需修复" : "无错误"} danger={Boolean(invalidParameterCount)} theme={theme} />
                    </div>
                    <div className="mb-2 flex items-center justify-between text-[11px] font-semibold"><span>已暴露参数</span><span className="font-normal" style={{ color: theme.node.faint }}>{draft.parameters.length} 个</span></div>
                    <div className="space-y-1.5">
                        {draft.parameters.length ? draft.parameters.map((parameter) => {
                            const binding = parameter.bindings[0];
                            return <button key={`${parameter.key}-${binding?.nodeId}-${binding?.inputKey}`} type="button" className="flex w-full items-center gap-2 rounded-md border px-2 py-2 text-left transition-colors hover:opacity-80" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }} onClick={() => binding && selectNode(binding.nodeId)}><span className="grid size-5 shrink-0 place-items-center rounded border text-[10px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>↳</span><span className="min-w-0 flex-1"><span className="block truncate text-[11px] font-medium">{parameter.label || parameter.key}</span><span className="block truncate font-mono text-[10px]" style={{ color: theme.node.faint }}>{parameter.key}</span></span><span className="text-[9px]" style={{ color: theme.node.muted }}>{binding ? `#${binding.nodeId}` : "待绑定"}</span></button>;
                        }) : <div className="rounded-md border border-dashed p-3 text-center text-[10px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.faint }}>点击图中节点，再从输入字段添加参数</div>}
                    </div>
                    <div className="mt-5 border-t pt-3" style={{ borderColor: theme.node.stroke }}><div className="mb-2 text-[10px] font-semibold" style={{ color: theme.node.muted }}>节点类别</div><div className="space-y-1 text-[10px]" style={{ color: theme.node.muted }}><Legend color="#d7a80d" label="提示词" /><Legend color="#7e65c0" label="采样与处理" /><Legend color="#2e9a60" label="图片输出" /><Legend color="#6786c6" label="模型与输入" /></div></div>
                </aside>

                <section className="relative min-w-0 min-h-0 p-3 max-[900px]:order-1" style={{ background: theme.canvas.background }}>
                    <div className="absolute right-5 top-5 z-10 flex items-center gap-1 rounded-md border p-1" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
                        <Tooltip title="缩小"><Button type="text" size="small" icon={<ZoomOut className="size-3.5" />} onClick={() => zoomGraph(-1)} /></Tooltip>
                        <span className="min-w-10 text-center text-[10px] font-medium tabular-nums" style={{ color: theme.node.muted }}>{Math.round(zoom * 100)}%</span>
                        <Tooltip title="放大"><Button type="text" size="small" icon={<ZoomIn className="size-3.5" />} onClick={() => zoomGraph(1)} /></Tooltip>
                        <Tooltip title="适应窗口"><Button type="text" size="small" icon={<Maximize2 className="size-3.5" />} onClick={fitGraph} /></Tooltip>
                    </div>
                    <div ref={graphRef} className={`h-full min-h-[590px] overflow-hidden rounded-md border ${isPanning ? "cursor-grabbing" : "cursor-grab"}`} style={{ borderColor: theme.node.stroke, background: theme.node.panel }} onWheel={onGraphWheel}>
                        <svg className="block h-full w-full" viewBox={`0 0 ${graph.width} ${graph.height}`} preserveAspectRatio="xMidYMid meet" onPointerDown={onGraphPointerDown} onPointerMove={onGraphPointerMove} onPointerUp={stopPanning} onPointerCancel={stopPanning}>
                            <g transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
                                {graph.edges.map((edge) => <path key={`${edge.from}-${edge.to}`} d={edge.path} fill="none" stroke={theme.node.stroke} strokeWidth="1.6" opacity=".82" />)}
                                {graph.nodes.map((node) => {
                                    const exposedCount = draft.parameters.filter((parameter) => parameter.bindings.some((binding) => binding.nodeId === node.id)).length;
                                    const active = node.id === activeNodeId;
                                    const palette = nodePalette(node.category, theme);
                                    return <g key={node.id} data-workflow-node={node.id} transform={`translate(${node.x} ${node.y})`} onPointerDown={(event) => event.stopPropagation()} onClick={() => selectNode(node.id)} className="cursor-pointer"><rect width={NODE_WIDTH} height={NODE_HEIGHT} rx="9" fill={palette.fill} stroke={active ? theme.node.activeStroke : palette.stroke} strokeWidth={active ? 3 : exposedCount ? 2.5 : 1.2} /><text x="12" y="25" fill={theme.node.text} fontSize="12" fontWeight="700">{truncate(node.title, 20)}</text><text x="12" y="44" fill={theme.node.muted} fontSize="9.5">{truncate(node.node.class_type, 24)}</text><text x="12" y="62" fill={theme.node.faint} fontSize="9" fontFamily="ui-monospace, monospace">节点 #{node.id}</text>{exposedCount ? <text x={NODE_WIDTH - 12} y="62" textAnchor="end" fill={theme.node.text} fontSize="10" fontWeight="800">{exposedCount} 项</text> : null}</g>;
                                })}
                            </g>
                        </svg>
                        <div className="pointer-events-none absolute bottom-3 left-3 rounded border px-2 py-1 text-[10px]" style={{ borderColor: theme.node.stroke, background: theme.node.panel, color: theme.node.muted }}>点击节点查看输入 · 滚轮缩放 · 拖动空白区域平移</div>
                    </div>
                </section>

                <aside className="min-h-0 overflow-y-auto border-l p-3 max-[900px]:order-3 max-[900px]:border-l-0 max-[900px]:border-t" style={{ borderColor: theme.node.stroke }}>
                    {activeNode ? <>
                        <div className="mb-3 flex items-start justify-between gap-2 border-b pb-3" style={{ borderColor: theme.node.stroke }}><div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.08em]" style={{ color: theme.node.faint }}>节点输入</div><div className="mt-1 truncate text-sm font-semibold">{nodeTitle(activeNode)}</div><div className="mt-0.5 truncate font-mono text-[10px]" style={{ color: theme.node.muted }}>#{activeNodeId} · {activeNode.class_type}</div></div><Tag bordered={false} color={exposedParameters.length ? "success" : "default"}>{exposedParameters.length ? `已暴露 ${exposedParameters.length}` : "未暴露"}</Tag></div>
                        <div className="mb-3 rounded-md border px-2.5 py-2 text-[10px] leading-4" style={{ borderColor: theme.node.stroke, background: theme.canvas.background, color: theme.node.muted }}><strong style={{ color: theme.node.text }}>选择输入左侧按钮</strong>，将它添加到工作流参数；参数 key 会用于画布连接绑定。</div>
                        <div className="space-y-2">{Object.entries(activeNode.inputs).map(([inputKey, value]) => <WorkflowInputCard key={inputKey} inputKey={inputKey} value={value} parameter={exposedByInput.get(inputKey)} theme={theme} onToggle={() => toggleInputParameter(inputKey, value)} onChange={(change) => exposedByInput.get(inputKey) && updateParameter(exposedByInput.get(inputKey)!, change)} />)}</div>
                    </> : <div className="rounded-md border border-dashed p-5 text-center text-xs" style={{ borderColor: theme.node.stroke, color: theme.node.faint }}>工作流暂无节点</div>}
                    <div className="mt-4 border-t pt-3 text-[10px] leading-4" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>由上游节点连接提供的输入为只读。保存后，画布连接浮层会读取这里定义的参数名。</div>
                </aside>
            </div>
        </div>
    );
}

function WorkflowInputCard({ inputKey, value, parameter, theme, onToggle, onChange }: { inputKey: string; value: unknown; parameter?: ComfyUiParameter; theme: CanvasTheme; onToggle: () => void; onChange: (change: Partial<ComfyUiParameter>) => void }) {
    const connected = isLink(value);
    const options = parameter?.options?.map((option) => ({ label: String(option.label), value: option.value })) || [];
    const optionText = parameter?.options?.map((option) => String(option.value)).join("\n") || "";
    return <div className={`rounded-md border p-2 ${parameter ? "ring-1" : ""}`} style={{ borderColor: parameter ? theme.node.activeStroke : theme.node.stroke, background: theme.canvas.background, ...(parameter ? { boxShadow: `0 0 0 1px ${theme.node.activeStroke}` } : {}) }}>
        <div className="flex items-start gap-2"><button type="button" className="grid size-5 shrink-0 place-items-center rounded border text-[11px]" style={{ borderColor: parameter ? theme.node.activeStroke : theme.node.stroke, background: parameter ? theme.node.activeStroke : theme.node.panel, color: parameter ? theme.node.panel : theme.node.muted }} disabled={connected} onClick={onToggle} title={connected ? "由上游连接提供" : parameter ? "取消暴露" : "添加为工作流参数"}>{connected ? "·" : parameter ? <Check className="size-3" /> : <Plus className="size-3" />}</button><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-[11px] font-semibold">{inputKey}</span><span className="font-mono text-[9px]" style={{ color: theme.node.faint }}>{parameter ? parameter.key : inferInputType(value)}</span></div><div className="mt-1 truncate text-[10px]" style={{ color: theme.node.muted }}>{connected ? `上游连接 · ${String(value[0])}` : formatValue(value)}</div></div></div>
        {connected ? <div className="mt-2 flex items-center gap-1.5 rounded border border-dashed px-2 py-1.5 text-[10px]" style={{ borderColor: theme.node.stroke, color: theme.node.faint }}><CircleAlert className="size-3" />由上游节点提供，不能直接暴露</div> : null}
        {parameter ? <div className="mt-2 grid gap-2 border-t pt-2" style={{ borderColor: theme.node.stroke }}><div className="grid grid-cols-[minmax(0,1fr)_92px] gap-1.5"><label className="grid gap-1 text-[9px] font-medium" style={{ color: theme.node.muted }}>参数 key<input className="h-7 min-w-0 rounded border bg-transparent px-1.5 text-[10px] outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={parameter.key} onChange={(event) => onChange({ key: event.target.value })} /></label><label className="grid gap-1 text-[9px] font-medium" style={{ color: theme.node.muted }}>类型<Select size="small" value={parameter.type} options={PARAMETER_TYPES} onChange={(type) => onChange({ type, bindings: parameter.bindings.map((binding) => ({ ...binding, valueType: parameterValueType(type) })) })} /></label></div><label className="grid gap-1 text-[9px] font-medium" style={{ color: theme.node.muted }}>显示名称<input className="h-7 rounded border bg-transparent px-1.5 text-[10px] outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={parameter.label} onChange={(event) => onChange({ label: event.target.value })} /></label><label className="grid gap-1 text-[9px] font-medium" style={{ color: theme.node.muted }}>默认值{parameter.type === "boolean" ? <Checkbox checked={Boolean(parameter.defaultValue)} onChange={(event) => onChange({ defaultValue: event.target.checked })}>启用</Checkbox> : parameter.type === "textarea" ? <textarea className="min-h-14 rounded border bg-transparent px-1.5 py-1 text-[10px] outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={String(parameter.defaultValue ?? "")} onChange={(event) => onChange({ defaultValue: event.target.value })} /> : parameter.type === "number" || parameter.type === "seed" ? <InputNumber size="small" className="w-full" value={typeof parameter.defaultValue === "number" ? parameter.defaultValue : undefined} onChange={(value) => onChange({ defaultValue: value ?? undefined })} /> : parameter.type === "select" ? <Select size="small" className="w-full" value={parameter.defaultValue as string | number | undefined} options={options} onChange={(value) => onChange({ defaultValue: value })} /> : <Input size="small" value={String(parameter.defaultValue ?? "")} onChange={(event) => onChange({ defaultValue: event.target.value })} />}</label>{parameter.type === "select" ? <label className="grid gap-1 text-[9px] font-medium" style={{ color: theme.node.muted }}>枚举选项<textarea className="min-h-12 rounded border bg-transparent px-1.5 py-1 text-[10px] outline-none" style={{ borderColor: theme.node.stroke, color: theme.node.text }} value={optionText} onChange={(event) => onChange({ options: event.target.value.split(/\r?\n|,/).map((item) => item.trim()).filter(Boolean).map((item) => ({ label: item, value: item })) })} /></label> : null}<div className="flex flex-wrap items-center justify-between gap-2"><Checkbox checked={parameter.required} onChange={(event) => onChange({ required: event.target.checked })}>必填</Checkbox>{parameter.type === "number" || parameter.type === "seed" ? <Space size={4} wrap><InputNumber size="small" placeholder="最小" value={parameter.min} onChange={(value) => onChange({ min: value ?? undefined })} /><InputNumber size="small" placeholder="最大" value={parameter.max} onChange={(value) => onChange({ max: value ?? undefined })} /><InputNumber size="small" placeholder="步长" value={parameter.step} onChange={(value) => onChange({ step: value ?? undefined })} /></Space> : null}</div></div> : null}
    </div>;
}

function SummaryStat({ label, value, suffix, danger, theme }: { label: string; value: string | number; suffix?: string; danger?: boolean; theme: CanvasTheme }) {
    return <div className="rounded-md border p-2" style={{ borderColor: theme.node.stroke, background: theme.canvas.background }}><div className="text-[9px]" style={{ color: theme.node.faint }}>{label}</div><div className="mt-1 text-sm font-semibold" style={{ color: danger ? "#dc2626" : theme.node.text }}>{value}</div>{suffix ? <div className="truncate text-[9px]" style={{ color: danger ? "#dc2626" : theme.node.muted }}>{suffix}</div> : null}</div>;
}

function Legend({ color, label }: { color: string; label: string }) {
    return <div className="flex items-center gap-2"><span className="size-2 rounded-sm border" style={{ borderColor: color, background: `${color}33` }} />{label}</div>;
}

function buildGraph(workflow: ComfyUiWorkflow["workflow"]): GraphData {
    const ids = Object.keys(workflow);
    const incoming = new Map(ids.map((id) => [id, new Set<string>()]));
    const outgoing = new Map(ids.map((id) => [id, new Set<string>()]));
    ids.forEach((toId) => Object.values(workflow[toId].inputs).forEach((value) => {
        if (!isLink(value) || !workflow[String(value[0])]) return;
        incoming.get(toId)?.add(String(value[0]));
        outgoing.get(String(value[0]))?.add(toId);
    }));
    const layers = new Map<string, number>();
    const visiting = new Set<string>();
    const visit = (id: string): number => {
        if (layers.has(id)) return layers.get(id)!;
        if (visiting.has(id)) return 0;
        visiting.add(id);
        const parents = [...(incoming.get(id) || [])];
        const depth = parents.length ? Math.max(...parents.map((parent) => visit(parent) + 1)) : 0;
        visiting.delete(id);
        layers.set(id, depth);
        return depth;
    };
    ids.forEach(visit);
    const buckets = new Map<number, string[]>();
    ids.forEach((id) => { const level = layers.get(id) || 0; buckets.set(level, [...(buckets.get(level) || []), id]); });
    const orderedLevels = [...buckets.keys()].sort((a, b) => a - b);
    const positions = new Map<string, { x: number; y: number }>();
    orderedLevels.forEach((level) => [...(buckets.get(level) || [])].sort(compareNodeIds).forEach((id, index) => positions.set(id, { x: GRAPH_PADDING + level * (NODE_WIDTH + X_GAP), y: GRAPH_PADDING + index * (NODE_HEIGHT + Y_GAP) })));
    const maxRows = Math.max(1, ...orderedLevels.map((level) => buckets.get(level)?.length || 0));
    const width = GRAPH_PADDING * 2 + Math.max(1, orderedLevels.length) * NODE_WIDTH + Math.max(0, orderedLevels.length - 1) * X_GAP;
    const height = GRAPH_PADDING * 2 + maxRows * NODE_HEIGHT + Math.max(0, maxRows - 1) * Y_GAP;
    const nodes = ids.map((id) => {
        const position = positions.get(id) || { x: GRAPH_PADDING, y: GRAPH_PADDING };
        return { id, node: workflow[id], title: nodeTitle(workflow[id]), category: nodeCategory(workflow[id]), ...position };
    });
    const edges: GraphEdge[] = [];
    ids.forEach((toId) => {
        const seen = new Set<string>();
        incoming.get(toId)?.forEach((fromId) => {
            if (seen.has(fromId)) return;
            seen.add(fromId);
            const from = positions.get(fromId);
            const to = positions.get(toId);
            if (!from || !to) return;
            const x1 = from.x + NODE_WIDTH;
            const y1 = from.y + NODE_HEIGHT / 2;
            const x2 = to.x;
            const y2 = to.y + NODE_HEIGHT / 2;
            const cx = (x1 + x2) / 2;
            edges.push({ from: fromId, to: toId, path: `M ${x1} ${y1} C ${cx} ${y1}, ${cx} ${y2}, ${x2} ${y2}` });
        });
    });
    return { nodes, edges, width, height };
}

function nodeTitle(node: ComfyUiNode) {
    return typeof node._meta?.title === "string" && node._meta.title.trim() ? node._meta.title : node.class_type;
}

function nodeCategory(node: ComfyUiNode): GraphNode["category"] {
    if (/cliptextencode|textencode|prompt/i.test(node.class_type)) return "prompt";
    if (/ksampler|sampler|scheduler/i.test(node.class_type)) return "sampler";
    if (/saveimage|previewimage|vaedecode|image/i.test(node.class_type)) return "image";
    return "input";
}

function nodePalette(category: GraphNode["category"], theme: CanvasTheme) {
    if (category === "prompt") return { fill: theme.canvas.background, stroke: "#d49b00" };
    if (category === "sampler") return { fill: theme.canvas.background, stroke: "#8064c8" };
    if (category === "image") return { fill: theme.canvas.background, stroke: "#2b9b60" };
    return { fill: theme.canvas.background, stroke: "#6185c7" };
}

function suggestedParameterKey(inputKey: string, node: ComfyUiNode, parameters: ComfyUiParameter[]) {
    const aliases: Record<string, string> = { text: /negative/i.test(nodeTitle(node)) ? "negativePrompt" : "prompt", batch_size: "batchSize", sampler_name: "sampler", noise_seed: "seed", filename_prefix: "filenamePrefix" };
    const base = aliases[inputKey] || inputKey.replace(/[^a-zA-Z0-9_-]/g, "_") || "parameter";
    if (!parameters.some((parameter) => parameter.key === base)) return base;
    let index = 2;
    while (parameters.some((parameter) => parameter.key === `${base}_${index}`)) index += 1;
    return `${base}_${index}`;
}

function createParameter(key: string, inputKey: string, value: unknown, nodeId: string): ComfyUiParameter {
    const type = inputType(value, inputKey);
    return { key, label: humanize(inputKey), type, required: false, defaultValue: type === "number" || type === "seed" ? Number(value) : typeof value === "boolean" ? value : String(value ?? ""), bindings: [{ nodeId, inputKey, valueType: parameterValueType(type) }] };
}

function inputType(value: unknown, inputKey: string): ComfyUiParameterType {
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return inputKey === "seed" || inputKey === "noise_seed" ? "seed" : "number";
    return inputKey === "text" || inputKey.toLowerCase().includes("prompt") ? "textarea" : "text";
}

function inferInputType(value: unknown) {
    if (isLink(value)) return "连接";
    if (typeof value === "boolean") return "boolean";
    if (typeof value === "number") return "number";
    if (typeof value === "string") return "string";
    return "未知";
}

function parameterValueType(type: ComfyUiParameterType): ComfyUiValueType {
    if (type === "number" || type === "seed") return "number";
    if (type === "boolean") return "boolean";
    if (type === "select") return "enum";
    return "string";
}

function isLink(value: unknown): value is [string | number, number] {
    return Array.isArray(value) && value.length >= 2 && (typeof value[0] === "string" || typeof value[0] === "number") && typeof value[1] === "number";
}

function formatValue(value: unknown) {
    if (typeof value === "string") return value || "空字符串";
    if (typeof value === "number" || typeof value === "boolean") return String(value);
    return "未设置";
}

function humanize(value: string) {
    const labels: Record<string, string> = { text: "文本", width: "宽度", height: "高度", steps: "采样步数", cfg: "CFG", seed: "Seed", sampler_name: "采样器", scheduler: "调度器", filename_prefix: "文件名前缀", batch_size: "批量数量" };
    if (labels[value]) return labels[value];
    return value.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function truncate(value: string, length: number) {
    return value.length > length ? `${value.slice(0, length - 1)}…` : value;
}

function compareNodeIds(a: string, b: string) {
    const aNumber = Number(a);
    const bNumber = Number(b);
    if (Number.isFinite(aNumber) && Number.isFinite(bNumber)) return aNumber - bNumber;
    return a.localeCompare(b);
}
