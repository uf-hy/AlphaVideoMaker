/**
 * HTML 动画渲染器
 * 实现 CanvasRenderer 接口，支持确定性模式和实时模式
 * 支持 html2canvas 和 SnapDOM 两种截图引擎
 */

import html2canvas from 'html2canvas';
import { snapdom } from '@zumer/snapdom';
import type { CanvasRenderer } from '@/core/types';
import { withTimeout } from '@/utils';
import { createIframePreview, type IframePreview } from './iframe-preview';

const DEFAULT_IFRAME_READY_TIMEOUT_MS = 8000;
const DEFAULT_HTML2CANVAS_IMAGE_TIMEOUT_MS = 8000;
const DEFAULT_RENDER_FRAME_TIMEOUT_MS = 20000;

/**
 * 截图引擎类型
 * - html2canvas: 传统引擎，兼容性好但渲染精度较低
 * - snapdom: 新引擎，使用 foreignObject SVG，渲染更准确、速度更快
 */
export type CaptureEngine = 'html2canvas' | 'snapdom';

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

    // 超时后：只要有 body 就继续（尽量避免"永久卡死"）
    if (performance.now() - start > timeoutMs) {
      if (hasBody) return;
      throw new Error('iframe 初始化超时');
    }

    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
}

type Html2CanvasOptions = Parameters<typeof html2canvas>[1];

function pickCaptureRoot(doc: Document): HTMLElement {
  // 某些情况下截 body 会因为高度/视口计算异常而出现"整张透明"
  // 使用 documentElement 更稳定（依旧遵循 windowWidth/windowHeight/width/height 裁剪）
  return (doc.documentElement as unknown as HTMLElement) ?? doc.body;
}

function isProbablyBlank(canvas: HTMLCanvasElement): boolean {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return false;

  const { width, height } = canvas;
  if (width <= 0 || height <= 0) return true;

  const samples: Array<[number, number]> = [
    [Math.floor(width / 2), Math.floor(height / 2)],
    [Math.floor(width / 4), Math.floor(height / 4)],
    [Math.floor((width * 3) / 4), Math.floor(height / 4)],
    [Math.floor(width / 4), Math.floor((height * 3) / 4)],
    [Math.floor((width * 3) / 4), Math.floor((height * 3) / 4)],
  ];

  for (const [x, y] of samples) {
    try {
      const pixel = ctx.getImageData(x, y, 1, 1).data;
      if (pixel[3] !== 0) return false;
    } catch {
      // ignore
    }
  }

  return true;
}

/**
 * 使用 html2canvas 截图（带 fallback）
 */
async function captureWithHtml2Canvas(
  doc: Document,
  baseOptions: Html2CanvasOptions
): Promise<HTMLCanvasElement> {
  const root = pickCaptureRoot(doc);

  // 优先 foreignObjectRendering：浏览器渲染的 CSS 支持更好（但有时会失败/变透明）
  try {
    const c = await html2canvas(root, { ...baseOptions, foreignObjectRendering: true });
    if (!isProbablyBlank(c)) return c;
  } catch {
    // fallback
  }

  return html2canvas(root, { ...baseOptions, foreignObjectRendering: false });
}

/**
 * 使用 SnapDOM 截图
 * SnapDOM 使用 foreignObject SVG 方法，渲染更准确
 */
async function captureWithSnapdom(
  doc: Document,
  scale: number,
  disableFontEmbed: boolean = false
): Promise<HTMLCanvasElement> {
  // SnapDOM 在 iframe 场景下应该用 body，而不是 documentElement
  // documentElement 可能包含视口/滚动条宽度，导致偏移
  const root = doc.body;
  console.log('[SnapDOM] 开始截图:', { scale, rootWidth: root.clientWidth, rootHeight: root.clientHeight, disableFontEmbed });

  const win = doc.defaultView;
  if (win) {
    win.scrollTo(0, 0);
  }

  // 等待字体加载完成
  if (doc.fonts && typeof doc.fonts.ready !== 'undefined') {
    await doc.fonts.ready;
  }

  const start = performance.now();
  try {
    const result = await snapdom(root, {
      embedFonts: !disableFontEmbed, // 根据选项控制字体嵌入
      scale,
      dpr: 1,
      outerTransforms: false,
      outerShadows: false,
    });
    console.log('[SnapDOM] 截图完成，耗时:', performance.now() - start, 'ms');
    
    // 检查是否全透明
    const canvas = await result.toCanvas();
    const ctx = canvas.getContext('2d');
    if (ctx) {
      const pixel = ctx.getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data;
      // console.log('[SnapDOM] 中心像素:', pixel);
    }
    return canvas;
  } catch (e) {
    console.error('[SnapDOM] 截图失败:', e);
    throw e;
  }
}

/**
 * 统一的截图函数，带自动降级：首选引擎失败/空白时切换到备选引擎
 */
