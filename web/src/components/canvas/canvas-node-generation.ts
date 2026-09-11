import type { AiTextMessage } from "@/services/api/image";
import i18n from "@/i18n";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, getGroupResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import type { ComfyUiParamValue, ComfyUiParameter, ComfyUiWorkflow } from "@/types/comfyui";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

type NodeGenerationResourceInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

type NodeGenerationGroupInput = {
    nodeId: string;
    type: "group";
    title: string;
    children: NodeGenerationResourceInput[];
};

export type NodeGenerationInput = NodeGenerationResourceInput | NodeGenerationGroupInput;

export type ComfyUiConnectionParameterError = {
    code: "missingParameter" | "unsupportedSource" | "conflict" | "invalidNumber" | "invalidBoolean" | "invalidOption" | "outOfRange";
    key: string;
    label: string;
    sourceNodeIds: string[];
};

export type ComfyUiConnectionParameterResult = {
    values: Record<string, ComfyUiParamValue>;
    bindings: Record<string, string[]>;
    excludedNodeIds: Set<string>;
    errors: ComfyUiConnectionParameterError[];
};

export function findMissingComfyUiRequiredParameter(workflow: ComfyUiWorkflow, values: Record<string, ComfyUiParamValue> | undefined, prompt: string) {
    return workflow.parameters.find((parameter) => {
        if (!parameter.required) return false;
        const value = parameter.key === "prompt" ? prompt : values?.[parameter.key] ?? parameter.defaultValue;
        return value === undefined || (typeof value === "string" && !value.trim());
    });
}

export function buildComfyUiConnectionParameterValues(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], workflow: ComfyUiWorkflow): ComfyUiConnectionParameterResult {
    const parametersByKey = new Map(workflow.parameters.map((parameter) => [parameter.key, parameter]));
    const grouped = new Map<string, { parameter: ComfyUiParameter; values: string[]; sourceNodeIds: string[] }>();
    const resolvedValues: Record<string, ComfyUiParamValue> = {};
    const bindings: Record<string, string[]> = {};
    const excludedNodeIds = new Set<string>();
    const errors: ComfyUiConnectionParameterError[] = [];

    connections
        .filter((connection) => connection.toNodeId === nodeId && Boolean(connection.parameterKey))
        .forEach((connection) => {
            const key = connection.parameterKey!;
            const parameter = parametersByKey.get(key);
            const source = nodes.find((node) => node.id === connection.fromNodeId);
            if (!parameter) {
                errors.push({ code: "missingParameter", key, label: key, sourceNodeIds: [connection.fromNodeId] });
                return;
            }
            if (!source || source.type !== CanvasNodeType.Text) {
                errors.push({ code: "unsupportedSource", key, label: parameter.label, sourceNodeIds: [connection.fromNodeId] });
                return;
            }

            excludedNodeIds.add(source.id);
            const current = grouped.get(key) || { parameter, values: [], sourceNodeIds: [] };
            current.values.push(source.metadata?.content || source.metadata?.prompt || "");
            current.sourceNodeIds.push(source.id);
            grouped.set(key, current);
        });

    grouped.forEach(({ parameter, values: sourceValues, sourceNodeIds }, key) => {
        bindings[key] = sourceNodeIds;
        const valueType = parameter.bindings[0]?.valueType || parameterValueType(parameter);
        const nonEmptyValues = sourceValues.map((value) => value.trim()).filter(Boolean);
        if (valueType === "string") {
            if (nonEmptyValues.length) return void (resolvedValues[key] = nonEmptyValues.join("\n\n"));
            return;
        }
        if (sourceNodeIds.length > 1) {
            errors.push({ code: "conflict", key, label: parameter.label, sourceNodeIds });
            return;
        }
        const value = nonEmptyValues[0];
        if (!value) return;
        if (valueType === "number") {
            const number = Number(value);
            if (!Number.isFinite(number)) errors.push({ code: "invalidNumber", key, label: parameter.label, sourceNodeIds });
            else if ((parameter.min !== undefined && number < parameter.min) || (parameter.max !== undefined && number > parameter.max)) errors.push({ code: "outOfRange", key, label: parameter.label, sourceNodeIds });
            else resolvedValues[key] = number;
            return;
        }
        if (valueType === "boolean") {
            if (!/^(true|false)$/i.test(value)) errors.push({ code: "invalidBoolean", key, label: parameter.label, sourceNodeIds });
            else resolvedValues[key] = value.toLowerCase() === "true";
            return;
        }
        if (parameter.options?.length && !parameter.options.some((option) => String(option.value) === value)) errors.push({ code: "invalidOption", key, label: parameter.label, sourceNodeIds });
        else resolvedValues[key] = value;
    });

    return { values: resolvedValues, bindings, excludedNodeIds, errors };
}

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, excludedNodeIds: ReadonlySet<string> = new Set()): NodeGenerationContext {
    const inputs = filterGenerationInputs(buildNodeGenerationInputs(nodeId, nodes, connections), excludedNodeIds);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt, sourceNode.metadata.referenceNodeIds || (sourceNode.metadata.referenceNodeId ? [sourceNode.metadata.referenceNodeId] : []));
    }

    const resourceInputs = flattenGenerationInputs(inputs);
    let textIndex = 0;
    const upstreamText = resourceInputs.flatMap((input) => (input.text ? [textBlock(generationLabel("text", textIndex++), input.text)] : [])).join("\n\n");
    const referenceImages = resourceInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = resourceInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = resourceInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: resourceInputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function filterGenerationInputs(inputs: NodeGenerationInput[], excludedNodeIds: ReadonlySet<string>) {
    if (!excludedNodeIds.size) return inputs;
    return inputs.flatMap((input) => {
        if (input.type === "group") {
            const children = input.children.filter((child) => !excludedNodeIds.has(child.nodeId));
            return children.length ? [{ ...input, children }] : [];
        }
        return excludedNodeIds.has(input.nodeId) ? [] : [input];
    });
}

