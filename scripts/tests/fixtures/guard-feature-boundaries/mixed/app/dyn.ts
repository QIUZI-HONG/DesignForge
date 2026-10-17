/**
 * 混合夹具 · 未判定侧：动态导入实参含插值（静态判不出目标）→ 记「未判定」。
 * 与同夹具的违规侧一起运行时：退出码取 1（违规优先），但日志必须把本条一并列出。
 */
export async function loadPanel(name: string): Promise<unknown> {
  return import(`@/features/${name}/panel`);
}
