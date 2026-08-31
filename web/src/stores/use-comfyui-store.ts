import { nanoid } from "nanoid";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import type { ComfyUiCapability, ComfyUiConfig, ComfyUiParamValue, ComfyUiService, ComfyUiWorkflow } from "@/types/comfyui";
import { localForageStorage } from "@/lib/localforage-storage";

export const COMFYUI_STORE_KEY = "infinite-canvas:comfyui_config";
export const COMFYUI_MODEL_PREFIX = "comfyui::";

type ComfyUiStore = ComfyUiConfig & {
    addService: (service?: Partial<ComfyUiService>) => ComfyUiService;
    updateService: (id: string, patch: Partial<ComfyUiService>) => void;
    removeService: (id: string) => void;
    upsertWorkflow: (serviceId: string, workflow: ComfyUiWorkflow) => void;
    removeWorkflow: (serviceId: string, workflowId: string) => void;
};

const storage = createJSONStorage(() => localForageStorage);

export const useComfyUiStore = create<ComfyUiStore>()(
    persist(
        (set, get) => ({
            services: [],
            addService: (service) => {
                const next: ComfyUiService = {
                    id: service?.id?.trim() || nanoid(),
                    name: service?.name?.trim() || "ComfyUI 本地",
                    baseUrl: service?.baseUrl?.trim() || "http://127.0.0.1:8188",
                    apiKey: service?.apiKey || "",
                    enabled: service?.enabled ?? true,
                    workflows: service?.workflows || [],
                    lastTestedAt: service?.lastTestedAt,
                    lastTestStatus: service?.lastTestStatus,
                };
                set((state) => ({ services: [...state.services, next] }));
                return next;
            },
            updateService: (id, patch) => set((state) => ({ services: state.services.map((service) => (service.id === id ? { ...service, ...patch } : service)) })),
            removeService: (id) => set((state) => ({ services: state.services.filter((service) => service.id !== id) })),
            upsertWorkflow: (serviceId, workflow) =>
                set((state) => ({
                    services: state.services.map((service) =>
                        service.id === serviceId ? { ...service, workflows: [...service.workflows.filter((item) => item.id !== workflow.id), workflow] } : service,
                    ),
                })),
            removeWorkflow: (serviceId, workflowId) =>
                set((state) => ({ services: state.services.map((service) => (service.id === serviceId ? { ...service, workflows: service.workflows.filter((workflow) => workflow.id !== workflowId) } : service)) })),
        }),
        {
            name: COMFYUI_STORE_KEY,
            storage,
            partialize: (state) => ({ services: state.services }),
        },
    ),
);

export function comfyUiModelValue(serviceId: string, workflowId: string) {
    return `${COMFYUI_MODEL_PREFIX}${serviceId}::${workflowId}`;
}

export function parseComfyUiModelValue(value: string) {
    if (!value.startsWith(COMFYUI_MODEL_PREFIX)) return null;
    const parts = value.slice(COMFYUI_MODEL_PREFIX.length).split("::");
    if (parts.length < 2) return null;
    return { serviceId: parts[0], workflowId: parts.slice(1).join("::") };
}

export function isComfyUiModelValue(value: string) {
    return Boolean(parseComfyUiModelValue(value));
}

export function findComfyUiWorkflow(services: ComfyUiService[], value: string) {
    const parsed = parseComfyUiModelValue(value);
    if (!parsed) return null;
    const service = services.find((item) => item.id === parsed.serviceId);
    const workflow = service?.workflows.find((item) => item.id === parsed.workflowId);
    return service && workflow ? { service, workflow } : null;
}

export function comfyUiModelOptions(services: ComfyUiService[], capability?: ComfyUiCapability) {
    return services
        .filter((service) => service.enabled)
        .flatMap((service) => service.workflows.filter((workflow) => !capability || workflow.capability === capability).map((workflow) => comfyUiModelValue(service.id, workflow.id)));
}

export function comfyUiModelLabel(services: ComfyUiService[], value: string) {
    const match = findComfyUiWorkflow(services, value);
    return match ? `${match.workflow.name}（${match.service.name}）` : value;
}

export function comfyUiWorkflowParams(workflow: ComfyUiWorkflow, values: Record<string, ComfyUiParamValue> | undefined) {
    return workflow.parameters.reduce<Record<string, ComfyUiParamValue>>((params, parameter) => {
        const value = values?.[parameter.key] ?? parameter.defaultValue;
        if (value !== undefined) params[parameter.key] = value;
        return params;
    }, {});
}

export function comfyUiStoreConfig(): ComfyUiConfig {
    return { services: getComfyUiServices() };
}

export function getComfyUiServices() {
    return useComfyUiStore.getState().services;
}
