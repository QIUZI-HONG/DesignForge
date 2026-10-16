'use client';

import { isValidDocumentName } from '@dforge/contracts';
/**
 * 新建文件对话框（FE-02 · B5 新建菜单的落地动作）。
 *
 * 为什么不「新建即跳编辑器」：本地优先链路上先落盘（daemon 建 `.dfg` 目录）再进编辑器，
 * 建好就跳会让「文件已建但编辑器打不开」变成一个没有出口的状态；这里建完回到列表
 * （新卡片出现 + Toast 提示），用户从卡片进编辑器——e2e 的「新建 → 打开」两步也据此对齐。
 */
import { Button, Input, Modal } from '@dforge/ui';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';

/** 新建对话框 props。 */
export interface CreateDocumentDialogProps {
  open: boolean;
  /** 创建请求进行中。 */
  pending: boolean;
  onCancel: () => void;
  onSubmit: (name: string) => void;
}

/** 新建文件对话框。 */
export function CreateDocumentDialog({
  open,
  pending,
  onCancel,
  onSubmit,
}: CreateDocumentDialogProps) {
  const [name, setName] = useState('');
  const [touched, setTouched] = useState(false);

  // 每次打开都回到默认名（上次输入不残留——避免误以旧名建两次）
  useEffect(() => {
    if (open) {
      setName(t('home.new.promptPlaceholder'));
      setTouched(false);
    }
  }, [open]);

  const invalid = touched && !isValidDocumentName(name);

  const submit = (): void => {
    if (pending) return; // 创建在飞：Enter 与按钮的二次触发一律丢弃（父级在飞守卫的同侧防线）
    setTouched(true);
    if (!isValidDocumentName(name)) return;
    onSubmit(name);
  };

  return (
    <Modal
      open={open}
      onOpenChange={(next) => {
        if (!next) onCancel();
      }}
      title={t('home.new.promptTitle')}
      closeLabel={t('home.dialog.close')}
      size="sm"
      footer={
        <>
          <Button onClick={onCancel}>{t('home.new.promptCancel')}</Button>
          <Button variant="primary" loading={pending} onClick={submit}>
            {t('home.new.promptCreate')}
          </Button>
        </>
      }
    >
      <Input
        fieldLabel={t('home.new.promptName')}
        placeholder={t('home.new.promptPlaceholder')}
        value={name}
        invalid={invalid}
        {...(invalid ? { errorMessage: t('home.new.promptEmpty') } : {})}
        onChange={(event) => {
          setName(event.target.value);
          setTouched(true);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') submit();
        }}
      />
    </Modal>
  );
}
