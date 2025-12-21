# Alpha Video Maker

HTML Canvas 动画透明视频导出组件 - 纯前端离线逐帧渲染，将 Canvas 动画导出为带 Alpha 通道的 MOV 视频。

## ✨ 特性

- 🎬 **离线逐帧渲染** - 稳定帧率、无丢帧、每帧可控
- 🎨 **透明通道支持** - 输出带 Straight Alpha 的 MOV 视频
- 🔧 **双编码格式** - Apple Animation (QTRLE) / ProRes 4444
- ⚡ **多线程加速** - 支持 FFmpeg.wasm 多线程 (需 COOP/COEP)
- 🛡️ **内存优化** - 分段编码 (Chunked Encode) 防止 OOM
- 🖥️ **纯前端** - 无需服务器，所有处理在浏览器完成

## 📋 浏览器要求

- **支持**: Chrome 89+, Edge 89+ (Chromium 内核)
- **不支持**: Safari, Firefox

## 🚀 快速开始

### 安装依赖

```bash
npm install
```

### 开发模式

```bash
npm run dev
```

访问 `http://localhost:5173`

### 生产构建

```bash
npm run build
```

## 🔧 部署配置

**必须配置以下响应头以启用多线程模式：**

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: credentialless
```

> 未配置时将降级为单线程模式，编码速度会显著下降。

## 📖 使用方法

### 1. 实现 CanvasRenderer 接口

```typescript
import type { CanvasRenderer } from '@/core/types';

class MyAnimation implements CanvasRenderer {
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 5; // 秒

  constructor(private ctx: CanvasRenderingContext2D) {}

  // 必须实现：渲染指定时间点的帧
  // 要求：确定性渲染，相同的 t 必须产生相同结果
  renderAt(t: number): void {
    this.ctx.clearRect(0, 0, this.width, this.height);
    // 你的渲染逻辑...
  }

  // 可选：清理资源
  dispose(): void {}
}
```

### 2. 创建导出控制器

```typescript
import { createExportController } from '@/core';

const controller = createExportController(
  canvas,
  renderer,
  {
    codec: 'qtrle', // 或 'prores_4444'
    width: 1920,
    height: 1080,
    fps: 30,
    duration: 5,
    chunkFrames: 30,
  },
  (progress) => {
    console.log(`进度: ${progress.percent}%`);
  }
);

const result = await controller.start();
if (result.success && result.blob) {
  // 下载视频
  downloadBlob(result.blob, result.filename);
}
```

## 📁 项目结构

```
src/
├── core/                   # 核心模块
│   ├── types.ts            # 类型定义
│   ├── renderer.ts         # 逐帧渲染引擎
│   └── export-controller.ts # 导出控制器
├── encoder/                # FFmpeg 编码模块
│   ├── ffmpeg-worker.ts    # Worker 入口
│   ├── ffmpeg-bridge.ts    # 通信桥接
│   ├── chunked-encoder.ts  # 分段编码器
│   └── commands.ts         # FFmpeg 命令生成
├── ui/                     # UI 组件
│   └── app.ts              # 主应用
├── utils/                  # 工具函数
│   ├── environment.ts      # 环境检测
│   ├── memory.ts           # 内存管理
│   └── blob-utils.ts       # Blob 工具
├── demo/                   # 示例动画
│   └── sample-animation.ts
└── main.ts                 # 入口
```

## ⚠️ 重要约束

1. **确定性渲染**: `renderAt(t)` 必须是确定性的，禁止使用 `Date.now()` 或 `performance.now()`
2. **同源资源**: Canvas 绘制的图片必须同源或带正确 CORS，否则会导致 tainted canvas
3. **时长限制**: MVP 阶段最大支持 10 秒视频
4. **分辨率限制**: 最大 3840×2160

## 🎯 编码格式对比

| 格式 | 编码器 | 特点 | 推荐场景 |
|------|--------|------|----------|
| Apple Animation | qtrle | 无损压缩，兼容性最好 | 默认选择 |
| ProRes 4444 | prores_ks | 专业级，高质量 | 专业后期 |

## 📊 性能参考

| 参数 | 预估编码时间 |
|------|------------|
| 1080p, 30fps, 5s | ~30秒 (多线程) |
| 1080p, 30fps, 5s | ~2分钟 (单线程) |

## 📝 License

MIT
