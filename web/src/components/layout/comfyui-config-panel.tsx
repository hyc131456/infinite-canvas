import { App, Button, Checkbox, Drawer, Form, Input, Modal, Select, Space, Switch, Tabs, Tag } from "antd";
import { CheckCircle2, Circle, FileJson, Pencil, Plus, RefreshCw, Trash2, Upload as UploadIcon, Wifi } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { parseComfyUiWorkflow, validateComfyUiWorkflow } from "@/services/comfyui/workflow-parser";
import { testComfyUiService, testComfyUiWorkflow } from "@/services/comfyui/client";
import { useComfyUiStore } from "@/stores/use-comfyui-store";
import type { ComfyUiCapability, ComfyUiParamValue, ComfyUiParameter, ComfyUiService, ComfyUiValueType, ComfyUiWorkflow } from "@/types/comfyui";

type WorkflowEditorState = { serviceId: string; workflow: ComfyUiWorkflow } | null;

export function ComfyUiConfigPanel() {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const services = useComfyUiStore((state) => state.services);
    const addService = useComfyUiStore((state) => state.addService);
    const updateService = useComfyUiStore((state) => state.updateService);
    const removeService = useComfyUiStore((state) => state.removeService);
    const [editingServiceId, setEditingServiceId] = useState("");
    const [workflowEditor, setWorkflowEditor] = useState<WorkflowEditorState>(null);
    const [testingServiceId, setTestingServiceId] = useState("");
    const [importingServiceId, setImportingServiceId] = useState("");
    const importInputRef = useRef<HTMLInputElement>(null);
    const editingService = services.find((service) => service.id === editingServiceId) || null;

    const add = () => {
        const service = addService({ name: `${t("config.comfyui.serviceName")} ${services.length + 1}` });
        setEditingServiceId(service.id);
    };

    const test = async (service: ComfyUiService) => {
        setTestingServiceId(service.id);
        try {
            await testComfyUiService(service);
            updateService(service.id, { lastTestedAt: new Date().toISOString(), lastTestStatus: "success" });
            message.success(t("config.comfyui.testSuccess"));
        } catch (error) {
            updateService(service.id, { lastTestedAt: new Date().toISOString(), lastTestStatus: "failed" });
            message.error(error instanceof Error ? error.message : t("config.comfyui.testFailed"));
        } finally {
            setTestingServiceId("");
        }
    };

    const remove = (service: ComfyUiService) => {
        modal.confirm({
            title: t("config.comfyui.deleteTitle", { name: service.name }),
            content: t("config.comfyui.deleteDescription", { count: service.workflows.length }),
            okText: t("common.delete"),
            cancelText: t("common.cancel"),
            okButtonProps: { danger: true },
            onOk: () => removeService(service.id),
        });
    };

    const openImport = (serviceId: string) => {
        setImportingServiceId(serviceId);
        if (importInputRef.current) {
            importInputRef.current.value = "";
            importInputRef.current.click();
        }
    };

    const importWorkflow = async (file: File, serviceId: string) => {
        try {
            const parsed = parseComfyUiWorkflow(JSON.parse(await file.text()));
            setWorkflowEditor({ serviceId, workflow: parsed });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("config.comfyui.importFailed"));
        } finally {
            setImportingServiceId("");
        }
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="text-xs text-stone-500">{t("config.comfyui.description")}</div>
                <Button type="primary" icon={<Plus className="size-4" />} onClick={add}>
                    {t("config.comfyui.addService")}
                </Button>
            </div>
            <input ref={importInputRef} type="file" accept="application/json,.json" className="hidden" onChange={(event) => event.target.files?.[0] && void importWorkflow(event.target.files[0], importingServiceId)} />
            <div className="space-y-2">
                {services.length ? (
                    services.map((service) => (
                        <div key={service.id} className="rounded-lg border border-stone-200 px-4 py-3 dark:border-stone-800">
                            <div className="flex flex-wrap items-start justify-between gap-3">
                                <div className="min-w-0">
                                    <div className="flex items-center gap-2 text-sm font-semibold">
                                        {service.lastTestStatus === "success" ? <CheckCircle2 className="size-4 text-emerald-500" /> : <Circle className="size-4 text-stone-400" />}
                                        <span className="truncate">{service.name}</span>
                                        {service.lastTestStatus ? <Tag color={service.lastTestStatus === "success" ? "success" : "error"}>{t(`config.comfyui.${service.lastTestStatus === "success" ? "online" : "offline"}`)}</Tag> : null}
                                        {!service.enabled ? <Tag>{t("config.comfyui.disabled")}</Tag> : null}
                                    </div>
                                    <div className="mt-1 truncate text-xs text-stone-500">{service.baseUrl} · {t("config.comfyui.workflowCount", { count: service.workflows.length })}{service.lastTestedAt ? ` · ${t("config.comfyui.lastTested", { time: new Date(service.lastTestedAt).toLocaleString() })}` : ""}</div>
                                </div>
                                <div className="flex shrink-0 flex-wrap gap-2">
                                    <Button size="small" icon={<Wifi className="size-3.5" />} loading={testingServiceId === service.id} onClick={() => void test(service)}>
                                        {t("config.comfyui.test")}
                                    </Button>
                                    <Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => setEditingServiceId(service.id)}>
                                        {t("common.edit")}
                                    </Button>
                                    <Button size="small" danger icon={<Trash2 className="size-3.5" />} onClick={() => remove(service)} />
                                </div>
                            </div>
                            {service.workflows.length ? (
                                <div className="mt-3 flex flex-wrap gap-2">
                                    {service.workflows.map((workflow) => (
                                        <Button key={workflow.id} size="small" onClick={() => setWorkflowEditor({ serviceId: service.id, workflow })}>
                                            {workflow.name} · {workflow.capability === "image" ? t("config.comfyui.image") : t("config.comfyui.video")}
                                        </Button>
                                    ))}
                                </div>
                            ) : null}
                        </div>
                    ))
                ) : (
                    <div className="border border-dashed border-stone-300 px-4 py-10 text-center text-sm text-stone-500 dark:border-stone-700">{t("config.comfyui.empty")}</div>
                )}
            </div>
            <ComfyUiServiceDrawer
                open={Boolean(editingService)}
                service={editingService}
                onSave={(service) => updateService(service.id, service)}
                onImport={() => editingService && openImport(editingService.id)}
                onEditWorkflow={(workflow) => editingService && setWorkflowEditor({ serviceId: editingService.id, workflow })}
                onClose={() => setEditingServiceId("")}
            />
            <ComfyUiWorkflowModal
                state={workflowEditor}
                service={workflowEditor ? services.find((item) => item.id === workflowEditor.serviceId) || null : null}
                onClose={() => setWorkflowEditor(null)}
            />
        </div>
    );
}

