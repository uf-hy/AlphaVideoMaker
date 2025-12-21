/**
 * Canvas 渲染器接口
 * 所有动画必须实现此接口才能被导出系统使用
 */
export interface CanvasRenderer {
  /** Canvas 宽度 (像素) */
  readonly width: number;
  /** Canvas 高度 (像素) */
  readonly height: number;
  /** 动画总时长 (秒) */
  readonly duration: number;
  /** 帧率 (可选，默认使用导出配置的 fps) */
  readonly fps?: number;

  /**
   * 渲染指定时间点的帧
   * @param t 时间 (秒)，范围 [0, duration]
   * @description 此方法必须是确定性的：相同的 t 必须产生相同的渲染结果
   *              禁止在内部使用 Date.now() 或任何非确定性时间源
   */
  renderAt(t: number): void | Promise<void>;

  /**
   * 清理资源 (可选)
   * 导出完成或取消时调用
   */
  dispose?(): void;
}

/**
 * 编码格式
 */
export type CodecType = 'qtrle' | 'prores_4444';

/**
 * 帧率选项
 */
export type FpsOption = 30 | 60;

/**
 * 分辨率预设
 */
export interface Resolution {
  width: number;
  height: number;
  label: string;
}

/**
 * 预设分辨率列表
 */
export const RESOLUTION_PRESETS: readonly Resolution[] = [
  // 竖屏 9:16
  { width: 1080, height: 1920, label: '1080×1920 (9:16)' },
  { width: 720, height: 1280, label: '720×1280 (9:16)' },
  // 横屏 16:9
  { width: 1920, height: 1080, label: '1920×1080 (16:9)' },
  { width: 1280, height: 720, label: '1280×720 (16:9)' },
  // 正方形 1:1
  { width: 1080, height: 1080, label: '1080×1080 (1:1)' },
  { width: 720, height: 720, label: '720×720 (1:1)' },
  // 竖屏 3:4
  { width: 1080, height: 1440, label: '1080×1440 (3:4)' },
  { width: 720, height: 960, label: '720×960 (3:4)' },
  // 横屏 4:3
  { width: 1440, height: 1080, label: '1440×1080 (4:3)' },
  { width: 960, height: 720, label: '960×720 (4:3)' },
] as const;

/**
 * 导出配置
 */
export interface ExportConfig {
  /** 编码格式 */
  codec: CodecType;
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
  /** 帧率 */
  fps: FpsOption;
  /** 时长 (秒)，上限 10s */
  duration: number;
  /** 每个分段的帧数 (用于 chunked encode) */
  chunkFrames: number;
  /** 动画内容缩放比例 (1 = 原始大小) */
  contentScale?: number;
}

/**
 * 默认导出配置
 */
export const DEFAULT_EXPORT_CONFIG: ExportConfig = {
  codec: 'qtrle',
  width: 1080,
  height: 1920,
  fps: 30,
  duration: 5,
  chunkFrames: 30,
} as const;

/**
 * 导出配置限制
 */
export const EXPORT_LIMITS = {
  /** 最大时长 (秒) */
  maxDuration: 10,
  /** 最小时长 (秒) */
  minDuration: 1,
  /** 最大分辨率宽度 */
  maxWidth: 3840,
  /** 最大分辨率高度 */
  maxHeight: 2160,
  /** 最小分辨率 */
  minDimension: 100,
} as const;

/**
 * 导出阶段
 */
export type ExportPhase =
  | 'idle'
  | 'initializing'
  | 'rendering'
  | 'encoding'
  | 'merging'
  | 'done'
  | 'error'
  | 'cancelled';

/**
 * 导出进度信息
 */
export interface ExportProgress {
  /** 当前阶段 */
  phase: ExportPhase;
  /** 当前帧索引 */
  currentFrame: number;
  /** 总帧数 */
  totalFrames: number;
  /** 当前分段索引 */
  currentChunk: number;
  /** 总分段数 */
  totalChunks: number;
  /** 进度百分比 (0-100) */
  percent: number;
  /** 预计剩余时间 (毫秒) */
  estimatedTimeRemaining?: number;
  /** 错误信息 (仅当 phase 为 'error' 时) */
  error?: string;
}

/**
 * 初始进度状态
 */
export const INITIAL_PROGRESS: ExportProgress = {
  phase: 'idle',
  currentFrame: 0,
  totalFrames: 0,
  currentChunk: 0,
  totalChunks: 0,
  percent: 0,
};

/**
 * 进度回调函数类型
 */
export type ExportProgressCallback = (progress: ExportProgress) => void;

/**
 * 导出结果
 */
export interface ExportResult {
  /** 是否成功 */
  success: boolean;
  /** 输出视频 Blob (成功时) */
  blob?: Blob;
  /** 输出文件名建议 */
  filename?: string;
  /** 错误信息 (失败时) */
  error?: string;
}

/**
 * 环境信息
 */
export interface EnvironmentInfo {
  /** 是否支持多线程 (crossOriginIsolated) */
  canUseMultiThread: boolean;
  /** 是否为 Chromium 内核 */
  isChromium: boolean;
  /** SharedArrayBuffer 是否可用 */
  hasSharedArrayBuffer: boolean;
  /** Web Worker 是否可用 */
  hasWorker: boolean;
  /** WebAssembly 是否可用 */
  hasWasm: boolean;
  /** 警告信息列表 */
  warnings: string[];
}

/**
 * FFmpeg Worker 消息类型
 */
export type FFmpegMessageType =
  | 'load'
  | 'exec'
  | 'writeFile'
  | 'readFile'
  | 'deleteFile'
  | 'createDir'
  | 'deleteDir'
  | 'listDir'
  | 'terminate';

/**
 * FFmpeg Worker 请求消息
 */
export interface FFmpegWorkerRequest {
  id: string;
  type: FFmpegMessageType;
  payload?: unknown;
}

/**
 * FFmpeg Worker 响应消息
 */
export interface FFmpegWorkerResponse {
  id: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * FFmpeg 进度事件
 */
export interface FFmpegProgressEvent {
  /** 当前处理的帧数 */
  frame: number;
  /** 当前处理的时间 (秒) */
  time: number;
  /** 进度百分比 (0-1) */
  progress: number;
}
