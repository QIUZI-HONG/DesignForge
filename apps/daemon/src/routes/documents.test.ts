import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { isDfgManifest } from '@dforge/contracts';
import { describe, expect, it } from 'vitest';
import type { TestDaemon } from '../testing/harness.ts';
import { createTestDaemon, injectJson } from '../testing/harness.ts';

/** 常用：建一个文档并返回 id（失败即测试失败）。 */
async function createDocument(daemon: TestDaemon, name = '演示文档'): Promise<string> {
  const created = await injectJson(daemon.app, {
    method: 'POST',
    url: '/documents',
    payload: { name },
  });
  expect(created.statusCode).toBe(201);
  return (created.payload as { result: { document: { id: string } } }).result.document.id;
}

describe('documents · 创建与目录态', () => {
  it('创建后落 .dfg 目录态：manifest.json 可校验 + 默认页面 + 原子写无残留临时文件', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '我的 设计' },
      });
      expect(statusCode).toBe(201);
      const document = (
        payload as { result: { document: { id: string; directory: string; pageCount: number } } }
      ).result.document;
      expect(document.id).toBe('我的-设计');
      expect(document.pageCount).toBe(1);

      const manifestRaw = await readFile(
        join(daemon.workspaceDir, '我的-设计.dfg', 'manifest.json'),
        'utf8',
      );
      const manifest = JSON.parse(manifestRaw) as unknown;
      expect(isDfgManifest(manifest)).toBe(true);

      const entries = await readdir(join(daemon.workspaceDir, '我的-设计.dfg'));
      expect(entries.sort()).toEqual(['manifest.json', 'pages']);
      // 目录名混入「我的 设计」不合法路径字符已在契约层拒绝，此处确保无 .tmp 残留
      const pageEntries = await readdir(join(daemon.workspaceDir, '我的-设计.dfg', 'pages'));
      expect(pageEntries).toEqual(['page-1.json']);
      expect(pageEntries.some((entry) => entry.endsWith('.tmp'))).toBe(false);
    } finally {
      await daemon.cleanup();
    }
  });

  it('同名冲突 → 409 doc_exists；非法名 → 400 doc_invalid_name', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon, '唯一');
      const duplicate = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '唯一' },
      });
      expect(duplicate.statusCode).toBe(409);
      expect((duplicate.payload as { error: { code: string } }).error.code).toBe('doc_exists');

      const invalid = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: 'a/b' },
      });
      expect(invalid.statusCode).toBe(400);
      expect((invalid.payload as { error: { code: string } }).error.code).toBe('doc_invalid_name');
    } finally {
      await daemon.cleanup();
    }
  });

  it('数据根被文件占据（ENOENT/ENOTDIR 竞态族的确定性替身）→ 409 conflict，不回显路径、零盘上变化', async () => {
    const daemon = await createTestDaemon();
    try {
      // 评审实测定不了位的是 create/delete 竞态：`rename …tmp -> manifest.json` ENOENT，
      // message 带绝对路径直落 500（store.ts create 提交段）。竞态在单进程里不可复现，
      // 但其错误族（ENOENT/ENOTDIR）可经「数据根变形」确定性触达 mkdir 阶段的同一映射：
      // 把 workspace 根换成普通文件 → mkdir(root/id.dfg) 必 ENOTDIR。
      await rm(daemon.workspaceDir, { recursive: true, force: true });
      await writeFile(daemon.workspaceDir, '这是一个文件，不是数据根目录');
      const res = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: '目录被占' },
      });
      expect(res.statusCode, res.raw).toBe(409);
      const error = (
        res.payload as { error: { code: string; details: { phase?: string; documentId?: string } } }
      ).error;
      expect(error.code).toBe('conflict');
      expect(error.details.phase).toBe('mkdir');
      expect(error.details.documentId).toBe('目录被占');
      // 安全口径与 F1-F4 一致：响应不回显宿主绝对路径
      expect(res.raw).not.toContain(daemon.tempDir);
      expect(res.raw).not.toContain(daemon.workspaceDir);
      // 拒了就是零盘上变化：占据根的文件原样在位
      expect(await readFile(daemon.workspaceDir, 'utf8')).toBe('这是一个文件，不是数据根目录');
    } finally {
      await daemon.cleanup();
    }
  });

  it('无 manifest 空壳占名时 create → 类型化 409（phase=mkdir），不许谎报 doc_exists', async () => {
    // SE-5 的「并发删除/外部占用」形状可以确定性构造：目录在位、manifest 从未写出
    // （这正是 create/delete 竞速后盘上会留下的东西）。此时回 `doc_exists` 是在撒谎——
    // 那份「同名文档」既读不出来（GET 404），也删不掉前占住名字。
    const daemon = await createTestDaemon();
    try {
      const id = '竞态空壳';
      const docDir = join(daemon.workspaceDir, `${id}.dfg`);
      await mkdir(join(docDir, 'pages'), { recursive: true });
      await writeFile(join(docDir, 'pages', 'page-1.json'), '{}\n', 'utf8');

      const res = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: id },
      });
      expect(res.statusCode, res.raw).toBe(409);
      const error = (
        res.payload as {
          error: {
            code: string;
            message: string;
            details: { phase?: string; documentId?: string };
          };
        }
      ).error;
      expect(error.code).toBe('conflict');
      expect(error.details.phase).toBe('mkdir');
      expect(error.details.documentId).toBe(id);
      expect(error.message.length).toBeGreaterThan(0);
      expect(res.raw).not.toContain(daemon.tempDir);

      // 「已存在」的说法必须与读侧一致：空壳不是文档（GET 404），但可以被删掉后重建
      const readBack = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}`,
      });
      expect(readBack.statusCode).toBe(404);
      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}`,
      });
      expect(removed.statusCode, removed.raw).toBe(200);
      const recreated = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents',
        payload: { name: id },
      });
      expect(recreated.statusCode, recreated.raw).toBe(201);
      expect(await readdir(docDir)).toEqual(['manifest.json', 'pages']);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 列表与读取', () => {
  it('列表含体积与页数；按 updatedAt 倒序', async () => {
    const daemon = await createTestDaemon();
    try {
      // 真实时钟下逐次等到时钟越过上一写入时刻：保证 updatedAt 严格递增、无同毫秒平局
      const create = async (name: string): Promise<{ id: string; updatedAt: string }> => {
        const created = await injectJson(daemon.app, {
          method: 'POST',
          url: '/documents',
          payload: { name },
        });
        expect(created.statusCode).toBe(201);
        return (created.payload as { result: { document: { id: string; updatedAt: string } } })
          .result.document;
      };
      const waitPastIso = async (iso: string): Promise<void> => {
        const target = Date.parse(iso);
        for (let attempt = 0; attempt < 50 && Date.now() <= target; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 1));
        }
        expect(Date.now()).toBeGreaterThan(target);
      };

      const first = await create('甲');
      await waitPastIso(first.updatedAt);
      const second = await create('乙');
      await waitPastIso(second.updatedAt);
      expect(Date.parse(second.updatedAt)).toBeGreaterThan(Date.parse(first.updatedAt));
      // 给乙加一页：pageCount 断言非平凡（1 vs 2），且乙的 updatedAt 仍最新
      const createdPage = await injectJson(daemon.app, {
        method: 'POST',
        url: '/documents/乙/pages',
        payload: { name: '页面 2' },
      });
      expect(createdPage.statusCode).toBe(201);
      const pageUpdatedAt = (createdPage.payload as { result: { page: { updatedAt: string } } })
        .result.page.updatedAt;

      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents',
      });
      expect(statusCode).toBe(200);
      const result = (
        payload as {
          result: {
            documents: {
              id: string;
              updatedAt: string;
              pageCount: number;
              sizeBytes: number;
              warnings?: unknown;
            }[];
            warnings: unknown[];
          };
        }
      ).result;
      // 真断言倒序（不再 .sort() 抹掉顺序）：乙最新在前，且 updatedAt 严格递减
      expect(result.documents.map((doc) => doc.id)).toEqual(['乙', '甲']);
      expect(result.documents.map((doc) => doc.updatedAt)).toEqual([
        pageUpdatedAt,
        first.updatedAt,
      ]);
      const times = result.documents.map((doc) => Date.parse(doc.updatedAt));
      expect((times[0] ?? Number.NaN) > (times[1] ?? Number.NaN)).toBe(true);
      // 用例名承诺的页数：乙 2 页、甲 1 页
      expect(Object.fromEntries(result.documents.map((doc) => [doc.id, doc.pageCount]))).toEqual({
        乙: 2,
        甲: 1,
      });
      for (const document of result.documents) {
        expect(document.sizeBytes).toBeGreaterThan(0);
      }
      expect(result.warnings).toEqual([]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('不存在文档 → 404 doc_not_found', async () => {
    const daemon = await createTestDaemon();
    try {
      const { statusCode, payload } = await injectJson(daemon.app, {
        method: 'GET',
        url: '/documents/missing',
      });
      expect(statusCode).toBe(404);
      expect((payload as { error: { code: string } }).error.code).toBe('doc_not_found');
    } finally {
      await daemon.cleanup();
    }
  });

  it('manifest 损坏的目录：列表跳过并给 warning（不整批失败）', async () => {
    const daemon = await createTestDaemon();
    try {
      await createDocument(daemon, '好文档');
      const brokenDir = join(daemon.workspaceDir, '坏文档.dfg');
      await (await import('node:fs/promises')).mkdir(brokenDir, { recursive: true });
      await (await import('node:fs/promises')).writeFile(
        join(brokenDir, 'manifest.json'),
        '{ 不是 JSON',
      );

      const { payload } = await injectJson(daemon.app, { method: 'GET', url: '/documents' });
      const result = (
        payload as {
          result: { documents: { id: string }[]; warnings: { id: string; code: string }[] };
        }
      ).result;
      expect(result.documents.map((doc) => doc.id)).toEqual(['好文档']);
      expect(result.warnings).toEqual([
        expect.objectContaining({ id: '坏文档', code: 'manifest_invalid' }),
      ]);
    } finally {
      await daemon.cleanup();
    }
  });

  it('重命名只改 manifest.name（id/目录不变）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '原名');
      const renamed = await injectJson(daemon.app, {
        method: 'PATCH',
        url: `/documents/${encodeURIComponent(id)}`,
        payload: { name: '新名字' },
      });
      expect(renamed.statusCode).toBe(200);
      const document = (
        renamed.payload as { result: { document: { id: string; name: string; directory: string } } }
      ).result.document;
      expect(document.id).toBe(id);
      expect(document.name).toBe('新名字');
      expect(document.directory.endsWith(`${id}.dfg`)).toBe(true);
      expect((await stat(document.directory)).isDirectory()).toBe(true);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 页面读写（正文 opaque JSON）', () => {
  it('保存正文并回读（形状保真；manifest 版本自增）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '正文往返');
      const body = {
        width: 1440,
        height: 900,
        children: [{ kind: 'rect', x: 10, y: 20, width: 100, height: 50, fill: '#FF0000' }],
      };
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { body },
      });
      expect(saved.statusCode).toBe(200);

      const read = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect(read.statusCode).toBe(200);
      const result = (read.payload as { result: { body: unknown; page: { id: string } } }).result;
      expect(result.body).toEqual(body);
      expect(result.page.id).toBe('page-1');

      const manifest = JSON.parse(
        await readFile(join(daemon.workspaceDir, `${id}.dfg`, 'manifest.json'), 'utf8'),
      ) as { version: number };
      expect(manifest.version).toBe(2);
    } finally {
      await daemon.cleanup();
    }
  });

  it('缺 body 字段 → 400 doc_invalid_body；页面不存在 → 404 not_found', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '错误分支');
      const noBody = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: { notBody: 1 },
      });
      expect(noBody.statusCode).toBe(400);
      expect((noBody.payload as { error: { code: string } }).error.code).toBe('doc_invalid_body');

      const missingPage = await injectJson(daemon.app, {
        method: 'GET',
        url: `/documents/${encodeURIComponent(id)}/pages/page-99`,
      });
      expect(missingPage.statusCode).toBe(404);
      expect((missingPage.payload as { error: { code: string } }).error.code).toBe('not_found');
    } finally {
      await daemon.cleanup();
    }
  });

  it('页面增删：新增 page-2；删最后一页拒绝（409 doc_last_page）', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '多页');
      const created = await injectJson(daemon.app, {
        method: 'POST',
        url: `/documents/${encodeURIComponent(id)}/pages`,
        payload: { name: '详情页' },
      });
      expect(created.statusCode).toBe(201);
      const page = (created.payload as { result: { page: { id: string; name: string } } }).result
        .page;
      expect(page.id).toBe('page-2');
      expect(page.name).toBe('详情页');

      const deleteFirst = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
      });
      expect(deleteFirst.statusCode).toBe(200);

      const deleteLast = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}/pages/page-2`,
      });
      expect(deleteLast.statusCode).toBe(409);
      expect((deleteLast.payload as { error: { code: string } }).error.code).toBe('doc_last_page');
    } finally {
      await daemon.cleanup();
    }
  });

  it('删除文档后其页面读取 404；重复删除 404', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '待删');
      const removed = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}`,
      });
      expect(removed.statusCode).toBe(200);
      expect((removed.payload as { result: { deleted: boolean } }).result.deleted).toBe(true);

      const again = await injectJson(daemon.app, {
        method: 'DELETE',
        url: `/documents/${encodeURIComponent(id)}`,
      });
      expect(again.statusCode).toBe(404);
    } finally {
      await daemon.cleanup();
    }
  });
});