function ComfyUiServiceDrawer({ open, service, onSave, onImport, onEditWorkflow, onClose }: { open: boolean; service: ComfyUiService | null; onSave: (service: ComfyUiService) => void; onImport: () => void; onEditWorkflow: (workflow: ComfyUiWorkflow) => void; onClose: () => void }) {
    const { message, modal } = App.useApp();
    const { t } = useTranslation();
    const removeWorkflow = useComfyUiStore((state) => state.removeWorkflow);
    const [draft, setDraft] = useState<ComfyUiService | null>(service);
    const [testing, setTesting] = useState(false);
    useEffect(() => { if (open && service) setDraft(service); }, [open, service]);
    if (!draft) return null;
    const patch = (value: Partial<ComfyUiService>) => setDraft((current) => (current ? { ...current, ...value } : current));
    const save = () => {
        const name = draft.name.trim();
        const baseUrl = draft.baseUrl.trim().replace(/\/+$/, "");
        if (!name) return message.error(t("config.comfyui.nameRequired"));
        const url = parseServiceUrl(baseUrl);
        if (!url) return message.error(t("config.comfyui.urlRequired"));
        if (/\/(prompt|history|view|queue|system_stats)(\/|$)/i.test(url.pathname)) return message.error(t("config.comfyui.endpointUrl"));
        onSave({ ...draft, name, baseUrl });
        onClose();
    };
    const test = async () => {
        setTesting(true);
        try {
            await testComfyUiService(draft);
            patch({ lastTestedAt: new Date().toISOString(), lastTestStatus: "success" });
            message.success(t("config.comfyui.testSuccess"));
        } catch (error) {
            patch({ lastTestedAt: new Date().toISOString(), lastTestStatus: "failed" });
            message.error(error instanceof Error ? error.message : t("config.comfyui.testFailed"));
        } finally {
            setTesting(false);
        }
    };
    const remove = (workflow: ComfyUiWorkflow) => modal.confirm({ title: t("config.comfyui.deleteWorkflowTitle", { name: workflow.name }), okText: t("common.delete"), cancelText: t("common.cancel"), okButtonProps: { danger: true }, onOk: () => removeWorkflow(draft.id, workflow.id) });
    return (
        <Drawer
            open={open}
            width={620}
            title={t("config.comfyui.serviceEditor")}
            onClose={onClose}
            extra={<Space><Button onClick={onClose}>{t("common.cancel")}</Button><Button type="primary" onClick={save}>{t("common.save")}</Button></Space>}
        >
            <Form layout="vertical" requiredMark={false}>
                <Form.Item label={t("config.comfyui.name")} required><Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></Form.Item>
                <Form.Item label={t("config.comfyui.baseUrl")} required extra={t("config.comfyui.corsHint")}><Input value={draft.baseUrl} placeholder="http://127.0.0.1:8188" onChange={(event) => patch({ baseUrl: event.target.value })} /></Form.Item>
                <Form.Item label={t("config.comfyui.apiKey")} extra={t("config.comfyui.apiKeyHint")}><Input.Password value={draft.apiKey} onChange={(event) => patch({ apiKey: event.target.value })} /></Form.Item>
                <Form.Item label={t("config.comfyui.enabled")}><Switch checked={draft.enabled} onChange={(enabled) => patch({ enabled })} /></Form.Item>
            </Form>
            <Button className="mb-5" icon={<Wifi className="size-4" />} loading={testing} onClick={() => void test()}>{t("config.comfyui.test")}</Button>
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <div><div className="text-sm font-semibold">{t("config.comfyui.workflows")}</div><div className="mt-0.5 text-xs text-stone-500">{t("config.comfyui.workflowHint")}</div></div>
                <Button type="primary" icon={<UploadIcon className="size-4" />} onClick={onImport}>{t("config.comfyui.importJson")}</Button>
            </div>
            <div className="space-y-2">
                {draft.workflows.length ? draft.workflows.map((workflow) => (
                    <div key={workflow.id} className="flex items-center justify-between gap-3 rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800">
                        <div className="min-w-0"><div className="truncate text-sm font-medium">{workflow.name}</div><div className="text-xs text-stone-500">{workflow.capability === "image" ? t("config.comfyui.image") : t("config.comfyui.video")} · {t("config.comfyui.parameterCount", { count: workflow.parameters.length })}</div></div>
                        <div className="flex gap-2"><Button size="small" icon={<Pencil className="size-3.5" />} onClick={() => onEditWorkflow(workflow)}>{t("common.edit")}</Button><Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />} onClick={() => remove(workflow)} /></div>
                    </div>
                )) : <div className="border border-dashed border-stone-300 px-3 py-8 text-center text-sm text-stone-500 dark:border-stone-700">{t("config.comfyui.noWorkflows")}</div>}
            </div>
        </Drawer>
    );
}

