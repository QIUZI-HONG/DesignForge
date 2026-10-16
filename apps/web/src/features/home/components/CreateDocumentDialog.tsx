'use client';

import { DOCUMENT_NAME_MAX_LENGTH, describeDocumentNameIssue } from '@dforge/contracts';
/**
 * 新建文件对话框（FE-02 · B5 新建菜单的落地动作）。
 *
 * 为什么不「新建即跳编辑器」：本地优先链路上先落盘（daemon 建 `.dfg` 目录）再进编辑器，
 * 建好就跳会让「文件已建但编辑器打不开」变成一个没有出口的状态；这里建完回到列表
 * （新卡片出现 + Toast 提示），用户从卡片进编辑器——e2e 的「新建 → 打开」两步也据此对齐。
 *
 * 失败文案**分因**（UX-11）：空 / 超长 / 非法字符各给各的因由，不再一律「请输入文件名称」；
 * 重名仍由服务端判定（返回「已存在」经父级 Toast 呈现）。
 */
import { Button, Input, Modal } from '@dforge/ui';
import { useState } from 'react';

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
  const [name, setName] = useState(() => t('home.new.promptPlaceholder'));
  const [touched, setTouched] = useState(false);
  const [lastOpen, setLastOpen] = useState(open);

  // 默认名在**渲染期**随「打开」同一次提交落位（不是 effect）：
  // effect 在提交之后才跑，自动化/快速输入若落在这两步之间，会被迟到的默认名覆盖，
  // 甚至拼成「未命名设计冒烟文档」（e2e 实测形态 · UX-11 竞态硬化）。
  // 只在开/关**跳变**时重置，输入期间不打扰用户。
  if (open !== lastOpen) {
    setLastOpen(open);
    if (open) {
      setName(t('home.new.promptPlaceholder'));
      setTouched(false);
    }
  }

  const issue = touched ? describeDocumentNameIssue(name) : null;
  const invalid = issue !== null;

  const errorMessage = (): string => {
    if (issue === 'empty') return t('home.new.promptEmpty');
    if (issue === 'too_long') {
      return t('home.new.promptTooLong', { max: DOCUMENT_NAME_MAX_LENGTH });
    }
    return t('home.new.promptInvalid');
  };

  const submit = (): void => {
    if (pending) return; // 创建在飞：Enter 与按钮的二次触发一律丢弃（父级在飞守卫的同侧防线）
    setTouched(true);
    if (describeDocumentNameIssue(name) !== null) return;
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
        {...(invalid ? { errorMessage: errorMessage() } : {})}
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
