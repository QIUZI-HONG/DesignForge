#!/usr/bin/env node
/**
 * 确保 Electron 二进制就位并打印其路径。
 *
 * 为什么需要：electron@44 的 npm 包**没有** postinstall 脚本（已核 `package.json` —— 仅 `bin` 与 `install.js`），
 * 二进制在首次 `require('electron')` / 跑 CLI 时懒下载；pnpm 10 的构建脚本白名单对其不适用。
 * 网络受限（如 GitHub release 不可达）时可用 `ELECTRON_MIRROR` 指定镜像再跑本脚本。
 */
const electronPath = require('electron');

process.stdout.write(`${electronPath}\n`);