function ComfyUiWorkflowModal({ state, service, onClose }: { state: WorkflowEditorState; service: ComfyUiService | null; onClose: () => void }) {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const upsertWorkflow = useComfyUiStore((store) => store.upsertWorkflow);
    const [draft, setDraft] = useState<ComfyUiWorkflow | null>(state?.workflow || null);
    const [activeTab, setActiveTab] = useState("workflow");
    const [testValues, setTestValues] = useState<Record<string, ComfyUiParamValue>>({});
    const [testImage, setTestImage] = useState("");
    const [testing, setTesting] = useState(false);
    useEffect(() => {
        if (state) {
            setDraft(state.workflow);
            setActiveTab("workflow");
            setTestValues({});
            setTestImage("");
        }
    }, [state]);
    if (!state || !service || !draft) return null;
    const patch = (value: Partial<ComfyUiWorkflow>) => setDraft((current) => (current ? { ...current, ...value, updatedAt: new Date().toISOString() } : current));
    const save = () => {
        const error = validateComfyUiWorkflow(draft);
        if (error) return message.error(error);
        upsertWorkflow(service.id, draft);
        message.success(t("config.comfyui.workflowSaved"));
        onClose();
    };
    const test = async () => {
        if (draft.capability !== "image") return message.warning(t("config.comfyui.videoTestLater"));
        const error = validateComfyUiWorkflow(draft);
        if (error) return message.error(error);
        setTesting(true);
        try {
            const outputs = await testComfyUiWorkflow(service, draft, testValues);
            setTestImage(outputs[0]?.dataUrl || "");
            patch({ lastTestedAt: new Date().toISOString(), lastTestStatus: "success" });
            message.success(t("config.comfyui.workflowTestSuccess"));
        } catch (reason) {
            patch({ lastTestedAt: new Date().toISOString(), lastTestStatus: "failed" });
            message.error(reason instanceof Error ? reason.message : t("config.comfyui.testFailed"));
        } finally {
            setTesting(false);
        }
    };
    return (
        <Modal open title={t("config.comfyui.workflowEditor")} width={900} onCancel={onClose} onOk={save} okText={t("common.save")} cancelText={t("common.cancel")} destroyOnHidden>
            <Tabs activeKey={activeTab} onChange={setActiveTab} items={[
                { key: "workflow", label: t("config.comfyui.workflowTab"), children: <WorkflowOverview draft={draft} patch={patch} /> },
                { key: "parameters", label: t("config.comfyui.parametersTab"), children: <ParameterEditor draft={draft} patch={patch} /> },
                { key: "outputs", label: t("config.comfyui.outputsTab"), children: <OutputEditor draft={draft} patch={patch} /> },
                { key: "test", label: t("config.comfyui.testTab"), children: <WorkflowTest draft={draft} values={testValues} setValues={setTestValues} image={testImage} testing={testing} onTest={() => void test()} /> },
            ]} />
        </Modal>
    );
}

