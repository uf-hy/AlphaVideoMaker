/**
 * 逐帧渲染引擎
 * 确定性时间控制，逐帧调用 renderAt(t)
 */

import type { CanvasRenderer, FpsOption } from '@/core/types';
import { canvasToBlob, blobToUint8Array } from '@/utils/blob-utils';
import { withTimeout } from '@/utils';

const DEFAULT_RENDER_AT_TIMEOUT_MS = 30000;

/**
 * 帧数据
 */
export interface FrameData {
  /** 帧索引 */
  index: number;
  /** 时间点 (秒) */
  time: number;
  /** PNG 数据 */
  data: Uint8Array;
}

/**
 * 渲染进度回调
 */
export interface RenderProgress {
  /** 当前帧索引 */
  currentFrame: number;
  /** 总帧数 */
  totalFrames: number;
  /** 当前时间 (秒) */
  currentTime: number;
  /** 总时长 (秒) */
  duration: number;
}

export type RenderProgressCallback = (progress: RenderProgress) => void;

/**
 * 帧渲染器类
 */
export class FrameRenderer {
  private canvas: HTMLCanvasElement;
  private renderer: CanvasRenderer;
  private fps: FpsOption;
  private duration: number;
  private totalFrames: number;
  private cancelled = false;

  // 播放速度（影响 renderAt(t) 的 t）
  private playbackRate: number;

  // 目标输出尺寸
  private targetWidth: number;
  private targetHeight: number;

  // 动画内容缩放比例
  private contentScale: number;

  // 输出 Canvas（用于最终输出）
  private outputCanvas: HTMLCanvasElement;
  private outputCtx: CanvasRenderingContext2D;

  constructor(
    canvas: HTMLCanvasElement,
    renderer: CanvasRenderer,
    fps: FpsOption,
    duration: number,
    targetWidth: number,
    targetHeight: number,
    contentScale: number = 1,
    playbackRate: number = 1
  ) {
    this.canvas = canvas;
    this.renderer = renderer;
    this.fps = fps;
    this.duration = duration;
    this.totalFrames = Math.ceil(duration * fps);
    this.targetWidth = targetWidth;
    this.targetHeight = targetHeight;
    this.contentScale = contentScale;
    this.playbackRate = playbackRate;

    // 保持主 Canvas 为渲染器的原始尺寸
    this.canvas.width = renderer.width;
    this.canvas.height = renderer.height;

    // 创建输出 Canvas（目标尺寸）
    this.outputCanvas = document.createElement('canvas');
    this.outputCanvas.width = targetWidth;
    this.outputCanvas.height = targetHeight;
    const ctx = this.outputCanvas.getContext('2d');
    if (!ctx) {
      throw new Error('无法创建输出 Canvas 上下文');
    }
    this.outputCtx = ctx;
  }

  /**
   * 获取总帧数
   */
  getTotalFrames(): number {
    return this.totalFrames;
  }

  /**
   * 渲染单帧
   * @param frameIndex 帧索引
   */
  async renderFrame(frameIndex: number): Promise<FrameData> {
    if (this.cancelled) {
      throw new Error('渲染已取消');
    }

    // 计算时间点（确定性）
    // - exportTime: 按导出 fps 递增
    // - renderTime: 受 playbackRate 影响，并按 renderer.duration 循环（与预览一致）
    const exportTime = frameIndex / this.fps;
    const rawTime = exportTime * this.playbackRate;
    const time = this.renderer.duration > 0 ? rawTime % this.renderer.duration : rawTime;

    // 在主 Canvas 上渲染（原始尺寸）
    await withTimeout(
      Promise.resolve(this.renderer.renderAt(time)),
      DEFAULT_RENDER_AT_TIMEOUT_MS,
      'renderAt 超时（可能是自定义 HTML 截图卡住）'
    );

    // 清除输出 Canvas
    this.outputCtx.clearRect(0, 0, this.targetWidth, this.targetHeight);

    // 计算缩放后的尺寸
    const scaledWidth = this.renderer.width * this.contentScale;
    const scaledHeight = this.renderer.height * this.contentScale;

    // 居中绘制
    const offsetX = Math.round((this.targetWidth - scaledWidth) / 2);
    const offsetY = Math.round((this.targetHeight - scaledHeight) / 2);

    // 将主 Canvas 内容缩放绘制到输出 Canvas
    this.outputCtx.drawImage(
      this.canvas,
      0, 0, this.renderer.width, this.renderer.height,
      offsetX, offsetY, scaledWidth, scaledHeight
    );

    // 导出为 PNG
    const blob = await canvasToBlob(this.outputCanvas);
    const data = await blobToUint8Array(blob);

    return {
      index: frameIndex,
      time,
      data,
    };
  }

  /**
   * 渲染一个分段的帧
   * @param startFrame 起始帧索引
   * @param frameCount 帧数量
   * @param onProgress 进度回调
   */
  async renderChunk(
    startFrame: number,
    frameCount: number,
    onProgress?: RenderProgressCallback
  ): Promise<Uint8Array[]> {
    const frames: Uint8Array[] = [];
    const endFrame = Math.min(startFrame + frameCount, this.totalFrames);

    for (let i = startFrame; i < endFrame; i++) {
      if (this.cancelled) {
        throw new Error('渲染已取消');
      }

      const frame = await this.renderFrame(i);
      frames.push(frame.data);

      onProgress?.({
        currentFrame: i + 1,
        totalFrames: this.totalFrames,
        currentTime: frame.time,
        duration: this.duration,
      });

      // 让出主线程，避免 UI 卡死
      await this.yieldToMain();
    }

    return frames;
  }

  /**
   * 生成帧的异步生成器
   * @param onProgress 进度回调
   */
  async *generateFrames(
    onProgress?: RenderProgressCallback
  ): AsyncGenerator<FrameData, void, unknown> {
    for (let i = 0; i < this.totalFrames; i++) {
      if (this.cancelled) {
        return;
      }

      const frame = await this.renderFrame(i);

      onProgress?.({
        currentFrame: i + 1,
        totalFrames: this.totalFrames,
        currentTime: frame.time,
        duration: this.duration,
      });

      yield frame;

      // 让出主线程
      await this.yieldToMain();
    }
  }

  /**
   * 让出主线程执行权
   * 使用 requestAnimationFrame 或 setTimeout
   */
  private yieldToMain(): Promise<void> {
    return new Promise((resolve) => {
      if (typeof requestAnimationFrame !== 'undefined') {
        requestAnimationFrame(() => resolve());
      } else {
        setTimeout(resolve, 0);
      }
    });
  }

  /**
   * 取消渲染
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.cancelled = false;
  }

  /**
   * 销毁渲染器
   */
  dispose(): void {
    this.cancel();
    this.renderer.dispose?.();
  }
}

/**
 * 创建帧渲染器
 */
export function createFrameRenderer(
  canvas: HTMLCanvasElement,
  renderer: CanvasRenderer,
  fps: FpsOption,
  duration: number,
  targetWidth: number,
  targetHeight: number,
  contentScale: number = 1,
  playbackRate: number = 1
): FrameRenderer {
  return new FrameRenderer(canvas, renderer, fps, duration, targetWidth, targetHeight, contentScale, playbackRate);
}
