export type ComfyUiCapability = "image" | "video";
export type ComfyUiParameterType = "text" | "textarea" | "number" | "select" | "boolean" | "seed";
export type ComfyUiValueType = "string" | "number" | "boolean" | "enum";

export type ComfyUiNode = {
    class_type: string;
    inputs: Record<string, unknown>;
    _meta?: Record<string, unknown>;
};

export type ComfyUiWorkflow = {
    id: string;
    name: string;
    capability: ComfyUiCapability;
    workflow: Record<string, ComfyUiNode>;
    parameters: ComfyUiParameter[];
    outputs: ComfyUiOutputBinding[];
    createdAt: string;
    updatedAt: string;
    lastTestedAt?: string;
    lastTestStatus?: "success" | "failed";
};

export type ComfyUiParameter = {
    key: string;
    label: string;
    type: ComfyUiParameterType;
    required: boolean;
    defaultValue?: string | number | boolean;
    placeholder?: string;
    min?: number;
    max?: number;
    step?: number;
    options?: Array<{ label: string; value: string | number }>;
    bindings: ComfyUiInputBinding[];
};

export type ComfyUiInputBinding = {
    nodeId: string;
    inputKey: string;
    valueType: ComfyUiValueType;
};

export type ComfyUiOutputBinding = {
    nodeId: string;
    type: ComfyUiCapability;
    filenameKey?: string;
};

export type ComfyUiService = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    enabled: boolean;
    workflows: ComfyUiWorkflow[];
    lastTestedAt?: string;
    lastTestStatus?: "success" | "failed";
};

export type ComfyUiConfig = {
    services: ComfyUiService[];
};

export type ComfyUiParamValue = string | number | boolean;
export type ComfyUiParamValues = Record<string, ComfyUiParamValue>;
