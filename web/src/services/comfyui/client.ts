import axios from "axios";
import { nanoid } from "nanoid";

import { findComfyUiWorkflow, comfyUiWorkflowParams, getComfyUiServices } from "@/stores/use-comfyui-store";
import type { ComfyUiNode, ComfyUiParamValue, ComfyUiParameter, ComfyUiService, ComfyUiWorkflow } from "@/types/comfyui";

const POLL_INTERVAL_MS = 2500;

type RequestOptions = { signal?: AbortSignal };
type ComfyUiHistoryEntry = { status?: { completed?: boolean; status_str?: string; messages?: unknown[] }; outputs?: Record<string, Record<string, unknown>> };

export async function testComfyUiService(service: Pick<ComfyUiService, "baseUrl" | "apiKey">) {
    try {
        await comfyRequest(service, "get", "/system_stats");
    } catch (error) {
        if (axios.isAxiosError(error) && error.response?.status === 404) {
            await comfyRequest(service, "get", "/queue");
            return;
        }
        throw comfyError(error, "ComfyUI 连接失败，请检查地址、CORS 或服务状态");
    }
}

export async function runComfyUiImageWorkflow(model: string, prompt: string, params: Record<string, ComfyUiParamValue>, options?: RequestOptions) {
    try {
        const match = findComfyUiWorkflow(getComfyUiServices(), model);
        if (!match) throw new Error("找不到对应的 ComfyUI 工作流，请重新选择模型");
        if (match.workflow.capability !== "image") throw new Error("当前 ComfyUI 工作流不是生图工作流");
        const values = comfyUiWorkflowParams(match.workflow, { ...params, prompt });
        const workflow = applyParameterValues(match.workflow, values);
        const promptId = await queuePrompt(match.service, workflow, options);
        const interrupt = () => { void comfyRequest(match.service, "post", "/interrupt").catch(() => undefined); };
        options?.signal?.addEventListener("abort", interrupt, { once: true });
        if (options?.signal?.aborted) interrupt();
        try {
            const history = await pollHistory(match.service, promptId, options);
            const output = await readImageOutputs(match.service, history, match.workflow.outputs.map((item) => item.nodeId), options);
            if (!output.length) throw new Error("ComfyUI 已完成任务，但没有找到图片输出");
            return output;
        } finally {
            options?.signal?.removeEventListener("abort", interrupt);
        }
    } catch (error) {
        throw comfyError(error, "ComfyUI 生图失败");
    }
}

export async function testComfyUiWorkflow(service: ComfyUiService, workflow: ComfyUiWorkflow, params: Record<string, ComfyUiParamValue>, options?: RequestOptions) {
    try {
        const values = comfyUiWorkflowParams(workflow, params);
        const promptId = await queuePrompt(service, applyParameterValues(workflow, values), options);
        const history = await pollHistory(service, promptId, options);
        const outputs = await readImageOutputs(service, history, workflow.outputs.map((item) => item.nodeId), options);
        if (!outputs.length) throw new Error("测试完成，但没有找到配置的图片输出节点");
        return outputs;
    } catch (error) {
        throw comfyError(error, "ComfyUI 工作流测试失败");
    }
}

function applyParameterValues(workflow: ComfyUiWorkflow, values: Record<string, ComfyUiParamValue>) {
    const cloned = JSON.parse(JSON.stringify(workflow.workflow)) as Record<string, ComfyUiNode>;
    for (const parameter of workflow.parameters) {
        const value = values[parameter.key];
        if (value === undefined) {
            if (parameter.required) throw new Error(`请填写参数：${parameter.label}`);
            continue;
        }
        for (const binding of parameter.bindings) {
            const node = cloned[binding.nodeId];
            if (node) node.inputs[binding.inputKey] = coerceValue(value, binding.valueType, parameter);
        }
    }
    return cloned;
}

function coerceValue(value: ComfyUiParamValue, valueType: ComfyUiParameter["bindings"][number]["valueType"], parameter: ComfyUiParameter) {
    if (valueType === "number") {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`参数 ${parameter.label} 必须是数字`);
        if (parameter.type === "seed" && number < 0) return Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
        return number;
    }
    if (valueType === "boolean") return typeof value === "string" ? value.toLowerCase() === "true" : Boolean(value);
    return value;
}

