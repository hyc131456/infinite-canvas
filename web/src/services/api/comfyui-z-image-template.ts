const Z_IMAGE_WORKFLOW = {
    "1": {
        inputs: { seed: 620700111704400, steps: 9, cfg: 1, sampler_name: "euler", scheduler: "simple", denoise: 1, model: ["10", 0], positive: ["3", 0], negative: ["4", 0], latent_image: ["5", 0] },
        class_type: "KSampler",
    },
    "2": { inputs: { unet_name: "z_image_turbo_bf16.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
    "3": { inputs: { text: "", clip: ["6", 0] }, class_type: "CLIPTextEncode" },
    "4": { inputs: { text: "blurry ugly bad", clip: ["6", 0] }, class_type: "CLIPTextEncode" },
    "5": { inputs: { width: 1280, height: 720, batch_size: 1 }, class_type: "EmptySD3LatentImage" },
    "6": { inputs: { clip_name: "qwen_3_4b.safetensors", type: "lumina2", device: "default" }, class_type: "CLIPLoader" },
    "7": { inputs: { samples: ["1", 0], vae: ["9", 0] }, class_type: "VAEDecode" },
    "8": { inputs: { images: ["7", 0] }, class_type: "PreviewImage" },
    "9": { inputs: { vae_name: "ae.safetensors" }, class_type: "VAELoader" },
    "10": { inputs: { shift: 3, model: ["2", 0] }, class_type: "ModelSamplingAuraFlow" },
    "11": { inputs: { filename_prefix: "ComfyUI", images: ["7", 0] }, class_type: "SaveImage" },
};

export function getComfyUiZImageScript() {
    return `// ComfyUI Z-Image 文生图模板，Base URL 示例：http://127.0.0.1:8188
// ComfyUI 需要允许当前网页跨域访问，例如启动时增加 --enable-cors-header "http://127.0.0.1:3000"。
// prompt 是正面提示词；params.negativePrompt、params.width 和 params.height 来自生图设置。
// 当前工作流是文生图，不支持 images 参考图输入。
const workflowTemplate = ${JSON.stringify(Z_IMAGE_WORKFLOW)};
const comfyUrl = baseUrl.replace(/\\/+$/, "");

if (images.length) throw new Error("ComfyUI Z-Image 工作流暂不支持参考图");

function createRunId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : \`\\${Date.now()}-\\${Math.random().toString(36).slice(2)}\`;
}

function readDimensions() {
  const match = String(params.size || "").match(/^(\\d+)x(\\d+)$/i);
  return {
    width: Math.max(16, Math.floor(Number(params.width) || Number(match?.[1]) || 1280)),
    height: Math.max(16, Math.floor(Number(params.height) || Number(match?.[2]) || 720)),
  };
}

function executionError(entry) {
  const message = [...(entry?.status?.messages || [])].reverse().find((item) => item?.[0] === "execution_error");
  return message?.[1]?.exception_message || message?.[1]?.exception_type || "ComfyUI 执行失败";
}

function outputImage(entry) {
  const outputs = entry?.outputs || {};
  const candidates = [outputs["11"], outputs["8"], ...Object.values(outputs).filter((value) => value !== outputs["11"] && value !== outputs["8"])];
  for (const output of candidates) {
    const file = output?.images?.find((item) => item?.filename);
    if (file) return file;
  }
  return null;
}

async function blobToDataUrl(blob) {
  if (!(blob instanceof Blob)) throw new Error("ComfyUI 图片下载失败");
  return await new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error("ComfyUI 图片读取失败"));
    reader.readAsDataURL(blob);
  });
}

async function runOnce(index) {
  const workflow = JSON.parse(JSON.stringify(workflowTemplate));
  const dimensions = readDimensions();
  const runId = createRunId();
  workflow["3"].inputs.text = prompt;
  workflow["4"].inputs.text = String(params.negativePrompt ?? "blurry ugly bad");
  workflow["5"].inputs.width = dimensions.width;
  workflow["5"].inputs.height = dimensions.height;
  workflow["5"].inputs.batch_size = 1;
  workflow["1"].inputs.seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);
  workflow["11"].inputs.filename_prefix = \`InfiniteCanvas/Z-Image-\\${runId}-\\${index + 1}\`;

  const queued = await request({
    method: "post",
    url: \`\\${comfyUrl}/prompt\`,
    headers: { "Content-Type": "application/json" },
    data: { prompt: workflow, client_id: runId },
  });
  if (!queued?.prompt_id) {
    const details = queued?.error?.message || queued?.error || (queued?.node_errors && JSON.stringify(queued.node_errors));
    throw new Error(details || "ComfyUI 未返回 prompt_id");
  }

  const imageFile = await poll(
    () => request({ method: "get", url: \`${comfyUrl}/history/\\${queued.prompt_id}\` }),
    (history) => {
      const entry = history?.[queued.prompt_id];
      if (entry?.status?.status_str === "error") throw new Error(executionError(entry));
      const image = outputImage(entry);
      if (image) return image;
      if (entry?.status?.completed) throw new Error("ComfyUI 已完成任务，但没有找到图片输出");
      return null;
    },
    { intervalMs: 2000, timeoutMs: 300000 },
  );
  const blob = await request({
    method: "get",
    url: \`${comfyUrl}/view\`,
    params: { filename: imageFile.filename, subfolder: imageFile.subfolder || "", type: imageFile.type || "output" },
    responseType: "blob",
  });
  return await blobToDataUrl(blob);
}

const count = Math.max(1, Math.min(15, Math.floor(Math.abs(Number(params.count)) || 1)));
return await Promise.all(Array.from({ length: count }, (_, index) => runOnce(index)));`;
}
