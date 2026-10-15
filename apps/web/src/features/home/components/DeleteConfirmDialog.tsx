'use client';

/**
 * 删除确认对话框（FE-02 · B12 删除两步确认的第二步）。
 *
 * 两步口径：卡片菜单里的「删除」只是**第一步**（表达意图），真正的删除由本对话框确认
 * ——默认焦点落在卡片本身而不是确认键上（Modal 的焦点策略），确认键是危险语义色；
 * 文案直接说明「正文不可恢复」，因为 daemon 侧是物理删除（本地优先的代价，必须讲清）。
 */
import { Button, Modal } from '@dforge/ui';

import { t } from '@/i18n';

/** 删除确认对话框 props。 */
export interface DeleteConfirmDialogProps {
  open: boolean;
  /** 待删除文档名（标题与说明用）。 */
  documentName: string;
  /** 删除请求进行中（确认键进加载态，防重复提交）。 */
  pending: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** 删除确认对话框。 */
export function DeleteConfirmDialog({
  open,
  documentName,
  pending,
  onCancel,
  onConfirm,
}: DeleteConfirmDialogProps) {
  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t('home.delete.title', { name: documentName })}
      description={t('home.delete.desc')}
      closeLabel={t('home.dialog.close')}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>{t('home.delete.cancel')}</Button>
          <Button
            variant="danger"
            loading={pending}
            loadingLabel={t('home.delete.deleting')}
            onClick={onConfirm}
          >
            {t('home.delete.confirm')}
          </Button>
        </>
      }
    />
  );
}
