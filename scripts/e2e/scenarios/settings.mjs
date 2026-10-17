/**
 * 冒烟场景 · 设置 / 诊断跨域路径（审计 08 · 审计 07 的浏览器侧复验）。
 *
 * 覆盖（生产构建 + 真 Chromium + 同源网关）：
 *   ① 工作目录：读当前值 → 切到新目录 → 保存 → daemon `/health` 跟随 → 刷新逐字段恢复；
 *   ② DeepSeek 哨兵 key：写入只回掩码，响应/DOM/磁盘均无明文（**不触云**：从不发 AI 请求）；
 *   ③ ComfyUI 连通性：指向场景自起的本地 fixture，保存 + 探测 → `comfyui=ok`；
 *   ④ 诊断面板：环境行（data-root/workspace）与连通性三项（daemon/comfyui/ai）可用；
 *   ⑤ `ai.baseUrl` 只读核对：整个场景前后不变，且 fixture 未收到任何 `/chat/completions`。
 *
 * 纪律：哨兵 key 只在运行时拼接，不落日志/证据明文；fixture 只监听回环地址；
 * 不触碰 3000/4318 与 `~/.dforge`（runner 给独立数据根与端口）。
 */
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';

export const id = 'settings';
export const title = '设置/诊断跨域路径（工作目录 · 哨兵 key · ComfyUI 连通性）';

/** 哨兵 key（运行时拼接；任何证据里出现整串都视为泄漏）。 */
const SENTINEL_KEY = ['sk', 'e2e', 'sentinel', '0123456789abcdef'].join('-');

