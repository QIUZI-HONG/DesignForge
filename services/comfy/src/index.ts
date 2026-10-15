/**
 * @dforge/comfy —— 出图适配（骨架占位）。
 *
 * 定位：本地 ComfyUI 客户端（零出机、零成本、可复现）；「未启动态」是验收对象，
 * 不得静默失败或回退到云端。契约形状按架构说明 v1.1 §5.5（出图任务契约）。
 * 接管票：AI 抽屉 + 出图面板（FE-10）。
 */

/** 服务标识（占位导出）。 */
export const COMFY_PACKAGE = '@dforge/comfy' as const;