function WorkflowOverview({ draft, patch }: { draft: ComfyUiWorkflow; patch: (value: Partial<ComfyUiWorkflow>) => void }) {
    const { t } = useTranslation();
    const json = JSON.stringify(draft.workflow, null, 2);
    return <Form layout="vertical" requiredMark={false}><div className="grid gap-4 md:grid-cols-2"><Form.Item label={t("config.comfyui.workflowName")} required><Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} /></Form.Item><Form.Item label={t("config.comfyui.capability")} required><Select value={draft.capability} options={[{ value: "image", label: t("config.comfyui.image") }, { value: "video", label: t("config.comfyui.videoLater"), disabled: true }]} onChange={(capability: ComfyUiCapability) => patch({ capability, outputs: [] })} /></Form.Item></div><div className="mb-2 flex items-center gap-2 text-sm font-medium"><FileJson className="size-4" />{t("config.comfyui.nodeGraph", { count: Object.keys(draft.workflow).length })}</div><Input.TextArea value={json} readOnly rows={14} className="font-mono text-xs" /></Form>;
}

function ParameterEditor({ draft, patch }: { draft: ComfyUiWorkflow; patch: (value: Partial<ComfyUiWorkflow>) => void }) {
    const { t } = useTranslation();
    const add = () => patch({ parameters: [...draft.parameters, { key: `parameter${draft.parameters.length + 1}`, label: t("config.comfyui.newParameter"), type: "text", required: false, defaultValue: "", bindings: [] }] });
    const update = (index: number, value: Partial<ComfyUiParameter>) => patch({ parameters: draft.parameters.map((parameter, itemIndex) => itemIndex === index ? { ...parameter, ...value } : parameter) });
    const remove = (index: number) => patch({ parameters: draft.parameters.filter((_, itemIndex) => itemIndex !== index) });
    return <div><div className="mb-3 flex items-center justify-between gap-2"><div className="text-xs text-stone-500">{t("config.comfyui.parameterHint")}</div><Button icon={<Plus className="size-4" />} onClick={add}>{t("config.comfyui.addParameter")}</Button></div><div className="space-y-3">{draft.parameters.map((parameter, index) => <ParameterRow key={`${parameter.key}-${index}`} parameter={parameter} nodes={draft.workflow} onChange={(value) => update(index, value)} onRemove={() => remove(index)} />)}</div></div>;
}

