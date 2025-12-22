/**
 * 导出控制器
 * 串联渲染与编码流程，管理完整导出生命周期
 */

import type {
  CanvasRenderer,
  ExportConfig,
  ExportProgress,
  ExportProgressCallback,
  ExportResult,
} from '@/core/types';
import { INITIAL_PROGRESS } from '@/core/types';
import { FrameRenderer, createFrameRenderer } from './renderer';
import {
  FFmpegBridge,
  createFFmpegBridge,
  ChunkedEncoder,
  createChunkedEncoder,
} from '@/encoder';
import { detectEnvironment } from '@/utils/environment';
import { generateFilename } from '@/utils/blob-utils';

/**
 * 导出控制器类
 */
export class ExportController {
  private canvas: HTMLCanvasElement;
  private renderer: CanvasRenderer;
  private config: ExportConfig;
  private onProgress: ExportProgressCallback;

  private frameRenderer: FrameRenderer | null = null;
  private ffmpegBridge: FFmpegBridge | null = null;
  private chunkedEncoder: ChunkedEncoder | null = null;

  private cancelled = false;
  private isRunning = false;
  private startTime = 0;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: CanvasRenderer,
    config: ExportConfig,
    onProgress: ExportProgressCallback
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.config = config;
    this.onProgress = onProgress;
  }

  /**
   * 开始导出
   */
  async start(): Promise<ExportResult> {
    if (this.isRunning) {
      return { success: false, error: '导出正在进行中' };
    }

    this.isRunning = true;
    this.cancelled = false;
    this.startTime = performance.now();

    try {
      // 1. 初始化
      this.updateProgress({ ...INITIAL_PROGRESS, phase: 'initializing' });

      // 检测环境
      const env = detectEnvironment();
      if (!env.hasWasm) {
        throw new Error('浏览器不支持 WebAssembly');
      }

      // 创建帧渲染器（传入目标输出尺寸和内容缩放）
      this.frameRenderer = createFrameRenderer(
        this.canvas,
        this.renderer,
        this.config.fps,
        this.config.duration,
        this.config.width,
        this.config.height,
        this.config.contentScale ?? 1,
        this.config.playbackRate ?? 1
      );

      const totalFrames = this.frameRenderer.getTotalFrames();
      const totalChunks = Math.ceil(totalFrames / this.config.chunkFrames);

      // 创建 FFmpeg 桥接器并加载
      this.ffmpegBridge = createFFmpegBridge();

      // 添加 FFmpeg 日志监听（用于调试）
      this.ffmpegBridge.onLog((message) => {
        console.log('[FFmpeg]', message);
      });

      // 添加 FFmpeg 进度监听
      this.ffmpegBridge.onProgress((progress) => {
        console.log('[FFmpeg Progress]', progress);
      });

      await this.ffmpegBridge.load(env.canUseMultiThread);

      if (this.cancelled) {
        throw new Error('导出已取消');
      }

      // 创建分段编码器
      this.chunkedEncoder = createChunkedEncoder(
        this.ffmpegBridge,
        this.config.fps,
        this.config.codec
      );

      // 2. 分段渲染与编码
      for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
        if (this.cancelled) {
          throw new Error('导出已取消');
        }

        const startFrame = chunkIndex * this.config.chunkFrames;
        const frameCount = Math.min(
          this.config.chunkFrames,
          totalFrames - startFrame
        );

        // 渲染阶段
        this.updateProgress({
          phase: 'rendering',
          currentFrame: startFrame,
          totalFrames,
          currentChunk: chunkIndex,
          totalChunks,
          percent: this.calculatePercent(startFrame, totalFrames, 'rendering'),
          estimatedTimeRemaining: this.estimateTimeRemaining(startFrame, totalFrames),
        });

        const frames = await this.frameRenderer.renderChunk(
          startFrame,
          frameCount,
          (renderProgress) => {
            this.updateProgress({
              phase: 'rendering',
              currentFrame: renderProgress.currentFrame,
              totalFrames,
              currentChunk: chunkIndex,
              totalChunks,
              percent: this.calculatePercent(
                renderProgress.currentFrame,
                totalFrames,
                'rendering'
              ),
              estimatedTimeRemaining: this.estimateTimeRemaining(
                renderProgress.currentFrame,
                totalFrames
              ),
            });
          }
        );

        if (this.cancelled) {
          throw new Error('导出已取消');
        }

        // 编码阶段
        this.updateProgress({
          phase: 'encoding',
          currentFrame: startFrame + frameCount,
          totalFrames,
          currentChunk: chunkIndex,
          totalChunks,
          percent: this.calculatePercent(
            startFrame + frameCount,
            totalFrames,
            'encoding'
          ),
          estimatedTimeRemaining: this.estimateTimeRemaining(
            startFrame + frameCount,
            totalFrames
          ),
        });

        await this.chunkedEncoder.encodeChunk(
          chunkIndex,
          frames,
          totalChunks,
          (encodeProgress) => {
            const frameProgress = startFrame + frameCount;
            this.updateProgress({
              phase: 'encoding',
              currentFrame: frameProgress,
              totalFrames,
              currentChunk: encodeProgress.chunkIndex,
              totalChunks: encodeProgress.totalChunks,
              percent: this.calculatePercent(frameProgress, totalFrames, 'encoding'),
              estimatedTimeRemaining: this.estimateTimeRemaining(
                frameProgress,
                totalFrames
              ),
            });
          }
        );
      }

      if (this.cancelled) {
        throw new Error('导出已取消');
      }

      // 3. 合并阶段
      this.updateProgress({
        phase: 'merging',
        currentFrame: totalFrames,
        totalFrames,
        currentChunk: totalChunks,
        totalChunks,
        percent: 95,
      });

      const outputData = await this.chunkedEncoder.mergeChunks();

      // 4. 完成
      // 创建 ArrayBuffer 副本，避免 SharedArrayBuffer 类型问题
      const arrayBuffer = new ArrayBuffer(outputData.byteLength);
      new Uint8Array(arrayBuffer).set(outputData);
      const blob = new Blob([arrayBuffer], { type: 'video/quicktime' });
      const filename = generateFilename('canvas_export', 'mov');

      this.updateProgress({
        phase: 'done',
        currentFrame: totalFrames,
        totalFrames,
        currentChunk: totalChunks,
        totalChunks,
        percent: 100,
      });

      return {
        success: true,
        blob,
        filename,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      this.updateProgress({
        ...INITIAL_PROGRESS,
        phase: this.cancelled ? 'cancelled' : 'error',
        error: errorMessage,
      });

      return {
        success: false,
        error: errorMessage,
      };
    } finally {
      await this.cleanup();
      this.isRunning = false;
    }
  }

  /**
   * 取消导出
   */
  cancel(): void {
    this.cancelled = true;
    this.frameRenderer?.cancel();
    this.chunkedEncoder?.cancel();
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    try {
      await this.chunkedEncoder?.cleanup();
    } catch {
      // 忽略清理错误
    }

    this.ffmpegBridge?.terminate();
    this.frameRenderer?.dispose();

    this.frameRenderer = null;
    this.ffmpegBridge = null;
    this.chunkedEncoder = null;
  }

  /**
   * 更新进度
   */
  private updateProgress(progress: ExportProgress): void {
    this.onProgress(progress);
  }

  /**
   * 计算进度百分比
   * 渲染阶段占 60%，编码阶段占 35%，合并阶段占 5%
   */
  private calculatePercent(
    currentFrame: number,
    totalFrames: number,
    phase: 'rendering' | 'encoding'
  ): number {
    const frameProgress = currentFrame / totalFrames;

    if (phase === 'rendering') {
      return Math.round(frameProgress * 60);
    } else {
      return Math.round(60 + frameProgress * 35);
    }
  }

  /**
   * 估算剩余时间
   */
  private estimateTimeRemaining(
    currentFrame: number,
    totalFrames: number
  ): number | undefined {
    if (currentFrame === 0) {
      return undefined;
    }

    const elapsed = performance.now() - this.startTime;
    const progress = currentFrame / totalFrames;

    if (progress === 0) {
      return undefined;
    }

    const totalEstimate = elapsed / progress;
    const remaining = totalEstimate - elapsed;

    return Math.max(0, Math.round(remaining));
  }
}

/**
 * 创建导出控制器
 */
export function createExportController(
  canvas: HTMLCanvasElement,
  renderer: CanvasRenderer,
  config: ExportConfig,
  onProgress: ExportProgressCallback
): ExportController {
  return new ExportController(canvas, renderer, config, onProgress);
}