async function queuePrompt(service: ComfyUiService, workflow: Record<string, ComfyUiNode>, options?: RequestOptions) {
    const response = await comfyRequest<{ prompt_id?: string; node_errors?: Record<string, unknown> }>(service, "post", "/prompt", { prompt: workflow, client_id: nanoid() }, options);
    if (!response.prompt_id) {
        const nodeError = response.node_errors ? JSON.stringify(response.node_errors) : "";
        throw new Error(nodeError || "ComfyUI 未返回 prompt_id");
    }
    return response.prompt_id;
}

async function pollHistory(service: ComfyUiService, promptId: string, options?: RequestOptions) {
    for (;;) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const payload = await comfyRequest<Record<string, ComfyUiHistoryEntry> | ComfyUiHistoryEntry>(service, "get", `/history/${encodeURIComponent(promptId)}`, undefined, options);
        const entry = isHistoryEntry(payload) ? payload : payload[promptId];
        if (entry?.status?.completed) return entry;
        if (entry?.status?.status_str === "error" || entry?.status?.status_str === "failed") throw new Error(readHistoryError(entry) || "ComfyUI 执行失败");
        await delay(POLL_INTERVAL_MS, options?.signal);
    }
}

async function readImageOutputs(service: ComfyUiService, history: ComfyUiHistoryEntry, outputNodeIds: string[], options?: RequestOptions) {
    const outputs = history.outputs || {};
    const entries = outputNodeIds.flatMap((nodeId) => Array.isArray(outputs[nodeId]?.images) ? outputs[nodeId].images as Array<Record<string, unknown>> : []);
    return Promise.all(entries.map(async (entry) => {
        const filename = typeof entry.filename === "string" ? entry.filename : "";
        if (!filename) return null;
        const params = new URLSearchParams({ filename, subfolder: typeof entry.subfolder === "string" ? entry.subfolder : "", type: typeof entry.type === "string" ? entry.type : "output" });
        const blob = await comfyRequest<Blob>(service, "get", `/view?${params.toString()}`, undefined, options, "blob");
        return { id: nanoid(), dataUrl: await blobToDataUrl(blob) };
    })).then((items) => items.filter((item): item is { id: string; dataUrl: string } => Boolean(item)));
}

async function comfyRequest<T = unknown>(service: Pick<ComfyUiService, "baseUrl" | "apiKey">, method: "get" | "post", path: string, data?: unknown, options?: RequestOptions, responseType: "json" | "blob" = "json") {
    const response = await axios.request<T>({ method, url: comfyUrl(service.baseUrl, path), data, responseType, headers: service.apiKey.trim() ? { Authorization: `Bearer ${service.apiKey.trim()}` } : undefined, signal: options?.signal });
    return response.data;
}

function comfyUrl(baseUrl: string, path: string) {
    const base = baseUrl.trim().replace(/\/+$/, "");
    return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

function comfyError(error: unknown, fallback: string) {
    if (error instanceof DOMException && error.name === "AbortError") return error;
    if (axios.isAxiosError(error)) {
        if (error.response?.status === 401 || error.response?.status === 403) return new Error("ComfyUI 鉴权失败，请检查 API Key");
        if (!error.response) return new Error("无法连接 ComfyUI，请检查地址和 CORS 配置");
        return new Error(`${fallback}（HTTP ${error.response.status}）`);
    }
    return error instanceof Error ? error : new Error(fallback);
}

function readHistoryError(entry: ComfyUiHistoryEntry) {
    return (entry.status?.messages || []).flatMap((message) => Array.isArray(message) ? message : []).map((item) => (item as Record<string, unknown>)?.exception_message || (item as Record<string, unknown>)?.message).find((item): item is string => typeof item === "string");
}

function isHistoryEntry(value: unknown): value is ComfyUiHistoryEntry {
    return Boolean(value && typeof value === "object" && ("outputs" in value || "status" in value));
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error || new Error("ComfyUI 图片读取失败"));
        reader.readAsDataURL(blob);
    });
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) return reject(new DOMException("Aborted", "AbortError"));
        const timer = window.setTimeout(resolve, ms);
        signal?.addEventListener("abort", () => { window.clearTimeout(timer); reject(new DOMException("Aborted", "AbortError")); }, { once: true });
    });
}
