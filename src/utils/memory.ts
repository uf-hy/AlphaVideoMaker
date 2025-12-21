/**
 * 内存管理工具
 * 帮助监控和管理内存使用，防止 OOM
 */

/**
 * 内存使用信息
 */
export interface MemoryUsage {
  /** 已使用的堆内存 (字节) */
  usedJSHeapSize: number;
  /** 总堆内存 (字节) */
  totalJSHeapSize: number;
  /** 堆内存限制 (字节) */
  jsHeapSizeLimit: number;
  /** 使用率 (0-1) */
  usageRatio: number;
}

/**
 * 扩展 Performance 接口以支持 memory 属性
 */
interface PerformanceWithMemory extends Performance {
  memory?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
    jsHeapSizeLimit: number;
  };
}

/**
 * 获取当前内存使用情况
 * 注意：此 API 仅在 Chromium 浏览器中可用
 */
export function getMemoryUsage(): MemoryUsage | null {
  const perf = performance as PerformanceWithMemory;

  if (!perf.memory) {
    return null;
  }

  const { usedJSHeapSize, totalJSHeapSize, jsHeapSizeLimit } = perf.memory;

  return {
    usedJSHeapSize,
    totalJSHeapSize,
    jsHeapSizeLimit,
    usageRatio: usedJSHeapSize / jsHeapSizeLimit,
  };
}

/**
 * 检查内存是否充足
 * @param threshold 警告阈值 (0-1)，默认 0.8 (80%)
 */
export function isMemorySufficient(threshold = 0.8): boolean {
  const usage = getMemoryUsage();
  if (!usage) {
    // 无法检测时假设内存充足
    return true;
  }
  return usage.usageRatio < threshold;
}

/**
 * 估算导出所需内存
 * @param width 视频宽度
 * @param height 视频高度
 * @param fps 帧率
 * @param duration 时长 (秒)
 * @param chunkFrames 每个分段的帧数
 */
export function estimateMemoryRequired(
  width: number,
  height: number,
  fps: number,
  duration: number,
  chunkFrames: number
): number {
  // 每帧 PNG 大约占用 width * height * 4 字节 (RGBA)
  // 压缩后约为原始大小的 50-70%
  const frameSize = width * height * 4 * 0.6;

  // 同时在内存中的帧数 = chunkFrames
  const framesInMemory = chunkFrames;

  // FFmpeg 编码缓冲区（估算）
  const ffmpegBuffer = width * height * 4 * 2;

  // 总估算
  const totalFrames = Math.ceil(fps * duration);
  const chunks = Math.ceil(totalFrames / chunkFrames);

  // 峰值内存 = 一个 chunk 的帧 + FFmpeg 缓冲区
  const peakMemory = frameSize * framesInMemory + ffmpegBuffer;

  return peakMemory;
}

/**
 * 格式化内存大小
 */
export function formatMemory(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(0)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}

/**
 * 检查导出参数是否存在内存风险
 */
export function checkMemoryRisk(
  width: number,
  height: number,
  fps: number,
  duration: number,
  chunkFrames: number
): { isRisky: boolean; message: string } {
  const required = estimateMemoryRequired(
    width,
    height,
    fps,
    duration,
    chunkFrames
  );
  const usage = getMemoryUsage();

  // 如果无法获取内存信息，根据参数给出经验性警告
  if (!usage) {
    const isRisky =
      (width >= 1920 && height >= 1080 && fps >= 60) ||
      (width >= 3840 || height >= 2160) ||
      duration >= 10;

    return {
      isRisky,
      message: isRisky
        ? '当前参数组合可能导致内存不足，建议降低分辨率、帧率或时长'
        : '',
    };
  }

  const available = usage.jsHeapSizeLimit - usage.usedJSHeapSize;
  const isRisky = required > available * 0.7; // 留 30% 余量

  return {
    isRisky,
    message: isRisky
      ? `预估需要 ${formatMemory(required)} 内存，当前可用约 ${formatMemory(available)}，可能导致内存不足`
      : '',
  };
}

/**
 * 尝试触发垃圾回收
 * 注意：这只是建议，实际 GC 由浏览器决定
 */
export function suggestGC(): void {
  // 创建并立即释放大数组，可能触发 GC
  // 这是一种 hack，不保证一定有效
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  let _temp: number[] | null = new Array(1000000);
  _temp = null;
}