function parameterValueType(parameter: ComfyUiParameter) {
    if (parameter.type === "number" || parameter.type === "seed") return "number" as const;
    if (parameter.type === "boolean") return "boolean" as const;
    return parameter.type === "select" ? "enum" as const : "string" as const;
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, referenceNodeIds: string[] = []): NodeGenerationContext {
    const inputByNodeId = new Map(inputs.map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationResourceInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        hasToken = true;
        nextPrompt += prompt.slice(lastIndex, match.index);
        const input = inputByNodeId.get(match[1]);
        if (input) {
            const labels = flattenGenerationInputs([input]).map((resource) => {
                let label = labelByNodeId.get(resource.nodeId);
                if (!label) {
                    label = generationLabel(resource.type, counts[resource.type]++);
                    labelByNodeId.set(resource.nodeId, label);
                    if (resource.type === "text") textBlocks.push(textBlock(label, resource.text || ""));
                    else selectedInputs.push(resource);
                }
                return resource.type === "text" ? `【${label}】` : label;
            });
            nextPrompt += labels.join("、");
        }
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    if (referenceNodeIds.length && !selectedInputs.some((input) => input.type === "image")) {
        referenceNodeIds
            .map((nodeId) => inputByNodeId.get(nodeId))
            .filter((input): input is NodeGenerationInput => Boolean(input))
            .flatMap((input) => (input.type === "group" ? input.children : [input]))
            .filter((input) => input.type === "image")
            .forEach((input) => {
                if (!selectedInputs.some((selected) => selected.nodeId === input.nodeId)) selectedInputs.push(input);
            });
    }
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    if (!hasToken) {
        return {
            prompt,
            referenceImages: [],
            referenceVideos: [],
            referenceAudios: [],
            textCount: 0,
            imageCount: 0,
            videoCount: 0,
            audioCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        if (node.type === CanvasNodeType.Group) {
            const children = getGroupResourceNodes(node.id, nodes).flatMap(readNodeGenerationResource);
            return children.length ? [{ nodeId: node.id, type: "group", title: node.title, children }] : [];
        }
        return readNodeGenerationResource(node);
    });
}

function flattenGenerationInputs(inputs: NodeGenerationInput[]) {
    const resources = inputs.flatMap((input) => (input.type === "group" ? input.children : [input]));
    return [...new Map(resources.map((input) => [input.nodeId, input])).values()];
}

function readNodeGenerationResource(node: CanvasNodeData): NodeGenerationResourceInput[] {
    const image = readReferenceImage(node);
    if (image) return [{ nodeId: node.id, type: "image", title: node.title, image }];
    const video = readReferenceVideo(node);
    if (video) return [{ nodeId: node.id, type: "video", title: node.title, video }];
    const audio = readReferenceAudio(node);
    if (audio) return [{ nodeId: node.id, type: "audio", title: node.title, audio }];
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    if (resource?.kind === "image" && resource.url) return [{ nodeId: node.id, type: "image", title: node.title, image: { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata?.mimeType || "image/png", dataUrl: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "video" && resource.url) return [{ nodeId: node.id, type: "video", title: node.title, video: { id: node.id, name: `${node.title || node.id}.mp4`, type: node.metadata?.mimeType || "video/mp4", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "audio" && resource.url) return [{ nodeId: node.id, type: "audio", title: node.title, audio: { id: node.id, name: `${node.title || node.id}.mp3`, type: node.metadata?.mimeType || "audio/mpeg", url: resource.url, storageKey: node.metadata?.storageKey } }];
    if (resource?.kind === "text" && resource.text) return [{ nodeId: node.id, type: "text", title: node.title, text: resource.text }];
    const text = readNodeTextInput(node);
    return text ? [{ nodeId: node.id, type: "text", title: node.title, text }] : [];
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return node.metadata?.prompt || "";
}

function textBlock(label: string, text: string) {
    return `【${label}】\n${text}`;
}

function generationLabel(type: NodeGenerationResourceInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return i18n.t("canvas.configNode.videoReferences") + ` ${index + 1}`;
    if (type === "audio") return i18n.t("canvas.configNode.audioReferences") + ` ${index + 1}`;
    return i18n.t("canvas.composer.resources.text", { index: index + 1 });
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (node.type !== CanvasNodeType.Image || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata.mimeType || "image/png",
        dataUrl: node.metadata.content,
        storageKey: node.metadata.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    if (node.type !== CanvasNodeType.Video || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata.mimeType || "video/mp4",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        bytes: node.metadata.bytes,
        width: node.metadata.naturalWidth,
        height: node.metadata.naturalHeight,
        durationMs: node.metadata.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    if (node.type !== CanvasNodeType.Audio || !node.metadata?.content) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata.mimeType || "audio/mpeg",
        url: node.metadata.content,
        storageKey: node.metadata.storageKey,
        durationMs: node.metadata.durationMs,
    };
}
