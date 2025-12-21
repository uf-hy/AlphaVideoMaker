# Canvas 动画透明视频导出组件 - MVP 执行计划

## 项目概述

- **目标**: 纯前端离线逐帧渲染，Canvas 动画 → 带 Alpha 的 .mov
- **技术栈**: Vanilla TypeScript + Vite
- **浏览器支持**: Chromium-only (Chrome/Edge)
- **输出格式**: .mov (qtrle / ProRes 4444)

## 执行步骤

### Phase 1: 基础设施

#### Step 1: 项目初始化
- [ ] 创建 Vite + TypeScript 项目
- [ ] 安装依赖: @ffmpeg/ffmpeg, @ffmpeg/util, @ffmpeg/core, @ffmpeg/core-mt
- [ ] 配置 vite.config.ts (COOP/COEP headers)
- [ ] 配置 ESLint + Prettier

#### Step 2: 核心类型定义
- [ ] CanvasRenderer 接口
- [ ] ExportConfig 类型
- [ ] ExportProgress 类型
- [ ] 编码器选项类型

### Phase 2: 核心引擎

#### Step 3: 环境检测模块
- [ ] crossOriginIsolated 检测
- [ ] SharedArrayBuffer 可用性检测
- [ ] Chromium 内核检测
- [ ] 警告信息生成

#### Step 4: FFmpeg Worker 模块
- [ ] Worker 入口文件
- [ ] FFmpeg 加载器 (multi-thread / single-thread)
- [ ] 主线程通信桥接
- [ ] 错误处理与资源清理

#### Step 5: 分段编码器
- [ ] Chunk 管理逻辑
- [ ] 帧文件写入
- [ ] FFmpeg 编码命令执行
- [ ] Chunk 合并 (concat)
- [ ] 临时文件清理

#### Step 6: 逐帧渲染引擎
- [ ] 确定性时间控制
- [ ] canvas.toBlob 帧生成
- [ ] Generator 模式帧产出
- [ ] 内存管理 (及时释放 Blob)

#### Step 7: 导出控制器
- [ ] 参数校验
- [ ] 渲染-编码流程串联
- [ ] 进度回调机制
- [ ] 取消操作支持
- [ ] 资源清理

### Phase 3: UI 与集成

#### Step 8: UI 组件
- [ ] WarningBanner (COOP/COEP 警告)
- [ ] ExportPanel (配置面板)
- [ ] ProgressBar (进度显示)
- [ ] ActionButtons (操作按钮)
- [ ] PreviewCanvas (预览区域)
- [ ] 整体布局与样式

#### Step 9: 示例动画
- [ ] 旋转渐变方块 Demo
- [ ] 弹跳小球 Demo
- [ ] 文字淡入淡出 Demo

#### Step 10: 集成测试
- [ ] 功能测试 (导出/取消/下载)
- [ ] 编码格式测试 (qtrle/ProRes)
- [ ] 分辨率/帧率组合测试
- [ ] 降级模式测试
- [ ] DaVinci Resolve 导入验证

## 关键技术决策

### FFmpeg 命令

```bash
# qtrle (默认)
ffmpeg -framerate {fps} -f image2 -i frame_%04d.png -c:v qtrle -pix_fmt yuva444p output.mov

# ProRes 4444
ffmpeg -framerate {fps} -f image2 -i frame_%04d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le output.mov

# 合并
ffmpeg -f concat -safe 0 -i list.txt -c copy output.mov
```

### 分段编码策略

- chunkFrames 默认: 30
- 每 chunk 完成后立即清理 PNG
- 最终合并后清理所有 part 文件

### 参数限制 (MVP)

- 分辨率: 1920×1080 / 1080×1080
- FPS: 30 (默认) / 60 (风险提示)
- 时长: 5s (默认) / 10s (上限)

## 文件结构

```
src/
├── core/
│   ├── types.ts              # 核心类型定义
│   ├── renderer.ts           # 逐帧渲染引擎
│   ├── export-controller.ts  # 导出控制器
│   └── time-controller.ts    # 时间控制
├── encoder/
│   ├── ffmpeg-worker.ts      # Worker 入口
│   ├── ffmpeg-bridge.ts      # 通信桥接
│   ├── chunked-encoder.ts    # 分段编码器
│   └── commands.ts           # FFmpeg 命令生成
├── ui/
│   ├── components/           # UI 组件
│   ├── styles/               # 样式文件
│   └── app.ts                # UI 入口
├── utils/
│   ├── environment.ts        # 环境检测
│   ├── memory.ts             # 内存管理
│   └── blob-utils.ts         # Blob 工具
├── demo/
│   └── sample-animation.ts   # 示例动画
└── main.ts                   # 应用入口
```

## 验收标准

### 功能验收
- [ ] Chrome/Edge 最新稳定版可运行
- [ ] 进度条 0% → 100% 正确更新
- [ ] 导出完成提供 .mov 下载
- [ ] 取消导出可立即停止并清理

### 质量验收 (DaVinci Resolve)
- [ ] 透明背景正确识别
- [ ] Alpha 边缘无锯齿/污染
- [ ] 帧数与 duration * fps 一致

### 性能验收
- [ ] 1080p/30fps/5s 可完成不崩溃
- [ ] 连续导出不 OOM
