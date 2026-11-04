/**
 * 草稿态 + 提交调度（C5 核心交互语义）。
 *
 * 实现已下沉到 `@dforge/ui`（arch-02：数值编辑 module 与文本草稿共用一份计时语义，
 * 测试随实现走 `packages/ui/src/utils/use-draft-commit.test.tsx`）；
 * 本文件保留 `features/inspector` 的既有导入面，避免调用方与测试各自改 import。
 */

export {
  COMMIT_DELAY_MS,
  type DraftCommit,
  type DraftCommitOptions,
  useDraftCommit,
} from '@dforge/ui';