function ParameterRow({ parameter, nodes, onChange, onRemove }: { parameter: ComfyUiParameter; nodes: ComfyUiWorkflow["workflow"]; onChange: (value: Partial<ComfyUiParameter>) => void; onRemove: () => void }) {
    const { t } = useTranslation();
    const binding = parameter.bindings[0];
    const inputOptions = binding?.nodeId ? Object.entries(nodes[binding.nodeId]?.inputs || {}).filter(([, value]) => !Array.isArray(value) && value !== null && value !== undefined).map(([value]) => ({ value, label: value })) : [];
    return <div className="rounded-lg border border-stone-200 p-3 dark:border-stone-800"><div className="grid gap-2 md:grid-cols-[1fr_1fr_150px_auto]"><Input value={parameter.key} placeholder="key" onChange={(event) => onChange({ key: event.target.value })} /><Input value={parameter.label} placeholder={t("config.comfyui.label")} onChange={(event) => onChange({ label: event.target.value })} /><Select value={parameter.type} options={["text", "textarea", "number", "select", "boolean", "seed"].map((value) => ({ value, label: value }))} onChange={(type) => onChange({ type: type as ComfyUiParameter["type"], bindings: parameter.bindings.map((item) => ({ ...item, valueType: parameterValueType(type as ComfyUiParameter["type"]) })) })} /><Button danger type="text" icon={<Trash2 className="size-4" />} onClick={onRemove} /></div><div className="mt-2 grid gap-2 md:grid-cols-[1fr_1fr_auto] md:items-center"><Select showSearch className="w-full" placeholder={t("config.comfyui.nodeId")} value={binding?.nodeId} options={Object.entries(nodes).map(([value, node]) => ({ value, label: `${value} · ${node.class_type}` }))} onChange={(nodeId) => onChange({ bindings: [{ nodeId, inputKey: "", valueType: parameterValueType(parameter.type) }] })} /><Select showSearch className="w-full" disabled={!binding?.nodeId} value={binding?.inputKey || undefined} placeholder={t("config.comfyui.inputKey")} options={inputOptions} onChange={(inputKey) => onChange({ bindings: binding ? [{ ...binding, inputKey }] : [] })} /><Checkbox checked={parameter.required} onChange={(event) => onChange({ required: event.target.checked })}>{t("config.comfyui.required")}</Checkbox></div><div className="mt-2 grid gap-2 md:grid-cols-3">{parameter.type === "boolean" ? <Switch checked={Boolean(parameter.defaultValue)} onChange={(defaultValue) => onChange({ defaultValue })} /> : <Input value={parameter.defaultValue as string | number | undefined} type={parameter.type === "number" || parameter.type === "seed" ? "number" : "text"} placeholder={t("config.comfyui.defaultValue")} onChange={(event) => onChange({ defaultValue: parameter.type === "number" || parameter.type === "seed" ? Number(event.target.value) : event.target.value })} />}{parameter.type === "select" ? <Input className="md:col-span-2" value={(parameter.options || []).map((option) => option.value).join(", ")} placeholder={t("config.comfyui.options")} onChange={(event) => onChange({ options: event.target.value.split(",").map((value) => value.trim()).filter(Boolean).map((value) => ({ label: value, value })) })} /> : null}{parameter.type === "number" ? <><Input type="number" placeholder={t("config.comfyui.min")} value={parameter.min} onChange={(event) => onChange({ min: Number(event.target.value) || undefined })} /><Input type="number" placeholder={t("config.comfyui.step")} value={parameter.step} onChange={(event) => onChange({ step: Number(event.target.value) || undefined })} /></> : null}</div></div>;
}

