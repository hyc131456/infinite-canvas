const MINIMAX_H3_WORKFLOW = {
    "287": { inputs: { clip_name: "qwen3vl_32b_minimax_h3_nvfp4_awq.safetensors", type: "minimax", device: "default" }, class_type: "CLIPLoader" },
    "288": { inputs: { vae_name: "minimax_h3_video_vae_fp16.safetensors" }, class_type: "VAELoader" },
    "289": { inputs: { vae_name: "minimax_h3_audio_vae_fp32.safetensors" }, class_type: "VAELoader" },
    "290": { inputs: { model: ["295", 0], conditioning: ["312", 0] }, class_type: "BasicGuider" },
    "291": { inputs: { noise_seed: 123456789 }, class_type: "RandomNoise" },
    "292": { inputs: { noise: ["291", 0], guider: ["290", 0], sampler: ["295", 1], sigmas: ["295", 2], latent_image: ["312", 1] }, class_type: "SamplerCustomAdvanced" },
    "294": { inputs: { av_latent: ["292", 0], video_vae: ["288", 0], audio_vae: ["289", 0] }, class_type: "MiniMaxH3AVDecodeT8" },
    "295": { inputs: { video_steps: 8, audio_steps: 10, shift_video: 12, shift_audio: 3, model: ["326", 0], av_latent: ["312", 1] }, class_type: "MiniMaxH3MultiRateSamplerEXPT8" },
    "296": {
        inputs: {
            frame_rate: 24,
            loop_count: 0,
            filename_prefix: "MiniMaxH3/exp_4v10a",
            format: "video/h264-mp4",
            pix_fmt: "yuv420p",
            crf: 19,
            save_metadata: true,
            trim_to_audio: false,
            pingpong: false,
            save_output: true,
            images: ["294", 0],
            audio: ["294", 1],
        },
        class_type: "VHS_VideoCombine",
    },
    "297": { inputs: { image: "" }, class_type: "LoadImage" },
    "298": { inputs: { image: "" }, class_type: "LoadImage" },
    "299": { inputs: { image: "" }, class_type: "LoadImage" },
    "300": { inputs: { expression: "max(5, round(a * 24)) + (5 - (max(5, round(a * 24)) % 17)) % 17", "values.a": ["309", 0] }, class_type: "ComfyMathExpression" },
    "301": { inputs: { value: "" }, class_type: "PrimitiveStringMultiline" },
    "308": { inputs: { aspect_ratio: "16:9 (Widescreen)", megapixels: 0.7, multiple: 32 }, class_type: "ResolutionSelector" },
    "309": { inputs: { value: 10 }, class_type: "PrimitiveFloat" },
    "312": {
        inputs: {
            prompt: ["301", 0],
            width: ["308", 0],
            height: ["308", 1],
            length: ["300", 1],
            task_type: "Ref2VA",
            audio_mode: "native",
            audio_denoise_strength: 1,
            add_source_as_reference: false,
            prompt_primary_audio_ordinal: 0,
            strict_prompt_tags: true,
            ref_image_size: "max",
            reference_video_policy: "official_2_to_15s",
            clip: ["287", 0],
            video_vae: ["288", 0],
            audio_vae: ["289", 0],
            "ref_images.ref_image_0": ["297", 0],
            "ref_images.ref_image_1": ["298", 0],
            "ref_images.ref_image_2": ["299", 0],
        },
        class_type: "MiniMaxH3AudioConditioningT8",
    },
    "315": { inputs: { unet_name: "minimax_h3_fl2va_int8_convrot.safetensors", weight_dtype: "default" }, class_type: "UNETLoader" },
    "321": { inputs: { model: ["315", 0] }, class_type: "MiniMaxH3MemoryEfficientSageAttentionPatch" },
    "326": { inputs: { lora_name: "minimax_h3_turbo_4STEPS_comfyui.safetensors", strength_model: 1, model: ["321", 0] }, class_type: "LoraLoaderBypassModelOnly" },
};

