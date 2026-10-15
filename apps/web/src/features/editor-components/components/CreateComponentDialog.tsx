'use client';

/**
 * 创建组件对话框（C17「创建组件」的命名入口，F1 模态族）。
 *
 * 口径：对话框只管命名与确认/取消，**不碰文档**——提交动作由宿主（ComponentPanel）
 * 经命令栈执行，避免「对话框里藏写操作」这种不可撤销的暗门。
 */

import { Button, Input, Modal } from '@dforge/ui';
import { type FormEvent, useEffect, useState } from 'react';

import { t } from '@/i18n';

/** 对话框 props。 */
export interface CreateComponentDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** 确认创建（名称已去首尾空白；空名回落默认名，宿主再兜一层）。 */
  onConfirm: (name: string) => void;
  /** 默认名（文档数据默认值，非界面文案）。 */
  defaultName?: string;
}

/** 创建组件对话框。 */
export function CreateComponentDialog({
  open,
  onOpenChange,
  onConfirm,
  defaultName = '组件',
}: CreateComponentDialogProps) {
  const [name, setName] = useState(defaultName);

  // 每次重新打开都回到默认名（下次创建不继承上次输入）
  useEffect(() => {
    if (open) setName(defaultName);
  }, [open, defaultName]);

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    onConfirm(name.trim() === '' ? defaultName : name.trim());
    onOpenChange(false);
  };

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('editor.components.createDialog.title')}
      size="sm"
      closeLabel={t('editor.components.createDialog.close')}
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('editor.components.createDialog.cancel')}
          </Button>
          <Button variant="primary" type="submit" form="dfc-create-component-form">
            {t('editor.components.createDialog.confirm')}
          </Button>
        </>
      }
    >
      <form id="dfc-create-component-form" onSubmit={submit}>
        <Input
          fieldLabel={t('editor.components.createDialog.name')}
          kind="text"
          value={name}
          autoFocus
          onChange={(event) => setName(event.target.value)}
        />
      </form>
    </Modal>
  );
}
