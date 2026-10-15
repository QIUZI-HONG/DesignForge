/**
 * @dforge/engine —— 编辑器内核（纯 TS、零 DOM、零运行时依赖）。
 *
 * 定位：设计文档真值（Design IR）+ 命令栈（**写操作唯一入口**）+ 几何/命中/吸附/布局/组件/令牌，
 * 渲染（CanvasKit）与 DOM 覆盖层归 FE-06。文档状态**不进 React state**：
 * 消费侧用 `CommandStack.getSnapshot()` + `subscribe()` 接 `useSyncExternalStore`。
 *
 * 分层（每层可独立测试）：
 * - `model/`（子路径 `@dforge/engine/model`）：Design IR 类型与构造（文档/页面/节点/样式/令牌形状）
 * - `scene/`：文档读写（纯函数、不可变）与节点查询
 * - `commands/`：命令栈——事务、撤销/重做、微任务结算；唯一写入口
 * - `geometry/`：矩阵、包围盒、8 手柄语义、命中测试
 * - `snap/`：吸附（阈值 6px，屏幕空间→世界换算）与参考线/测量数据
 * - `interaction/`：拖动/缩放/旋转/视口状态机（pointer 无关的纯 reducer）
 * - `selection/`：选择模型与派生几何/对齐计算
 * - `layout/`：自动布局子集（轴向堆叠/间距/内边距/对齐/尺寸模式）
 * - `components/`：主组件 ↔ 实例、覆盖与重置、变体
 * - `tokens/`：令牌解析（别名链 + 环检测）
 * - `clipboard/`：复制粘贴（含 id 重映射）
 * - `serialize/`：Design IR ⇄ JSON（稳定键序、幂等往返）
 *
 * 交互白名单 13 类（FE-06 语义，见 `whitelist.test.ts` 逐条断言）：
 * 选择 / 移动 / 缩放 / 旋转 / 画布缩放 / 画布平移 / 复制粘贴 / 层级 / 编组 / 撤销 / 对齐 / 吸附 / 文本编辑。
 */

export * from './clipboard/index';
export * from './commands/index';
export * from './components/index';
export * from './geometry/index';
export * from './interaction/index';
export * from './layout/index';
export * from './model/index';
export * from './scene/index';
export * from './selection/index';
export * from './serialize/index';

export * from './snap/index';
export * from './tokens/index';