export function getComfyUiMinimaxH3Script() {
    return `// ComfyUI Base URL 示例：http://127.0.0.1:8188
// ComfyUI 需要允许当前网页跨域访问，例如启动时增加 --enable-cors-header "http://127.0.0.1:3000"。
// 参考图按画布连接顺序映射：图1 -> 节点297，图2 -> 节点298，图3 -> 节点299。
// params.megapixels 会写入节点308，允许范围为 0.1-16.0，默认 0.7。
const workflow = ${JSON.stringify(MINIMAX_H3_WORKFLOW)};
const comfyUrl = baseUrl.replace(/\\/+$/, "");

if (images.length < 3) {
  throw new Error("MiniMax H3 工作流需要按顺序连接 3 张参考图（图1、图2、图3）");
}

const runId = typeof crypto !== "undefined" && crypto.randomUUID
  ? crypto.randomUUID()
  : \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`;

function imageExtension(blob) {
  const extensions = { "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" };
  return extensions[blob.type] || "png";
}

async function uploadReference(dataUrl, index) {
  const blob = await (await fetch(dataUrl)).blob();
  if (!blob.type.startsWith("image/")) throw new Error(\`参考图\${index + 1}不是有效图片\`);
  const form = new FormData();
  form.append("image", blob, \`infinite-canvas-\${runId}-\${index + 1}.\${imageExtension(blob)}\`);
  form.append("type", "input");
  form.append("overwrite", "true");
  const uploaded = await request({ method: "post", url: \`\${comfyUrl}/upload/image\`, data: form });
  if (!uploaded?.name) throw new Error(\`参考图\${index + 1}上传失败\`);
  return uploaded.subfolder ? \`\${uploaded.subfolder}/\${uploaded.name}\` : uploaded.name;
}

function resolveAspectRatio(value) {
  const match = String(value || "").match(/^(\\d+(?:\\.\\d+)?)[x:](\\d+(?:\\.\\d+)?)/i);
  if (!match) return "16:9 (Widescreen)";
  const ratio = Number(match[1]) / Number(match[2]);
  const options = [
    [16 / 9, "16:9 (Widescreen)"],
    [9 / 16, "9:16 (Portrait)"],
    [1, "1:1 (Square)"],
    [4 / 3, "4:3 (Standard)"],
    [3 / 4, "3:4 (Portrait)"],
    [21 / 9, "21:9 (Ultrawide)"],
  ];
  return options.reduce((best, option) => Math.abs(option[0] - ratio) < Math.abs(best[0] - ratio) ? option : best)[1];
}

const uploadedImages = await Promise.all(images.slice(0, 3).map(uploadReference));
workflow["297"].inputs.image = uploadedImages[0];
workflow["298"].inputs.image = uploadedImages[1];
workflow["299"].inputs.image = uploadedImages[2];
workflow["301"].inputs.value = prompt;
workflow["308"].inputs.aspect_ratio = resolveAspectRatio(params.ratio || params.size);
workflow["308"].inputs.megapixels = Math.max(0.1, Math.min(16, Number(params.megapixels) || 0.7));
workflow["309"].inputs.value = Number(params.seconds) || 10;
workflow["291"].inputs.noise_seed = Math.floor(Math.random() * Number.MAX_SAFE_INTEGER);

const queued = await request({
  method: "post",
  url: \`\${comfyUrl}/prompt\`,
  headers: { "Content-Type": "application/json" },
  data: { prompt: workflow, client_id: runId },
});
if (!queued?.prompt_id) {
  const details = queued?.error?.message || queued?.error || (queued?.node_errors && JSON.stringify(queued.node_errors));
  throw new Error(details || "ComfyUI 未返回 prompt_id");
}

function executionError(entry) {
  const message = [...(entry?.status?.messages || [])].reverse().find((item) => item?.[0] === "execution_error");
  return message?.[1]?.exception_message || message?.[1]?.exception_type || "ComfyUI 执行失败";
}

function outputVideo(entry) {
  const outputs = entry?.outputs || {};
  const candidates = [outputs["296"], ...Object.values(outputs).filter((value) => value !== outputs["296"])];
  for (const output of candidates) {
    for (const key of ["videos", "gifs", "images"]) {
      const file = output?.[key]?.find((item) => /\\.mp4$/i.test(item?.filename || "") || String(item?.format || "").startsWith("video/"));
      if (file) return file;
    }
  }
  return null;
}

let videoFile;
for (;;) {
  const history = await request({ method: "get", url: \`\${comfyUrl}/history/\${queued.prompt_id}\` });
  const entry = history?.[queued.prompt_id];
  if (entry?.status?.status_str === "error") throw new Error(executionError(entry));
  videoFile = outputVideo(entry);
  if (videoFile) break;
  if (entry?.status?.completed) throw new Error("ComfyUI 已完成任务，但没有找到 MP4 输出");
  await sleep(2000);
}

const blob = await request({
  method: "get",
  url: \`\${comfyUrl}/view\`,
  params: { filename: videoFile.filename, subfolder: videoFile.subfolder || "", type: videoFile.type || "output" },
  responseType: "blob",
});
if (!(blob instanceof Blob)) throw new Error("ComfyUI 视频下载失败");
return blob.type.startsWith("video/") ? blob : new Blob([blob], { type: "video/mp4" });`;
}
