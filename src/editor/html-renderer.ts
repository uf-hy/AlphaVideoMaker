/**
 * HTML 动画渲染器
 * 实现 CanvasRenderer 接口，支持确定性模式和实时模式
 */

import html2canvas from 'html2canvas';
import type { CanvasRenderer } from '@/core/types';
import { createIframePreview, type IframePreview } from './iframe-preview';

const DEFAULT_IFRAME_READY_TIMEOUT_MS = 8000;
const DEFAULT_HTML2CANVAS_IMAGE_TIMEOUT_MS = 8000;

async function waitForIframeDomReady(
  iframe: HTMLIFrameElement,
  timeoutMs: number = DEFAULT_IFRAME_READY_TIMEOUT_MS
): Promise<void> {
  const start = performance.now();

  while (true) {
    const doc = iframe.contentDocument;
    const hasBody = Boolean(doc?.body);
    const readyState = doc?.readyState;

    // 不强依赖 load 事件：某些情况下（子资源挂起 / 被拦截）load 可能永远不触发。
    if (hasBody && (readyState === 'interactive' || readyState === 'complete')) {
      return;
    }

    // 超时后：只要有 body 就继续（尽量避免“永久卡死”）
    if (performance.now() - start > timeoutMs) {
      if (hasBody) return;
      throw new Error('iframe 初始化超时');
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

/**
 * 录制模式
 */
export type RecordMode = 'deterministic' | 'realtime';

export interface HtmlAnimationRendererOptions {
  /** HTML 代码 */
  html: string;
  /** 输出宽度 */
  width: number;
  /** 输出高度 */
  height: number;
  /** 动画时长 (秒) */
  duration: number;
  /** 录制模式 */
  mode: RecordMode;
  /** 用于渲染的隐藏容器 */
  hiddenContainer: HTMLElement;
}

/**
 * 创建 HTML 动画渲染器
 */
export function createHtmlAnimationRenderer(
  options: HtmlAnimationRendererOptions
): CanvasRenderer & {
  /** 获取 iframe 预览 */
  getPreview(): IframePreview;
  /** 更新 HTML */
  updateHtml(html: string): void;
  /** 设置渲染目标（必须先调用） */
  setRenderTarget(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void;
  /** 更新配置 */
  updateConfig(config: Partial<HtmlAnimationRendererOptions>): void;
} {
  let { html, width, height, duration, mode, hiddenContainer } = options;

  // 创建隐藏的 iframe 用于渲染
  const preview = createIframePreview({
    container: hiddenContainer,
    width,
    height,
  });

  // 等待 iframe 加载完成
  let isReady = false;
  const iframe = preview.getIframe();

  iframe.addEventListener('load', () => {
    isReady = true;
  });

  // 初始化内容（在 load 监听器之后，避免首次 load 丢失）
  preview.updateContent(html);

  /**
   * 等待 iframe 准备就绪
   */
  async function waitForReady(): Promise<void> {
    if (isReady) return;
    await waitForIframeDomReady(iframe);
    isReady = true;
  }

  /**
   * 确定性模式渲染
   * 通过设置 CSS 变量 --t 来控制动画进度
   */
  async function renderDeterministic(
    t: number,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ): Promise<void> {
    await waitForReady();

    // 计算进度 (0-1)
    const progress = Math.min(1, Math.max(0, t / duration));

    // 设置 CSS 变量
    preview.setProgress(progress);

    // 等待一帧让样式生效
    await new Promise((resolve) => requestAnimationFrame(resolve));

    // 使用 html2canvas 截图
    const contentWindow = preview.getContentWindow();
    if (!contentWindow?.document?.body) {
      throw new Error('iframe 内容未加载');
    }

    const capturedCanvas = await html2canvas(contentWindow.document.body, {
      backgroundColor: null, // 透明背景
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      windowWidth: width,
      windowHeight: height,
      width,
      height,
      scale: 1,
      logging: false,
      imageTimeout: DEFAULT_HTML2CANVAS_IMAGE_TIMEOUT_MS,
      useCORS: true,
      allowTaint: true,
    });

    // 绘制到目标 canvas
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(capturedCanvas, 0, 0);
  }

  /**
   * 实时模式渲染
   * 直接截取当前 iframe 状态
   */
  async function renderRealtime(
    _t: number,
    canvas: HTMLCanvasElement,
    ctx: CanvasRenderingContext2D
  ): Promise<void> {
    await waitForReady();

    const contentWindow = preview.getContentWindow();
    if (!contentWindow?.document?.body) {
      throw new Error('iframe 内容未加载');
    }

    const capturedCanvas = await html2canvas(contentWindow.document.body, {
      backgroundColor: null,
      x: 0,
      y: 0,
      scrollX: 0,
      scrollY: 0,
      windowWidth: width,
      windowHeight: height,
      width,
      height,
      scale: 1,
      logging: false,
      imageTimeout: DEFAULT_HTML2CANVAS_IMAGE_TIMEOUT_MS,
      useCORS: true,
      allowTaint: true,
    });

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(capturedCanvas, 0, 0);
  }

  // 用于存储渲染目标
  let targetCanvas: HTMLCanvasElement | null = null;
  let targetCtx: CanvasRenderingContext2D | null = null;

  return {
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get duration() {
      return duration;
    },

    async renderAt(t: number): Promise<void> {
      if (!targetCanvas || !targetCtx) {
        throw new Error('渲染目标未设置，请先调用 setRenderTarget(canvas, ctx)');
      }

      if (mode === 'deterministic') {
        await renderDeterministic(t, targetCanvas, targetCtx);
      } else {
        await renderRealtime(t, targetCanvas, targetCtx);
      }
    },

    dispose(): void {
      preview.destroy();
    },

    getPreview(): IframePreview {
      return preview;
    },

    updateHtml(newHtml: string): void {
      html = newHtml;
      preview.updateContent(html);
      isReady = false;
    },

    setRenderTarget(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
      targetCanvas = canvas;
      targetCtx = ctx;
    },

    updateConfig(config: Partial<HtmlAnimationRendererOptions>): void {
      if (config.width !== undefined) width = config.width;
      if (config.height !== undefined) height = config.height;
      if (config.duration !== undefined) duration = config.duration;
      if (config.mode !== undefined) mode = config.mode;

      if (config.width !== undefined || config.height !== undefined) {
        preview.resize(width, height);
      }

      if (config.html !== undefined) {
        this.updateHtml(config.html);
      }
    },
  };
}

/**
 * 创建用于导出的 HTML 渲染器
 * 这个版本接收外部 canvas 和 ctx
 */
export function createHtmlExportRenderer(
  options: HtmlAnimationRendererOptions & {
    canvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
  }
): CanvasRenderer {
  const { canvas, ctx, html, width, height, duration, mode, hiddenContainer } = options;

  // 创建隐藏的 iframe
  const preview = createIframePreview({
    container: hiddenContainer,
    width,
    height,
  });

  let isReady = false;
  const iframe = preview.getIframe();

  // 先添加事件监听器，再设置内容
  iframe.addEventListener('load', () => {
    isReady = true;
  });

  // 然后再设置内容
  preview.updateContent(html);

  async function waitForReady(): Promise<void> {
    if (isReady) return;
    await waitForIframeDomReady(iframe);
    isReady = true;
  }

  return {
    get width() {
      return width;
    },
    get height() {
      return height;
    },
    get duration() {
      return duration;
    },

    async renderAt(t: number): Promise<void> {
      await waitForReady();

      if (mode === 'deterministic') {
        const progress = Math.min(1, Math.max(0, t / duration));
        preview.setProgress(progress);
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      const contentWindow = preview.getContentWindow();
      if (!contentWindow?.document?.body) {
        throw new Error('iframe 内容未加载');
      }

      const capturedCanvas = await html2canvas(contentWindow.document.body, {
        backgroundColor: null,
        x: 0,
        y: 0,
        scrollX: 0,
        scrollY: 0,
        windowWidth: width,
        windowHeight: height,
        width,
        height,
        scale: 1,
        logging: false,
        imageTimeout: DEFAULT_HTML2CANVAS_IMAGE_TIMEOUT_MS,
        useCORS: true,
        allowTaint: true,
      });

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(capturedCanvas, 0, 0);
    },

    dispose(): void {
      preview.destroy();
    },
  };
}