async function captureFrame(
  doc: Document,
  width: number,
  height: number,
  engine: CaptureEngine,
  html2canvasOptions: Html2CanvasOptions,
  snapdomScale: number,
  disableFontEmbed: boolean = false
): Promise<HTMLCanvasElement> {
  const fallbackEngine: CaptureEngine = engine === 'snapdom' ? 'html2canvas' : 'snapdom';

  const tryCapture = async (eng: CaptureEngine): Promise<HTMLCanvasElement> => {
    if (eng === 'snapdom') {
      return captureWithSnapdom(doc, snapdomScale, disableFontEmbed);
    }
    return captureWithHtml2Canvas(doc, html2canvasOptions);
  };

  try {
    const canvas = await tryCapture(engine);
    if (!isProbablyBlank(canvas)) {
      return canvas;
    }
    console.warn(`[captureFrame] ${engine} 返回空白，降级到 ${fallbackEngine}`);
  } catch (e) {
    console.warn(`[captureFrame] ${engine} 失败:`, e, `降级到 ${fallbackEngine}`);
  }

  try {
    const fallbackCanvas = await tryCapture(fallbackEngine);
    if (!isProbablyBlank(fallbackCanvas)) {
      return fallbackCanvas;
    }
    console.warn(`[captureFrame] ${fallbackEngine} 也返回空白，返回透明帧`);
    return fallbackCanvas;
  } catch (e2) {
    console.error(`[captureFrame] 两个引擎都失败，创建空白 canvas:`, e2);
    const emptyCanvas = document.createElement('canvas');
    emptyCanvas.width = width;
    emptyCanvas.height = height;
    return emptyCanvas;
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
  /** 截图引擎 (默认 'html2canvas') */
  captureEngine?: CaptureEngine;
  /** 预览缩放比例 (0.5 / 0.75 / 1)，仅影响预览渲染 */
  previewScale?: number;
  /** 是否禁用字体嵌入 (预览时建议禁用以提升速度) */
  disableFontEmbed?: boolean;
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
  let {
    html,
    width,
    height,
    duration,
    mode,
    hiddenContainer,
    captureEngine = 'html2canvas',
    previewScale = 1,
    disableFontEmbed = false,
  } = options;

  // 创建隐藏的 iframe 用于渲染
  const preview = createIframePreview({
    container: hiddenContainer,
    width,
    height,
  });
  preview.setDurationSeconds(duration);

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
   * 获取 html2canvas 基础选项
   */
  function getHtml2CanvasOptions(): Html2CanvasOptions {
    return {
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
    };
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

    // 设置 CSS 变量，并同步 CSS Animation 到绝对时间点
    preview.setProgress(progress);

    // 等待一帧让样式生效
    await new Promise((resolve) => requestAnimationFrame(resolve));

    const contentWindow = preview.getContentWindow();
    if (!contentWindow?.document?.documentElement) {
      throw new Error('iframe 内容未加载');
    }

    const capturedCanvas = await withTimeout(
      captureFrame(
        contentWindow.document,
        width,
        height,
        captureEngine,
        getHtml2CanvasOptions(),
        previewScale
      ),
      DEFAULT_RENDER_FRAME_TIMEOUT_MS,
      'HTML 截图超时'
    );

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
    if (!contentWindow?.document?.documentElement) {
      throw new Error('iframe 内容未加载');
    }

    const capturedCanvas = await withTimeout(
      captureFrame(
        contentWindow.document,
        width,
        height,
        captureEngine,
        getHtml2CanvasOptions(),
        previewScale
      ),
      DEFAULT_RENDER_FRAME_TIMEOUT_MS,
      'HTML 截图超时'
    );

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
      if (config.captureEngine !== undefined) captureEngine = config.captureEngine;
      if (config.previewScale !== undefined) previewScale = config.previewScale;

      if (config.duration !== undefined) {
        preview.setDurationSeconds(duration);
      }

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
  const {
    canvas,
    ctx,
    html,
    width,
    height,
    duration,
    mode,
    hiddenContainer,
    captureEngine = 'html2canvas',
    previewScale = 1,
    disableFontEmbed = false,
  } = options;

  // 创建隐藏的 iframe
  const preview = createIframePreview({
    container: hiddenContainer,
    width,
    height,
  });
  preview.setDurationSeconds(duration);

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
    try {
      await withTimeout(
        waitForIframeDomReady(iframe),
        DEFAULT_IFRAME_READY_TIMEOUT_MS,
        'iframe DOM 就绪超时'
      );
      // 等待图片等资源加载
      await new Promise<void>((resolve) => {
        if (iframe.contentDocument?.readyState === 'complete') {
          resolve();
        } else {
          iframe.addEventListener('load', () => resolve(), { once: true });
          setTimeout(resolve, 3000); // 最多再等 3s
        }
      });
      isReady = true;
    } catch (e) {
      console.warn('waitForReady warning:', e);
      // 即使超时也标记为 ready，尝试强行渲染，避免死锁
      isReady = true;
    }
  }

  /**
   * 获取 html2canvas 基础选项
   */
  function getHtml2CanvasOptions(): Html2CanvasOptions {
    return {
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
    };
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

      const progress = Math.min(1, Math.max(0, t / duration));

      // 关键：保持确定性
      // - deterministic: 同步 --t
      // - realtime: 同样同步 CSS Animation 到绝对时间点，避免"导出太快导致动画不走/全透明"
      preview.setProgress(progress);

      if (mode === 'deterministic') {
        await new Promise((resolve) => requestAnimationFrame(resolve));
      }

      const contentWindow = preview.getContentWindow();
      if (!contentWindow?.document?.documentElement) {
        throw new Error('iframe 内容未加载');
      }

      const capturedCanvas = await withTimeout(
      captureFrame(
        contentWindow.document,
        width,
        height,
        captureEngine,
        getHtml2CanvasOptions(),
        previewScale,
        disableFontEmbed
      ),
        DEFAULT_RENDER_FRAME_TIMEOUT_MS,
        'HTML 截图超时'
      );

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(capturedCanvas, 0, 0);
    },

    dispose(): void {
      preview.destroy();
    },
  };
}
