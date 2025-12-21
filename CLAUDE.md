# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

Alpha Video Maker 是一个纯前端的 Canvas 动画透明视频导出组件，将 HTML Canvas 动画离线逐帧渲染并导出为带 Alpha 通道的 MOV 视频。仅支持 Chromium 内核浏览器（Chrome 89+、Edge 89+）。

## 开发调试

### Vite 热更新

项目使用 Vite 作为开发服务器，**默认支持热更新（HMR）**：
- 修改代码后浏览器会自动刷新，无需手动执行 `npm run dev`
- 如果服务已通过 `./start.sh` 启动，直接修改代码即可实时预览
- CSS 修改会即时生效，无需刷新页面

### 常用命令

```bash
# 开发模式（启动 Vite 开发服务器，自动配置 COOP/COEP headers）
npm run dev

# 生产构建
npm run build

# 预览生产构建
npm run preview

# 类型检查
npm run typecheck

# ESLint 检查
npm run lint
npm run lint:fix
```

### 服务管理脚本

项目根目录提供了便捷的服务管理脚本（端口：32103）：

```bash
# 启动服务（后台运行，日志输出到 server.log）
./start.sh

# 停止服务
./stop.sh

# 重启服务
./restart.sh
```

**说明：**
- 服务以后台进程方式运行，PID 保存在 `server.pid`
- 日志文件：`server.log`
- 访问地址：`http://localhost:32103`
- 启动后 Vite 热更新自动生效，修改代码即可实时预览

## 架构设计

### 核心数据流

```
CanvasRenderer.renderAt(t) → PNG 帧 → ChunkedEncoder → FFmpeg.wasm → MOV 视频
```

### 模块职责

**core/** - 核心导出逻辑
- `types.ts`: 核心接口定义，包括 `CanvasRenderer`（动画必须实现的接口）、`ExportConfig`、`ExportProgress`
- `renderer.ts`: `FrameRenderer` 类，负责确定性时间控制和逐帧渲染，调用 `renderAt(t)` 生成 PNG
- `export-controller.ts`: `ExportController` 类，串联渲染与编码流程，管理完整导出生命周期

**encoder/** - FFmpeg 编码模块
- `ffmpeg-worker.ts`: Web Worker 入口，隔离 FFmpeg.wasm 运行
- `ffmpeg-bridge.ts`: `FFmpegBridge` 类，主线程与 Worker 的消息通信桥接
- `chunked-encoder.ts`: `ChunkedEncoder` 类，分段编码策略防止 OOM（每 chunk 编码后立即清理 PNG）
- `commands.ts`: FFmpeg 命令生成器，支持 qtrle 和 prores_4444 两种编码格式

**utils/** - 工具模块
- `environment.ts`: 环境检测（crossOriginIsolated、SharedArrayBuffer、Chromium 内核）
- `blob-utils.ts`: Canvas 到 Blob/Uint8Array 转换
- `memory.ts`: 内存管理工具

**ui/** - 用户界面
- `app.ts`: 主应用模块，管理导出流程的 UI 和状态，包含分辨率快捷切换按钮

**demo/** - 示例动画
- `index.ts`: 示例动画注册
- `particle-animation.ts`: 粒子动画示例
- `gradient-animation.ts`: 渐变动画示例

### 关键接口

实现动画必须遵循 `CanvasRenderer` 接口：

```typescript
interface CanvasRenderer {
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  renderAt(t: number): void | Promise<void>;  // 必须是确定性的
  dispose?(): void;
}
```

### 编码流程

1. **初始化**: 检测环境 → 加载 FFmpeg.wasm（多线程/单线程）
2. **分段渲染编码**: 每 `chunkFrames` 帧为一个分段
   - 渲染帧 → 写入 PNG 到虚拟文件系统
   - FFmpeg 编码为 part_xxx.mov
   - 立即清理 PNG 文件释放内存
3. **合并**: 使用 FFmpeg concat demuxer 合并所有分段
4. **输出**: 生成最终 MOV Blob 供下载

### 路径别名

项目配置了 `@/*` 指向 `src/*`，例如 `import { CanvasRenderer } from '@/core/types'`

## 重要约束

1. **确定性渲染**: `renderAt(t)` 禁止使用 `Date.now()` 或 `performance.now()`，相同的 t 必须产生相同结果
2. **COOP/COEP**: 多线程模式需要服务器配置 `Cross-Origin-Opener-Policy: same-origin` 和 `Cross-Origin-Embedder-Policy: credentialless`
3. **参数限制**: 最大时长 10 秒，最大分辨率 3840×2160
4. **同源资源**: Canvas 绘制的图片必须同源或带正确 CORS

## 编码格式

| 格式 | 编码器 | 像素格式 | 用途 |
|------|--------|----------|------|
| qtrle | qtrle | argb | 默认，无损压缩，兼容性好 |
| prores_4444 | prores_ks | yuva444p10le | 专业后期，高质量 |

## UI 功能

### 分辨率预设

默认分辨率为 **1080×1920（竖屏 9:16）**，支持以下预设：

| 类型 | 分辨率 |
|------|--------|
| 竖屏 9:16 | 1080×1920, 720×1280 |
| 横屏 16:9 | 1920×1080, 1280×720 |
| 正方形 1:1 | 1080×1080, 720×720 |
| 竖屏 3:4 | 1080×1440, 720×960 |
| 横屏 4:3 | 1440×1080, 960×720 |

### 快捷切换按钮

UI 提供三个快捷切换按钮，点击即可切换状态：

| 按钮 | 功能 | 切换值 |
|------|------|--------|
| 清晰度 | 切换分辨率档位 | 1080p ↔ 720p |
| 比例 | 切换画面比例 | 正常(9:16/16:9) ↔ 方形(1:1) |
| 方向 | 切换横竖屏 | 竖屏 ↔ 横屏 |

**注意**：选择"方形"时，方向按钮会禁用（方形无横竖之分）

### 预览区域

- 预览区域会根据当前分辨率自动调整宽高比
- 蓝色虚线框精确标识输出区域边界
- 支持动画内容缩放（0.5x ~ 3x）