/** 起本地 ComfyUI fixture（只回环；记录全部请求路径）。 */
async function startComfyFixture() {
  const hits = [];
  const server = createServer((request, response) => {
    const url = request.url ?? '/';
    hits.push(url);
    response.setHeader('content-type', 'application/json');
    if (url === '/system_stats') {
      response.end(
        JSON.stringify({ devices: [{ name: 'Mock GPU (e2e)', vram_total: 8589934592 }] }),
      );
      return;
    }
    if (url === '/object_info') {
      response.end(
        JSON.stringify({
          CheckpointLoaderSimple: {
            input: { required: { ckpt_name: [['mock.safetensors'], {}] } },
          },
        }),
      );
      return;
    }
    response.statusCode = 404;
    response.end('{}');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const address = server.address();
  const port = typeof address === 'object' && address !== null ? address.port : 0;
  return {
    url: `http://127.0.0.1:${String(port)}`,
    hits,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

/** 读 daemon 配置（场景侧独立证据）。 */
async function readConfig(daemonUrl) {
  return fetch(`${daemonUrl}/config`)
    .then((response) => response.json())
    .catch(() => null);
}

/** 等某个 role=status 出现指定文案（保存态）。 */
async function waitForSaved(page, text = '已保存') {
  await page.waitForFunction(
    (expected) =>
      [...document.querySelectorAll('[role="status"]')].some((node) =>
        (node.textContent ?? '').includes(expected),
      ),
    text,
    { timeout: 15_000 },
  );
}

/** 等诊断连通性条目到达指定状态。 */
async function waitForConnectivityStatus(page, itemId, status) {
  await page.waitForFunction(
    ([id, expected]) =>
      document
        .querySelector(`[data-df-connectivity-item="${id}"]`)
        ?.getAttribute('data-df-connectivity-status') === expected,
    [itemId, status],
    { timeout: 20_000 },
  );
}

/** 主入口。 */
export async function run(page, ctx) {
  const fixture = await startComfyFixture();
  const requests = [];
  const consoleErrors = [];
  const pageErrors = [];
  page.on('request', (request) => requests.push(request.url()));
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(String(error)));

  try {
    const gateway = ctx.pageUrl;
    const daemonParam = `${gateway}/df`;
    const daemonQuery = `daemon=${encodeURIComponent(daemonParam)}`;
    const settingsUrl = `${gateway}/settings?${daemonQuery}`;

    // --- 0) 基线（daemon 侧独立真值） ---
    const healthStart = await fetch(`${ctx.daemonUrl}/health`)
      .then((response) => response.json())
      .catch(() => null);
    const configStart = await readConfig(ctx.daemonUrl);
    const workspaceStart = healthStart?.result?.workspaceDir ?? null;
    const dataRoot = healthStart?.result?.dataRoot ?? null;
    const aiBaseUrl = configStart?.result?.config?.ai?.baseUrl ?? null;
    const comfyStart = configStart?.result?.config?.comfy?.baseUrl ?? null;
    ctx.assert(
      typeof workspaceStart === 'string' && typeof dataRoot === 'string',
      '设置基线可读（daemon /health + /config）',
      `workspace=${String(workspaceStart)} dataRoot=${String(dataRoot)}`,
    );
    ctx.assert(
      typeof aiBaseUrl === 'string' && aiBaseUrl.length > 0,
      'ai.baseUrl 基线已记录（只读核对，不改配置）',
      String(aiBaseUrl),
    );

    // --- 1) 设置页就绪 + 工作目录读取 ---
    await page.goto(settingsUrl, { waitUntil: 'networkidle' });
    await page.locator('[data-df-settings-section="workspace"]').waitFor({ timeout: 20_000 });
    const workspaceInput = page.getByLabel('工作目录');
    const shownWorkspace = await workspaceInput.inputValue();
    ctx.assert(
      shownWorkspace === workspaceStart,
      '设置页显示 daemon 当前工作目录（读一致）',
      `shown=${shownWorkspace} daemon=${String(workspaceStart)}`,
    );

    // --- 2) 切换工作目录并保存 → daemon 跟随 ---
    const nextWorkspace = join(ctx.dataRoot, 'workspace-switched');
    await workspaceInput.fill(nextWorkspace);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await waitForSaved(page);
    const healthAfterSwitch = await fetch(`${ctx.daemonUrl}/health`)
      .then((response) => response.json())
      .catch(() => null);
    ctx.assert(
      healthAfterSwitch?.result?.workspaceDir === nextWorkspace,
      '工作目录保存后 daemon /health 跟随（持久化到配置）',
      `daemon=${String(healthAfterSwitch?.result?.workspaceDir)} expected=${nextWorkspace}`,
    );

    // --- 3) DeepSeek 哨兵 key：掩码展示 + 全链路无明文 ---
    await page.getByRole('button', { name: 'DeepSeek' }).click();
    await page.locator('[data-df-settings-section="ai"]').waitFor({ timeout: 10_000 });
    const aiBodyBefore = await page.locator('[data-df-settings-section="ai"]').innerText();
    ctx.assert(
      aiBodyBefore.includes('未配置密钥'),
      'AI 分区初始为未配置（无 key 降级态）',
      aiBodyBefore.slice(0, 160).replaceAll('\n', ' / '),
    );

    const credentialResponsePromise = page
      .waitForResponse(
        (response) =>
          response.request().method() === 'PUT' &&
          new URL(response.url()).pathname.endsWith('/config/credentials'),
        { timeout: 15_000 },
      )
      .catch(() => null);
    await page.getByLabel('API 密钥').fill(SENTINEL_KEY);
    await page.getByRole('button', { name: '保存密钥', exact: true }).click();
    await waitForSaved(page);
    const credentialResponse = await credentialResponsePromise;
    const credentialBody = credentialResponse === null ? '' : await credentialResponse.text();
    ctx.assert(
      credentialResponse !== null &&
        credentialResponse.status() === 200 &&
        !credentialBody.includes(SENTINEL_KEY) &&
        credentialBody.includes('maskedKey'),
      '写入 key 的响应只回掩码（无明文）',
      credentialResponse === null
        ? '未捕获 PUT /config/credentials 响应'
        : `HTTP ${String(credentialResponse.status())} 含明文=${String(credentialBody.includes(SENTINEL_KEY))}`,
    );

    const aiBodyAfter = await page.locator('[data-df-settings-section="ai"]').innerText();
    const configAfterKey = await readConfig(ctx.daemonUrl);
    const maskedKey = configAfterKey?.result?.credentials?.deepseek?.maskedKey ?? null;
    ctx.assert(
      typeof maskedKey === 'string' &&
        maskedKey.startsWith('sk-') &&
        !aiBodyAfter.includes(SENTINEL_KEY),
      'AI 分区只显示掩码（DOM 无明文）',
      `masked=${String(maskedKey)} plaintextInDom=${String(aiBodyAfter.includes(SENTINEL_KEY))}`,
    );
    const credentialsPath = join(ctx.dataRoot, 'credentials.json');
    const credentialsOnDisk = await readFile(credentialsPath, 'utf8').catch(() => null);
    ctx.assert(
      credentialsOnDisk !== null && !credentialsOnDisk.includes(SENTINEL_KEY),
      '凭据落盘为密文（credentials.json 无哨兵明文）',
      credentialsOnDisk === null ? 'credentials.json 不存在' : '密文存在且无明文',
    );

    // --- 4) ComfyUI：保存 fixture 地址 + 探测 → ok ---
    await page.getByRole('button', { name: 'ComfyUI' }).click();
    await page.locator('[data-df-settings-section="comfy"]').waitFor({ timeout: 10_000 });
    const comfyInput = page.getByLabel('服务地址');
    await comfyInput.fill(fixture.url);
    await page.getByRole('button', { name: '保存', exact: true }).click();
    await waitForSaved(page);
    await page.getByRole('button', { name: '重新探测' }).click();
    await page.getByText('已连接', { exact: false }).first().waitFor({ timeout: 20_000 });
    ctx.assert(
      fixture.hits.includes('/system_stats') && fixture.hits.includes('/object_info'),
      'ComfyUI 探测真实打到本地 fixture（system_stats + object_info）',
      JSON.stringify({ hits: fixture.hits }),
    );

    // --- 5) 诊断面板：环境行 + 连通性三项 ---
    await page.getByRole('button', { name: '诊断' }).click();
    await page.locator('[data-df-panel="diagnostics"]').waitFor({ timeout: 20_000 });
    await page.locator('[data-df-connectivity-item="daemon"]').waitFor({ timeout: 20_000 });
    const envDataRoot = await page
      .locator('[data-df-env-row="data-root"]')
      .textContent()
      .catch(() => null);
    const envWorkspace = await page
      .locator('[data-df-env-row="workspace"]')
      .textContent()
      .catch(() => null);
    ctx.assert(
      envDataRoot !== null && dataRoot !== null && envDataRoot.includes(dataRoot),
      '诊断环境行显示真实 dataRoot',
      String(envDataRoot),
    );
    ctx.assert(
      envWorkspace?.includes(nextWorkspace),
      '诊断环境行显示切换后的 workspace',
      String(envWorkspace),
    );
    await waitForConnectivityStatus(page, 'daemon', 'ok');
    await waitForConnectivityStatus(page, 'comfyui', 'ok');
    await waitForConnectivityStatus(page, 'ai', 'ok');
    const diagnosticsText = await page.locator('[data-df-panel="diagnostics"]').innerText();
    const errorBanner = await page.locator('[data-df-diagnostics-error="daemon"]').count();
    ctx.assert(
      errorBanner === 0 && !diagnosticsText.includes(SENTINEL_KEY),
      '诊断面板无 daemon 错误横幅且不含哨兵明文',
      JSON.stringify({ errorBanner, plaintext: diagnosticsText.includes(SENTINEL_KEY) }),
    );

    // --- 6) 刷新：设置逐字段恢复（持久化往返） ---
    await page.goto(settingsUrl, { waitUntil: 'networkidle' });
    await page.locator('[data-df-settings-section="workspace"]').waitFor({ timeout: 20_000 });
    const restoredWorkspace = await page.getByLabel('工作目录').inputValue();
    await page.getByRole('button', { name: 'DeepSeek' }).click();
    await page.locator('[data-df-settings-section="ai"]').waitFor({ timeout: 10_000 });
    const restoredAi = await page.locator('[data-df-settings-section="ai"]').innerText();
    await page.getByRole('button', { name: 'ComfyUI' }).click();
    await page.locator('[data-df-settings-section="comfy"]').waitFor({ timeout: 10_000 });
    const restoredComfy = await page.getByLabel('服务地址').inputValue();
    ctx.assert(
      restoredWorkspace === nextWorkspace,
      '刷新后工作目录逐字段恢复',
      `shown=${restoredWorkspace} expected=${nextWorkspace}`,
    );
    ctx.assert(
      typeof maskedKey === 'string' && restoredAi.includes(maskedKey),
      '刷新后 AI 仍显示同一掩码（凭据持久化）',
      restoredAi.slice(0, 160).replaceAll('\n', ' / '),
    );
    ctx.assert(
      restoredComfy === fixture.url && restoredComfy !== comfyStart,
      '刷新后 ComfyUI 地址恢复为 fixture 地址（配置持久化）',
      `shown=${restoredComfy} previous=${String(comfyStart)}`,
    );

    // --- 7) ai.baseUrl 只读核对：前后不变、无上游请求 ---
    const configEnd = await readConfig(ctx.daemonUrl);
    const aiBaseUrlEnd = configEnd?.result?.config?.ai?.baseUrl ?? null;
    ctx.assert(
      aiBaseUrl === aiBaseUrlEnd,
      'ai.baseUrl 全程未变（只读核对，不改外送面）',
      `start=${String(aiBaseUrl)} end=${String(aiBaseUrlEnd)}`,
    );
    const chatHits = fixture.hits.filter((url) => url.includes('/chat/completions'));
    ctx.assert(
      chatHits.length === 0,
      'fixture 未收到任何 /chat/completions（未触云、未外送 key）',
      JSON.stringify({ hits: fixture.hits }),
    );

    // --- 8) 四类不变量：同源网关 / 无 console、pageerror ---
    const httpRequests = requests.filter((url) => /^https?:\/\//.test(url));
    const foreign = httpRequests.filter((url) => new URL(url).origin !== gateway);
    ctx.assert(
      foreign.length === 0,
      '设置/诊断全程请求都在同源网关（无直连 daemon / 非网关 origin）',
      JSON.stringify({ requests: httpRequests.length, foreign: foreign.slice(0, 5) }),
    );
    const resident = httpRequests.filter((url) => /:(?:3000|4318)(?:\/|$)/.test(url));
    ctx.assert(
      resident.length === 0,
      '无对 3000/4318 常驻实例的调用（不碰真实数据根）',
      JSON.stringify({ resident: resident.slice(0, 5) }),
    );
    ctx.assert(
      consoleErrors.length === 0,
      '无 console 错误',
      JSON.stringify({ consoleErrors: consoleErrors.slice(0, 3) }),
    );
    ctx.assert(
      pageErrors.length === 0,
      '无未捕获异常（pageerror）',
      JSON.stringify({ pageErrors: pageErrors.slice(0, 3) }),
    );
  } finally {
    await fixture.close();
  }

  return { steps: [] };
}
