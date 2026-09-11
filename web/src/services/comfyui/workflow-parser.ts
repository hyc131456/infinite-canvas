import { nanoid } from "nanoid";

import type { ComfyUiCapability, ComfyUiInputBinding, ComfyUiNode, ComfyUiOutputBinding, ComfyUiParameter, ComfyUiWorkflow } from "@/types/comfyui";

export function parseComfyUiWorkflow(value: unknown, options?: { name?: string; capability?: ComfyUiCapability }) {
    if (!isRecord(value) || !Object.keys(value).length) throw new Error("ComfyUI 工作流必须是非空对象");
    const workflow = Object.entries(value).reduce<Record<string, ComfyUiNode>>((result, [nodeId, node]) => {
        if (!isRecord(node) || typeof node.class_type !== "string" || !isRecord(node.inputs)) throw new Error(`节点 ${nodeId} 缺少 class_type 或 inputs`);
        result[nodeId] = {
            class_type: node.class_type,
            inputs: { ...node.inputs },
            ...(isRecord(node._meta) ? { _meta: { ...node._meta } } : {}),
        };
        return result;
    }, {});
    const capability = options?.capability || detectCapability(workflow);
    const now = new Date().toISOString();
    return {
        id: nanoid(),
        name: options?.name?.trim() || "ComfyUI 工作流",
        capability,
        workflow,
        parameters: detectParameters(workflow),
        outputs: detectComfyUiOutputs(workflow, capability),
        createdAt: now,
        updatedAt: now,
    } satisfies ComfyUiWorkflow;
}

export function validateComfyUiWorkflow(workflow: ComfyUiWorkflow) {
    if (!workflow.name.trim()) return "请填写工作流名称";
    if (!Object.keys(workflow.workflow).length) return "工作流不能为空";
    const keys = new Set<string>();
    for (const parameter of workflow.parameters) {
        if (!/^[a-zA-Z_][a-zA-Z0-9_-]{0,63}$/.test(parameter.key)) return `参数 ${parameter.label || parameter.key} 的机器名无效`;
        if (keys.has(parameter.key)) return `参数机器名重复：${parameter.key}`;
        keys.add(parameter.key);
        if ((parameter.type === "number" || parameter.type === "seed") && parameter.min !== undefined && parameter.max !== undefined && parameter.min > parameter.max) return `参数 ${parameter.label} 的最小值不能大于最大值`;
        if ((parameter.type === "number" || parameter.type === "seed") && parameter.step !== undefined && (!Number.isFinite(parameter.step) || parameter.step <= 0)) return `参数 ${parameter.label} 的步进必须大于 0`;
        if (parameter.type === "select" && !parameter.options?.length) return `参数 ${parameter.label} 至少需要一个选项`;
        for (const binding of parameter.bindings) {
            const node = workflow.workflow[binding.nodeId];
            if (!node) return `参数 ${parameter.label} 绑定的节点 ${binding.nodeId} 不存在`;
            if (!(binding.inputKey in node.inputs)) return `节点 ${binding.nodeId} 不存在输入 ${binding.inputKey}`;
            if (!isBindingCompatible(node.inputs[binding.inputKey], binding.valueType)) return `参数 ${parameter.label} 绑定的输入类型不匹配或已被节点连线占用`;
        }
        if (!parameter.bindings.length) return `参数 ${parameter.label} 尚未绑定节点输入`;
    }
    if (!workflow.outputs.length) return "请至少选择一个输出节点";
    for (const output of workflow.outputs) {
        if (!workflow.workflow[output.nodeId]) return `输出节点 ${output.nodeId} 不存在`;
        if (output.type !== workflow.capability) return `输出节点 ${output.nodeId} 的类型与工作流能力不一致`;
    }
    return null;
}

