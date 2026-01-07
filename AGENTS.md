# AGENTS.md - Alpha Video Maker

Canvas 动画透明视频导出组件（纯前端），仅支持 Chromium 内核浏览器（Chrome 89+、Edge 89+）。

## 构建命令

```bash
npm run dev        # 开发服务器（Vite HMR）
npm run build      # 生产构建（tsc + vite build）
npm run typecheck  # 类型检查
npm run lint       # ESLint 检查
npm run lint:fix   # ESLint 自动修复
```

### 服务管理（端口 32103）

```bash
./start.sh    # 后台启动，日志 → server.log
./stop.sh     # 停止服务
./restart.sh  # 重启服务
```

### 测试

暂无测试框架，推荐 Vitest。

## 项目结构

```
src/
├── core/           # 核心：types.ts, renderer.ts, export-controller.ts
├── encoder/        # FFmpeg：ffmpeg-worker.ts, ffmpeg-bridge.ts, chunked-encoder.ts, commands.ts
├── editor/         # HTML编辑器：html-editor.ts, html-renderer.ts, iframe-preview.ts, templates.ts
├── ui/             # 界面：app.ts, html-editor-app.ts
├── utils/          # 工具：environment.ts, blob-utils.ts, memory.ts, async.ts
├── demo/           # 示例动画
└── main.ts         # 入口
```

## TypeScript 配置

- Target: ES2022, Module: ESNext, Strict: true
- `noUncheckedIndexedAccess`: true（数组访问需判空）
- `verbatimModuleSyntax`: true（type 导入需显式标注）
- 路径别名：`@/*` → `src/*`

## 代码风格

### 导入顺序

```typescript
import type { CanvasRenderer } from '@/core/types';  // 1. 类型导入
import { FFmpeg } from '@ffmpeg/ffmpeg';             // 2. 外部依赖
import { detectEnvironment } from '@/utils';         // 3. 内部模块（@/别名）
import { createFrameRenderer } from './renderer';    // 4. 相对路径
```

### 命名规范

- 类/接口/类型：PascalCase（`ExportController`）
- 函数：camelCase（`createExportController`）
- 常量：UPPER_SNAKE_CASE（`DEFAULT_EXPORT_CONFIG`）
- 文件：kebab-case（`export-controller.ts`）

### 类型安全

```typescript
// 禁止：as any、@ts-ignore、@ts-expect-error

// 数组访问必须判空
const item = array[0];
if (item) { doSomething(item); }
```

### 错误处理

```typescript
// 错误信息提取
const msg = error instanceof Error ? error.message : String(error);

// 清理操作可忽略错误
try { await ffmpeg.deleteFile(path); } catch { /* 忽略 */ }
```

### 异步模式

```typescript
import { withTimeout } from '@/utils';
await withTimeout(asyncOp(), 15000, '操作超时');
```

## 核心接口

```typescript
interface CanvasRenderer {
  readonly width: number;
  readonly height: number;
  readonly duration: number;  // 秒
  renderAt(t: number): void | Promise<void>;  // 必须确定性！
  dispose?(): void;
}
```

**关键约束**：`renderAt(t)` 禁止使用 `Date.now()` 或 `performance.now()`。

### 工厂函数模式

```typescript
export class ExportController { ... }
export function createExportController(...): ExportController {
  return new ExportController(...);
}
```

## 重要约束

1. **确定性渲染**：相同 `t` 必须产生相同结果
2. **COOP/COEP**：多线程需配置响应头
3. **参数限制**：最大时长 10s，最大分辨率 3840x2160
4. **同源资源**：Canvas 图片必须同源或带 CORS

## 编码格式

| 格式 | 编码器 | 像素格式 | 用途 |
|------|--------|----------|------|
| qtrle | qtrle | argb | 默认，无损 |
| prores_4444 | prores_ks | yuva444p10le | 专业后期 |

## 模块导出规范

每个目录包含 `index.ts` 统一导出：

```typescript
export * from './types';
export { FrameRenderer, createFrameRenderer } from './renderer';
```

## Agent 注意事项

1. 修改类型后运行 `npm run typecheck`
2. 新增文件需在 `index.ts` 中导出
3. Worker 代码需测试多线程/单线程两种模式
4. UI 修改后用 `./start.sh` 启动预览
5. 保持中文注释风格
