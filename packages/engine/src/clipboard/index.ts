/**
 * 剪贴板层公开面：复制/粘贴/副本（自包含载荷 + id 重映射）。
 */

export type { ClipboardPayload, PasteOptions } from './clipboard';
export {
  CLIPBOARD_FORMAT,
  CLIPBOARD_VERSION,
  clipboardIds,
  clipboardSize,
  copyNodes,
  duplicateCommands,
  PASTE_OFFSET,
  parseClipboard,
  pasteCommands,
  remapIds,
  remapNode,
  serializeClipboard,
} from './clipboard';