describe('documents · 画布页正文引用完整性守门（票 17）', () => {
  /** 实例节点最小形状（守门只依赖 type/componentId/componentSetId 引用字段）。 */
  function instanceNode(id: string, componentId: string): Record<string, unknown> {
    return {
      id,
      type: 'instance',
      name: id,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      fills: [],
      strokes: [],
      effects: [],
      cornerRadius: 0,
      componentId,
      overrides: {},
    };
  }

  /** 主组件节点最小形状。 */
  function componentNode(id: string, componentSetId: string | null = null) {
    return {
      id,
      type: 'component',
      name: id,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      fills: [],
      strokes: [],
      effects: [],
      cornerRadius: 0,
      children: [],
      variantProperties: null,
      componentSetId,
    };
  }

  /** 组件集节点最小形状（守门按类型存在性判引用）。 */
  function componentSetNode(id: string) {
    return {
      id,
      type: 'component_set',
      name: id,
      x: 0,
      y: 0,
      width: 100,
      height: 100,
      rotation: 0,
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      fills: [],
      strokes: [],
      effects: [],
      cornerRadius: 0,
      children: [],
    };
  }

  /** 画布页信封正文（与 web 侧 `encodePageBody` 同形）。 */
  function canvasBody(nodes: Record<string, unknown>, rootIds: string[]): Record<string, unknown> {
    return {
      $format: 'dforge.canvas.page',
      $version: 1,
      page: { id: 'page-1', name: '页面 1', rootIds, nodes, grid: { size: 100, visible: false } },
      tokens: { id: 'tokens', name: 'Tokens', groups: [] },
    };
  }

  it('合法画布正文（实例指向同页主组件）→ 正常保存 200', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门合法');
      const saved = await injectJson(daemon.app, {
        method: 'PUT',
        url: `/documents/${encodeURIComponent(id)}/pages/page-1`,
        payload: {
          body: canvasBody({ c1: componentNode('c1'), i1: instanceNode('i1', 'c1') }, ['c1', 'i1']),
        },
      });
      expect(saved.statusCode).toBe(200);
    } finally {
      await daemon.cleanup();
    }
  });

  it('悬空实例引用 → 422 doc_invalid_structure；盘上正文与 manifest 分毫未动', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门悬空');
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      const good = canvasBody({ c1: componentNode('c1'), i1: instanceNode('i1', 'c1') }, [
        'c1',
        'i1',
      ]);
      const saved = await injectJson(daemon.app, { method: 'PUT', url, payload: { body: good } });
      expect(saved.statusCode).toBe(200);
      const pagePath = join(daemon.workspaceDir, `${id}.dfg`, 'pages', 'page-1.json');
      const manifestPath = join(daemon.workspaceDir, `${id}.dfg`, 'manifest.json');
      const bodyBefore = await readFile(pagePath, 'utf8');
      const manifestBefore = JSON.parse(await readFile(manifestPath, 'utf8')) as {
        version: number;
      };

      const poisoned = canvasBody({ c1: componentNode('c1'), i1: instanceNode('i1', '幽灵') }, [
        'c1',
        'i1',
      ]);
      const rejected = await injectJson(daemon.app, {
        method: 'PUT',
        url,
        payload: { body: poisoned },
      });
      expect(rejected.statusCode).toBe(422);
      expect((rejected.payload as { error: { code: string } }).error.code).toBe(
        'doc_invalid_structure',
      );
      expect((rejected.payload as { error: { message: string } }).error.message).toContain(
        'missing-component',
      );

      // 落盘零变化：回读仍是上一版正文；页文件与 manifest 未被触碰
      const read = await injectJson(daemon.app, { method: 'GET', url });
      expect((read.payload as { result: { body: unknown } }).result.body).toEqual(good);
      expect(await readFile(pagePath, 'utf8')).toBe(bodyBefore);
      const manifestAfter = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number };
      expect(manifestAfter.version).toBe(manifestBefore.version);
    } finally {
      await daemon.cleanup();
    }
  });

  it('悬空组件集引用（主组件指向不存在的组件集）→ 422 missing-component-set；盘上未动', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门组件集');
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      // 合法基线：组件集 s1 在位，主组件 c1 指向它。
      const good = canvasBody({ s1: componentSetNode('s1'), c1: componentNode('c1', 's1') }, [
        's1',
        'c1',
      ]);
      const saved = await injectJson(daemon.app, { method: 'PUT', url, payload: { body: good } });
      expect(saved.statusCode).toBe(200);
      const pagePath = join(daemon.workspaceDir, `${id}.dfg`, 'pages', 'page-1.json');
      const bodyBefore = await readFile(pagePath, 'utf8');

      // 投毒：c1 指向不存在的组件集——正是引擎 missing-component-set 的那类悬空引用。
      const poisoned = canvasBody({ c1: componentNode('c1', '幽灵集') }, ['c1']);
      const rejected = await injectJson(daemon.app, {
        method: 'PUT',
        url,
        payload: { body: poisoned },
      });
      expect(rejected.statusCode).toBe(422);
      expect((rejected.payload as { error: { code: string } }).error.code).toBe(
        'doc_invalid_structure',
      );
      expect((rejected.payload as { error: { message: string } }).error.message).toContain(
        'missing-component-set',
      );

      const read = await injectJson(daemon.app, { method: 'GET', url });
      expect((read.payload as { result: { body: unknown } }).result.body).toEqual(good);
      expect(await readFile(pagePath, 'utf8')).toBe(bodyBefore);
    } finally {
      await daemon.cleanup();
    }
  });

  it('422 引用清单必须截断（8 条 + 总数）：巨量悬空引用的响应字节有界', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门无界');
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      // 一批悬空实例引用（每个实例指向不存在的主组件）。修复前 store.ts 全量 join 每一条 issue
      // 且原样塞进 details.issues → 响应随引用数线性膨胀（评审实测 1MB 请求 → 2MB 响应）。
      const nodes: Record<string, unknown> = {};
      const rootIds: string[] = [];
      const total = 3000;
      for (let i = 0; i < total; i += 1) {
        const nid = `i${String(i)}`;
        nodes[nid] = { type: 'instance', id: nid, componentId: `ghost-${String(i)}` };
        rootIds.push(nid);
      }

      const rejected = await injectJson(daemon.app, {
        method: 'PUT',
        url,
        payload: { body: canvasBody(nodes, rootIds) },
      });
      expect(rejected.statusCode).toBe(422);
      // 响应字节必须远小于 32KB（钉死「422 无上限」）
      expect(rejected.raw.length).toBeLessThan(32 * 1024);
      const error = (
        rejected.payload as {
          error: { message: string; details: { issues: string[]; issueCount?: number } };
        }
      ).error;
      expect(error.details.issues.length).toBeLessThanOrEqual(8);
      expect(error.message).toContain('missing-component');
      // 总数如实交代：被截断的条数仍以 issueCount/消息里的总数呈现
      expect(error.details.issueCount).toBe(total);
      expect(error.message).toContain(String(total));
    } finally {
      await daemon.cleanup();
    }
  });

  it('恶意正文让守门自身抛异常（节点 id 不可转字符串）→ 422 类型化拒绝，不逃 500、不回显异常文本', async () => {
    const daemon = await createTestDaemon();
    try {
      const id = await createDocument(daemon, '守门恶意');
      const url = `/documents/${encodeURIComponent(id)}/pages/page-1`;
      const manifestPath = join(daemon.workspaceDir, `${id}.dfg`, 'manifest.json');
      const before = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number };

      // {toString: 1}：ToPrimitive 发现 toString 不可调用 → 守门里 String(node.id) 抛
      // TypeError（评审实测：异常一路逃出 store，500 原样回显 "Cannot convert …"）。
      // 这是客户端输入问题，必须落 4xx 类型化拒绝——且绝不把正文写下去。
      const hostile = canvasBody(
        { i1: { type: 'instance', id: { toString: 1 }, componentId: '幽灵' } },
        ['i1'],
      );
      const rejected = await injectJson(daemon.app, {
        method: 'PUT',
        url,
        payload: { body: hostile },
      });
      expect(rejected.statusCode, rejected.raw).toBe(422);
      expect((rejected.payload as { error: { code: string } }).error.code).toBe(
        'doc_invalid_structure',
      );
      expect(rejected.raw).not.toContain('Cannot convert');
      // 拒绝 = 零盘上变化（提交点之前、锁之前拒绝）
      const after = JSON.parse(await readFile(manifestPath, 'utf8')) as { version: number };
      expect(after.version).toBe(before.version);
    } finally {
      await daemon.cleanup();
    }
  });
});
