#!/usr/bin/env node
/**
 * df —— 设界 CLI 可执行入口（Node 原生 TS 类型擦除直跑，独立于编辑器/桌面壳）。
 *
 * 退出码语义（规格《市场首实现》§6.1）：0 通过 / 1 断言失败 / 2 阻塞（禁止假绿）。
 */

import { runCli } from '../src/index.ts';

process.exit(await runCli(process.argv.slice(2)));