function detectParameters(workflow: Record<string, ComfyUiNode>): ComfyUiParameter[] {
    const parameters: ComfyUiParameter[] = [];
    const textNodes = Object.entries(workflow).filter(([, node]) => node.class_type.toLowerCase().includes("cliptextencode") && typeof node.inputs.text === "string");
    const positiveIds = new Set(findSamplerLinks(workflow, "positive"));
    const negativeIds = new Set(findSamplerLinks(workflow, "negative"));
    const positive = textNodes.find(([id]) => positiveIds.has(id)) || textNodes[0];
    const negative = textNodes.find(([id]) => negativeIds.has(id)) || textNodes.find(([id]) => id !== positive?.[0]);
    if (positive) parameters.push(parameter("prompt", "正面提示词", "textarea", true, positive[0], "text", ""));
    if (negative) parameters.push(parameter("negativePrompt", "负面提示词", "textarea", false, negative[0], "text", "blurry ugly bad"));

    const latent = Object.entries(workflow).find(([, node]) => /emptylatentimage/i.test(node.class_type) && hasNumberInput(node.inputs, "width") && hasNumberInput(node.inputs, "height"));
    if (latent) {
        parameters.push(parameter("width", "宽度", "number", false, latent[0], "width", numberValue(latent[1].inputs.width, 1024), { min: 1, step: 16 }));
        parameters.push(parameter("height", "高度", "number", false, latent[0], "height", numberValue(latent[1].inputs.height, 1024), { min: 1, step: 16 }));
        if (hasNumberInput(latent[1].inputs, "batch_size")) parameters.push(parameter("batchSize", "批量数量", "number", false, latent[0], "batch_size", numberValue(latent[1].inputs.batch_size, 1), { min: 1, step: 1 }));
    }

    const sampler = Object.entries(workflow).find(([, node]) => /ksampler/i.test(node.class_type));
    if (sampler) {
        const [nodeId, node] = sampler;
        if ("seed" in node.inputs) parameters.push(parameter("seed", "Seed", "seed", false, nodeId, "seed", numberValue(node.inputs.seed, -1)));
        else if ("noise_seed" in node.inputs) parameters.push(parameter("seed", "Seed", "seed", false, nodeId, "noise_seed", numberValue(node.inputs.noise_seed, -1)));
        if (hasNumberInput(node.inputs, "steps")) parameters.push(parameter("steps", "采样步数", "number", false, nodeId, "steps", numberValue(node.inputs.steps, 28), { min: 1, step: 1 }));
        if (hasNumberInput(node.inputs, "cfg")) parameters.push(parameter("cfg", "CFG", "number", false, nodeId, "cfg", numberValue(node.inputs.cfg, 3.5), { min: 0, step: 0.1 }));
        if (typeof node.inputs.sampler_name === "string") parameters.push(parameter("sampler", "采样器", "select", false, nodeId, "sampler_name", node.inputs.sampler_name, { options: [{ label: node.inputs.sampler_name, value: node.inputs.sampler_name }] }));
        if (typeof node.inputs.scheduler === "string") parameters.push(parameter("scheduler", "调度器", "select", false, nodeId, "scheduler", node.inputs.scheduler, { options: [{ label: node.inputs.scheduler, value: node.inputs.scheduler }] }));
        if (hasNumberInput(node.inputs, "denoise")) parameters.push(parameter("denoise", "去噪强度", "number", false, nodeId, "denoise", numberValue(node.inputs.denoise, 1), { min: 0, max: 1, step: 0.05 }));
    }
    return parameters;
}

export function detectComfyUiOutputs(workflow: Record<string, ComfyUiNode>, capability: ComfyUiCapability): ComfyUiOutputBinding[] {
    return Object.entries(workflow)
        .filter(([, node]) => capability === "image" ? isImageOutputNode(node) : isComfyUiVideoOutputNode(node))
        .map(([nodeId, node]) => ({ nodeId, type: capability, filenameKey: typeof node.inputs.filename_prefix === "string" ? "filename_prefix" : undefined }));
}

function detectCapability(workflow: Record<string, ComfyUiNode>): ComfyUiCapability {
    return Object.values(workflow).some(isComfyUiVideoOutputNode) ? "video" : "image";
}

function isImageOutputNode(node: ComfyUiNode) {
    return /saveimage|previewimage/i.test(node.class_type);
}

export function isComfyUiVideoOutputNode(node: ComfyUiNode) {
    const title = typeof node._meta?.title === "string" ? node._meta.title : "";
    return /savevideo|videocombine|vhs_videocombine/i.test(`${node.class_type} ${title}`)
        || (typeof node.inputs.format === "string" && node.inputs.format.toLowerCase().startsWith("video/"));
}

function findSamplerLinks(workflow: Record<string, ComfyUiNode>, inputKey: string) {
    return Object.values(workflow).flatMap((node) => {
        if (!/ksampler/i.test(node.class_type)) return [];
        const value = node.inputs[inputKey];
        return isLink(value) ? [String(value[0])] : [];
    });
}

function parameter(key: string, label: string, type: ComfyUiParameter["type"], required: boolean, nodeId: string, inputKey: string, defaultValue: string | number, extra?: Partial<ComfyUiParameter>): ComfyUiParameter {
    const valueType = type === "number" || type === "seed" ? "number" : type === "boolean" ? "boolean" : type === "select" ? "enum" : "string";
    return { key, label, type, required, defaultValue, bindings: [{ nodeId, inputKey, valueType }], ...extra };
}

function isRecord(value: unknown): value is Record<string, any> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function isLink(value: unknown): value is [string | number, number] {
    return Array.isArray(value) && value.length >= 2 && (typeof value[0] === "string" || typeof value[0] === "number");
}

function hasNumberInput(inputs: Record<string, unknown>, key: string) {
    return key in inputs && (typeof inputs[key] === "number" || typeof inputs[key] === "string");
}

function numberValue(value: unknown, fallback: number) {
    const result = Number(value);
    return Number.isFinite(result) ? result : fallback;
}

function isBindingCompatible(value: unknown, valueType: ComfyUiInputBinding["valueType"]) {
    if (Array.isArray(value) || value === null || value === undefined) return false;
    if (valueType === "number") return typeof value === "number" || (typeof value === "string" && Number.isFinite(Number(value)));
    if (valueType === "boolean") return typeof value === "boolean";
    return typeof value === "string" || typeof value === "number";
}