function OutputEditor({ draft, patch }: { draft: ComfyUiWorkflow; patch: (value: Partial<ComfyUiWorkflow>) => void }) {
    const { t } = useTranslation();
    const outputNodes = useMemo(() => Object.entries(draft.workflow).filter(([, node]) => draft.capability === "image" ? /saveimage|previewimage/i.test(node.class_type) : /savevideo|videocombine|vhs_videocombine/i.test(node.class_type)), [draft.capability, draft.workflow]);
    const selected = new Set(draft.outputs.map((output) => output.nodeId));
    return <div><div className="mb-3 text-xs text-stone-500">{t("config.comfyui.outputHint")}</div><Checkbox.Group value={[...selected]} onChange={(values) => patch({ outputs: values.map((nodeId) => ({ nodeId: String(nodeId), type: draft.capability })) })}><div className="space-y-2">{outputNodes.map(([nodeId, node]) => <div key={nodeId} className="rounded-lg border border-stone-200 px-3 py-2 dark:border-stone-800"><Checkbox value={nodeId}>{nodeId} · {node.class_type}</Checkbox></div>)}</div></Checkbox.Group>{!outputNodes.length ? <div className="mt-4 text-sm text-stone-500">{t("config.comfyui.noOutputs")}</div> : null}</div>;
}

function WorkflowTest({ draft, values, setValues, image, testing, onTest }: { draft: ComfyUiWorkflow; values: Record<string, ComfyUiParamValue>; setValues: (values: Record<string, ComfyUiParamValue>) => void; image: string; testing: boolean; onTest: () => void }) {
    const { t } = useTranslation();
    return <div><div className="mb-3 text-xs text-stone-500">{t("config.comfyui.testHint")}</div><div className="grid gap-3 md:grid-cols-2">{draft.parameters.map((parameter) => <Form.Item key={parameter.key} label={parameter.label} className="mb-1"><ParameterInput parameter={parameter} value={values[parameter.key] ?? parameter.defaultValue} onChange={(value) => setValues({ ...values, [parameter.key]: value })} /></Form.Item>)}</div><Button type="primary" icon={<RefreshCw className="size-4" />} loading={testing} onClick={onTest}>{t("config.comfyui.testWorkflow")}</Button>{image ? <div className="mt-4 max-w-sm overflow-hidden rounded-lg border border-stone-200 dark:border-stone-800"><img src={image} alt={t("config.comfyui.testResult")} className="block w-full" /></div> : null}</div>;
}

function ParameterInput({ parameter, value, onChange }: { parameter: ComfyUiParameter; value: ComfyUiParamValue | undefined; onChange: (value: ComfyUiParamValue) => void }) {
    if (parameter.type === "textarea") return <Input.TextArea rows={3} value={String(value ?? "")} onChange={(event) => onChange(event.target.value)} />;
    if (parameter.type === "boolean") return <Switch checked={Boolean(value)} onChange={onChange} />;
    if (parameter.type === "select") return <Select className="w-full" value={value as string | number} options={parameter.options?.map((option) => ({ value: option.value, label: option.label }))} onChange={onChange} />;
    return <Input type={parameter.type === "number" || parameter.type === "seed" ? "number" : "text"} value={value as string | number | undefined} onChange={(event) => onChange(parameter.type === "number" || parameter.type === "seed" ? Number(event.target.value) : event.target.value)} />;
}

function parameterValueType(type: ComfyUiParameter["type"]): ComfyUiValueType {
    if (type === "number" || type === "seed") return "number";
    if (type === "boolean") return "boolean";
    if (type === "select") return "enum";
    return "string";
}

function parseServiceUrl(value: string) {
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:" ? url : null;
    } catch {
        return null;
    }
}
