import { describe, expect, it } from 'vitest';

import { CLI_BIN_NAME, CLI_MARKET_SUBCOMMANDS } from './index';

describe('@dforge/cli 骨架冒烟', () => {
  it('CLI 名为 df', () => {
    expect(CLI_BIN_NAME).toBe('df');
  });

  it('market 首批子命令齐四顶', () => {
    expect(CLI_MARKET_SUBCOMMANDS).toEqual(['collect', 'score', 'index', 'search']);
  });
});
