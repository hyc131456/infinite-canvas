import { saveAs } from "file-saver";

import i18n from "@/i18n";
import { useConfigStore, type AiConfig, type WebdavSyncConfig } from "@/stores/use-config-store";
import { usePromptSourceStore, type PromptSourceSchedule } from "@/stores/use-prompt-source-store";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import type { PromptSource } from "@/services/api/prompt-source-presets";
import type { ComfyUiConfig, ComfyUiWorkflow } from "@/types/comfyui";
import { validateComfyUiWorkflow } from "@/services/comfyui/workflow-parser";

type AppConfigFile = {
    app: "infinite-canvas";
    version: 1;
    exportedAt: string;
    config: AiConfig;
    webdav: WebdavSyncConfig;
    promptSources: {
        sources: PromptSource[];
        schedule: PromptSourceSchedule;
    };
    comfyui: ComfyUiConfig;
};

export function exportAppConfig() {
    const { config, webdav } = useConfigStore.getState();
    const { sources, schedule } = usePromptSourceStore.getState();
    const { services } = useComfyUiStore.getState();
    const data: AppConfigFile = { app: "infinite-canvas", version: 1, exportedAt: new Date().toISOString(), config, webdav, promptSources: { sources, schedule }, comfyui: { services } };
    saveAs(new Blob([JSON.stringify(data, null, 2)], { type: "application/json;charset=utf-8" }), "infinite-canvas-config.json");
}

export async function importAppConfig(file: File) {
    let data: AppConfigFile;
    try {
        data = JSON.parse(await file.text()) as AppConfigFile;
    } catch {
        throw new Error(i18n.t("config.invalidFile"));
    }
    if (!isValidConfigFile(data)) throw new Error(i18n.t("config.invalidFile"));
    useConfigStore.setState({ config: data.config, webdav: data.webdav });
    usePromptSourceStore.setState(data.promptSources);
    useComfyUiStore.setState({ services: data.comfyui.services });
}

function isValidConfigFile(data: AppConfigFile) {
    return Boolean(
        data?.app === "infinite-canvas"
        && data.version === 1
        && data.config
        && Array.isArray(data.config.channels)
        && data.webdav
        && data.promptSources
        && Array.isArray(data.promptSources.sources)
        && data.comfyui
        && Array.isArray(data.comfyui.services)
        && data.comfyui.services.every((service) => service
            && typeof service.id === "string"
            && typeof service.name === "string"
            && typeof service.baseUrl === "string"
            && typeof service.apiKey === "string"
            && typeof service.enabled === "boolean"
            && Array.isArray(service.workflows)
            && service.workflows.every(isValidComfyUiWorkflow)),
    );
}

function isValidComfyUiWorkflow(workflow: ComfyUiWorkflow) {
    return Boolean(
        workflow
        && typeof workflow.id === "string"
        && typeof workflow.name === "string"
        && (workflow.capability === "image" || workflow.capability === "video")
        && isRecord(workflow.workflow)
        && Object.values(workflow.workflow).every((node) => isRecord(node) && typeof node.class_type === "string" && isRecord(node.inputs))
        && Array.isArray(workflow.parameters)
        && workflow.parameters.every((parameter) => parameter && typeof parameter.key === "string" && typeof parameter.label === "string" && Array.isArray(parameter.bindings) && parameter.bindings.every((binding) => binding && typeof binding.nodeId === "string" && typeof binding.inputKey === "string"))
        && Array.isArray(workflow.outputs)
        && workflow.outputs.every((output) => output && typeof output.nodeId === "string" && (output.type === "image" || output.type === "video"))
        && validateComfyUiWorkflow(workflow) === null,
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return Boolean(value && typeof value === "object" && !Array.isArray(value));
}
