import { describe, expect, it } from 'vitest';

import { isMcpCaller, isMcpWriteTool, MCP_ACK_TTL_MS, MCP_WRITE_TOOLS } from './index.ts';

describe('mcp · 确认桩契约', () => {
  it('写工具清单为架构 §4.5.4 的 7 个', () => {
    expect(MCP_WRITE_TOOLS).toHaveLength(7);
    expect(MCP_WRITE_TOOLS).toContain('df_apply_patch');
    expect(MCP_WRITE_TOOLS).toContain('df_version_restore');
  });

  it('ackToken 短时效（≤5 分钟）', () => {
    expect(MCP_ACK_TTL_MS).toBeGreaterThan(0);
    expect(MCP_ACK_TTL_MS).toBeLessThanOrEqual(5 * 60_000);
  });

  it('工具名/调用方白名单校验', () => {
    expect(isMcpWriteTool('df_apply_patch')).toBe(true);
    expect(isMcpWriteTool('df_get_tree')).toBe(false);
    expect(isMcpCaller('mcp:zcode')).toBe(true);
    expect(isMcpCaller('mcp:workbuddy')).toBe(true);
    expect(isMcpCaller('local-ai')).toBe(true);
    expect(isMcpCaller('random')).toBe(false);
  });
});
