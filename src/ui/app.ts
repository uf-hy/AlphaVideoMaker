/**
 * 主应用模块
 * 管理整个导出流程的 UI 和状态
 */

import type {
  CanvasRenderer,
  ExportConfig,
  ExportProgress,
  ExportResult,
  CodecType,
  FpsOption,
} from '@/core/types';
import {
  DEFAULT_EXPORT_CONFIG,
  RESOLUTION_PRESETS,
  INITIAL_PROGRESS,
} from '@/core/types';
import { createExportController, ExportController } from '@/core/export-controller';
import { detectEnvironment, checkMemoryRisk, downloadBlob, withTimeout } from '@/utils';
import { getCodecDisplayName } from '@/encoder';
import { DEMO_ANIMATIONS } from '@/demo';
import {
  createHtmlEditor,
  createIframePreview,
  createHtmlExportRenderer,
  createFrameCache,
  type FrameCache,
  DEFAULT_HTML_TEMPLATE,
  REALTIME_HTML_TEMPLATE,
  GLASS_CARD_STATS_TEMPLATE,
  type HtmlEditor,
  type IframePreview,
  type RecordMode,
  type CaptureEngine,
  injectTransparentBackground,
  type TransparentMode,
} from '@/editor';

/**
 * 应用状态
 */
interface AppState {
  config: ExportConfig;
  progress: ExportProgress;
  isExporting: boolean;
  result: ExportResult | null;
  warnings: string[];
  riskWarning: string;
  contentScale: number; // 动画内容缩放比例
  playbackRate: number; // 播放速度（影响导出）
  loopPreview: boolean; // 预览是否循环
  previewFps: 10 | 15 | 30;
  previewScale: 0.5 | 0.75 | 1;
  currentDemoId: string;
}

/**
 * 创建应用 UI
 */
export function createApp(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  renderer: CanvasRenderer,
  ctx: CanvasRenderingContext2D
): {
  destroy: () => void;
  setRenderer: (r: CanvasRenderer) => void;
} {
  // 状态
  const state: AppState = {
    config: { ...DEFAULT_EXPORT_CONFIG },
    progress: { ...INITIAL_PROGRESS },
    isExporting: false,
    result: null,
    warnings: [],
    riskWarning: '',
    contentScale: 1, // 默认 1x
    playbackRate: 1, // 默认 1x
    loopPreview: true,
    previewFps: 15,
    previewScale: 0.5,
    currentDemoId: DEMO_ANIMATIONS[0]?.id ?? '',
  };

  let animationStartTime = 0;
  let animationPausedTime = 0; // 用于非循环动画的暂停时间点

  let currentRenderer = renderer;
  let exportController: ExportController | null = null;

  // 自定义 HTML 动画状态（解耦“编辑/应用/配置变更”）
  let customHtmlState:
    | {
        html: string;
        recordMode: RecordMode;
        transparentMode: TransparentMode;
        captureEngine: CaptureEngine;
      }
    | null = null;
  let customHtmlRenderer: CanvasRenderer | null = null;
  let customHtmlHiddenContainer: HTMLElement | null = null;

  function getOrCreateCustomHtmlHiddenContainer(): HTMLElement {
    if (customHtmlHiddenContainer) return customHtmlHiddenContainer;

    let hiddenContainer = document.querySelector('#hidden-render-container') as HTMLElement;
    if (!hiddenContainer) {
      hiddenContainer = document.createElement('div');
      hiddenContainer.id = 'hidden-render-container';
      // 使用 opacity: 0 而不是移出屏幕，防止浏览器对不可见 iframe 进行资源加载节流
      // 注意：不能用 position: fixed/absolute 脱离文档流太远，否则 SnapDOM 计算坐标可能出错
      hiddenContainer.style.cssText = 'position: absolute; left: 0; top: 0; width: 100px; height: 100px; z-index: -9999; pointer-events: none; overflow: hidden; opacity: 0.01;';
      document.body.appendChild(hiddenContainer);
    }

    customHtmlHiddenContainer = hiddenContainer;
    return hiddenContainer;
  }

  function rebuildCustomHtmlRenderer(): void {
    if (!customHtmlState) return;

    customHtmlRenderer?.dispose?.();

    canvas.width = state.config.width;
    canvas.height = state.config.height;

    const exportHtml = injectTransparentBackground(customHtmlState.html, {
      mode: customHtmlState.transparentMode,
    });

    customHtmlRenderer = createHtmlExportRenderer({
      html: exportHtml,
      width: state.config.width,
      height: state.config.height,
      duration: state.config.duration,
      mode: customHtmlState.recordMode,
      captureEngine: customHtmlState.captureEngine,
      hiddenContainer: getOrCreateCustomHtmlHiddenContainer(),
      canvas,
      ctx,
    });

    currentRenderer = customHtmlRenderer;
    state.currentDemoId = 'custom-html';
  }

  function rebuildCustomHtmlPreviewRenderer(): void {
    if (!customHtmlState || !previewRenderCtx) return;

    customHtmlPreviewRenderer?.dispose?.();

    const exportHtml = injectTransparentBackground(customHtmlState.html, {
      mode: customHtmlState.transparentMode,
    });

    customHtmlPreviewRenderer = createHtmlExportRenderer({
      html: exportHtml,
      width: state.config.width,
      height: state.config.height,
      duration: state.config.duration,
      mode: customHtmlState.recordMode,
      captureEngine: customHtmlState.captureEngine,
      previewScale: state.previewScale,
      disableFontEmbed: true, // 预览时禁用字体嵌入，防止卡死并提升速度
      hiddenContainer: getOrCreateCustomHtmlHiddenContainer(),
      canvas: previewRenderCanvas,
      ctx: previewRenderCtx,
    });
  }

  // 检测环境
  const env = detectEnvironment();
  state.warnings = env.warnings;

  // 创建 DOM
  container.innerHTML = createAppHTML(state, env.canUseMultiThread);

  // 创建预览 Canvas（用于所见即所得预览）
  const previewCanvas = document.createElement('canvas');
  const previewCtx = previewCanvas.getContext('2d');
  const previewRenderCanvas = document.createElement('canvas');
  const previewRenderCtx = previewRenderCanvas.getContext('2d');
  let previewFrameCache: FrameCache | null = null;
  let customHtmlPreviewRenderer: CanvasRenderer | null = null;

  // 获取 DOM 元素
  const elements = {
    warningBanner: container.querySelector('.warning-banner'),
    demoSelect: container.querySelector('#demo-select') as HTMLSelectElement,
    codecSelect: container.querySelector('#codec-select') as HTMLSelectElement,
    resolutionSelect: container.querySelector('#resolution-select') as HTMLSelectElement,
    toggleResolution: container.querySelector('#toggle-resolution') as HTMLButtonElement,
    toggleRatio: container.querySelector('#toggle-ratio') as HTMLButtonElement,
    toggleOrientation: container.querySelector('#toggle-orientation') as HTMLButtonElement,
    contentScaleInput: container.querySelector('#content-scale-input') as HTMLInputElement,
    contentScaleValue: container.querySelector('#content-scale-value') as HTMLSpanElement,
    animationSpeedInput: container.querySelector('#animation-speed-input') as HTMLInputElement,
    animationSpeedValue: container.querySelector('#animation-speed-value') as HTMLSpanElement,
    loopPreviewBtn: container.querySelector('#toggle-loop-preview') as HTMLButtonElement,
    resetPreviewBtn: container.querySelector('#reset-preview-btn') as HTMLButtonElement,
    fpsSelect: container.querySelector('#fps-select') as HTMLSelectElement,
    previewFpsSelect: container.querySelector('#preview-fps-select') as HTMLSelectElement,
    previewScaleSelect: container.querySelector('#preview-scale-select') as HTMLSelectElement,
    durationSelect: container.querySelector('#duration-select') as HTMLSelectElement,
    riskWarning: container.querySelector('.risk-warning'),
    progressSection: container.querySelector('.progress-section'),
    progressBar: container.querySelector('.progress-bar') as HTMLElement,
    progressPercent: container.querySelector('.progress-percent'),
    progressInfo: container.querySelector('.progress-frame-info'),
    progressTime: container.querySelector('.progress-time'),
    startBtn: container.querySelector('#start-btn') as HTMLButtonElement,
    cancelBtn: container.querySelector('#cancel-btn') as HTMLButtonElement,
    downloadBtn: container.querySelector('#download-btn') as HTMLButtonElement,
    overlay: container.querySelector('.export-overlay'),
    canvasWrapper: container.querySelector('.preview-canvas-wrapper') as HTMLElement,
    previewInfo: container.querySelector('.preview-resolution-info'),
    outputFrame: container.querySelector('.output-frame') as HTMLElement,
  };

  // 将预览 Canvas 添加到预览区
  previewCanvas.classList.add('preview-canvas');
  elements.canvasWrapper?.appendChild(previewCanvas);

  // 更新输出边框位置（跟随 canvas 实际显示区域）
  function updateOutputFrame(): void {
    if (!elements.outputFrame || !elements.canvasWrapper) return;

    const wrapper = elements.canvasWrapper;

    // 使用 wrapper 的内容区域计算“contain”后的可见矩形
    // 这样不依赖 canvas/iframe 的 DOM 布局，避免在 display:none / iframe 缩放下框线失效
    const wrapperWidth = wrapper.clientWidth;
    const wrapperHeight = wrapper.clientHeight;

    if (wrapperWidth <= 0 || wrapperHeight <= 0) return;

    const aspect = state.config.width / state.config.height;
    const wrapperAspect = wrapperWidth / wrapperHeight;

    let rectWidth: number;
    let rectHeight: number;

    if (wrapperAspect > aspect) {
      // 以高度为基准
      rectHeight = wrapperHeight;
      rectWidth = rectHeight * aspect;
    } else {
      // 以宽度为基准
      rectWidth = wrapperWidth;
      rectHeight = rectWidth / aspect;
    }

    const offsetLeft = (wrapperWidth - rectWidth) / 2;
    const offsetTop = (wrapperHeight - rectHeight) / 2;

    elements.outputFrame.style.left = `${offsetLeft}px`;
    elements.outputFrame.style.top = `${offsetTop}px`;
    elements.outputFrame.style.width = `${rectWidth}px`;
    elements.outputFrame.style.height = `${rectHeight}px`;
  }

  // 更新预览（所见即所得）
  function updatePreview(): void {
    const { width, height } = state.config;

    // 设置预览 Canvas 尺寸为输出尺寸
    previewCanvas.width = width;
    previewCanvas.height = height;

    // 更新预览区域的宽高比
    if (elements.canvasWrapper) {
      elements.canvasWrapper.style.setProperty('--preview-aspect-ratio', `${width}/${height}`);
    }

    // 更新预览信息
    if (elements.previewInfo) {
      elements.previewInfo.textContent = `输出: ${width}×${height} | 内容缩放: ${state.contentScale.toFixed(1)}x`;
    }

    // 更新缩放显示
    if (elements.contentScaleValue) {
      elements.contentScaleValue.textContent = `${state.contentScale.toFixed(1)}x`;
    }

    // 延迟更新边框位置，等待 DOM 重新布局
    requestAnimationFrame(() => {
      updateOutputFrame();
    });
  }

  // 更新风险警告
  function updateRiskWarning(): void {
    const risk = checkMemoryRisk(
      state.config.width,
      state.config.height,
      state.config.fps,
      state.config.duration,
      state.config.chunkFrames
    );

    state.riskWarning = risk.message;

    if (elements.riskWarning) {
      if (risk.isRisky) {
        elements.riskWarning.innerHTML = `<span>⚠️</span><span>${risk.message}</span>`;
        (elements.riskWarning as HTMLElement).style.display = 'flex';
      } else {
        (elements.riskWarning as HTMLElement).style.display = 'none';
      }
    }
  }

  function updatePreviewControls(): void {
    if (elements.loopPreviewBtn) {
      elements.loopPreviewBtn.textContent = state.loopPreview ? '循环: 开' : '循环: 关';
    }
  }

  // 预览渲染状态（用于避免“卡死后永远不再渲染”以及避免旧帧覆盖新状态）
  const PREVIEW_RENDER_TIMEOUT_MS = 60000; // 增加到 60秒
  let previewRenderInFlight:
    | {
        id: number;
        startedAt: number;
        renderer: CanvasRenderer;
        generation: number;
      }
    | null = null;
  let previewRenderSeq = 0;
  let previewGeneration = 0;
  let lastPreviewRenderTs = 0;

  function invalidatePreview(): void {
    previewGeneration++;
    previewRenderInFlight = null;
    lastPreviewRenderTs = 0;

    // 视觉立即反馈：先清空当前预览帧，避免用户误以为按钮没生效
    try {
      previewCtx?.clearRect(0, 0, previewCanvas.width, previewCanvas.height);
    } catch {
      // ignore
    }
  }

  function resetPreviewCache(): void {
    previewFrameCache?.dispose();
    previewFrameCache = null;
    customHtmlPreviewRenderer?.dispose?.();
    customHtmlPreviewRenderer = null;
  }

  function ensureCustomHtmlPreviewRenderer(): CanvasRenderer | null {
    if (!customHtmlState) return null;
    if (!customHtmlPreviewRenderer) {
      rebuildCustomHtmlPreviewRenderer();
    }
    return customHtmlPreviewRenderer;
  }

  function ensurePreviewFrameCache(): FrameCache | null {
    if (state.currentDemoId !== 'custom-html' || !customHtmlState) return null;

    const previewRenderer = ensureCustomHtmlPreviewRenderer();
    if (!previewRenderer) return null;

    if (!previewFrameCache) {
      const maxFrames = Math.max(30, state.previewFps * 4);
      previewFrameCache = createFrameCache({
        maxFrames,
        previewFps: state.previewFps,
        duration: state.config.duration,
        onRenderFrame: async (frameIndex) => {
          const t = Math.min(frameIndex / state.previewFps, previewRenderer.duration);
          try {
            await Promise.resolve(previewRenderer.renderAt(t));
          } catch (e) {
            console.warn(`帧渲染失败 [${frameIndex}]:`, e);
            throw e;
          }
          return createImageBitmap(previewRenderCanvas);
        },
      });
    }

    return previewFrameCache;
  }

  function resetPreview(): void {
    // 立即生效：防止上一帧异步 renderAt 完成后把旧画面覆盖回来
    invalidatePreview();

    animationStartTime = performance.now();
    animationPausedTime = 0;

    if (state.currentDemoId === 'custom-html' && customHtmlState?.recordMode === 'realtime') {
      // realtime 模式：通过重建隐藏 iframe 来重置
      rebuildCustomHtmlRenderer();
    }
  }

  // 切换 Demo 动画
  function switchDemo(demoId: string): void {
    invalidatePreview();
    if (demoId === 'custom-html') {
      if (customHtmlRenderer) {
        currentRenderer = customHtmlRenderer;
        state.currentDemoId = 'custom-html';
        canvas.width = currentRenderer.width;
        canvas.height = currentRenderer.height;
        updatePreview();
      }
      return;
    }

    resetPreviewCache();

    const demo = DEMO_ANIMATIONS.find(d => d.id === demoId);
    if (demo) {
      state.currentDemoId = demoId;
      currentRenderer = demo.factory(ctx);

      // 更新源 Canvas 尺寸为新动画的尺寸
      canvas.width = currentRenderer.width;
      canvas.height = currentRenderer.height;

      updatePreview();
    }
  }

  // 渲染预览帧（所见即所得）- 支持异步渲染器
  async function renderPreviewFrame(t: number): Promise<void> {
    if (!previewCtx) return;

    const rendererAtStart = currentRenderer;
    const generationAtStart = previewGeneration;

    const now = performance.now();
    if (previewRenderInFlight) {
      // 防止“永远 pending 导致全局预览卡死”
      if (now - previewRenderInFlight.startedAt < PREVIEW_RENDER_TIMEOUT_MS) return;

      console.warn('预览渲染超时，强制解锁并尝试恢复');
      previewRenderInFlight = null;
      previewGeneration++;

      // 自定义 HTML 最容易卡死：重建 iframe 尝试恢复
      if (state.currentDemoId === 'custom-html') {
        try {
          rebuildCustomHtmlRenderer();
        } catch (e) {
          console.error('重建自定义 HTML 渲染器失败:', e);
        }
      }
    }

    const jobId = ++previewRenderSeq;
    previewRenderInFlight = {
      id: jobId,
      startedAt: now,
      renderer: rendererAtStart,
      generation: generationAtStart,
    };

    try {
      const cache = ensurePreviewFrameCache();
      
      if (cache && state.currentDemoId === 'custom-html') {
        const frameIndex = Math.max(0, Math.floor(t * state.previewFps));
        const bitmap = await cache.getOrRender(frameIndex);

        if (
          previewGeneration !== generationAtStart ||
          currentRenderer !== rendererAtStart ||
          previewRenderInFlight?.id !== jobId ||
          !bitmap
        ) {
          return;
        }

        previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

        const scaledWidth = currentRenderer.width * state.contentScale;
        const scaledHeight = currentRenderer.height * state.contentScale;
        const offsetX = Math.round((previewCanvas.width - scaledWidth) / 2);
        const offsetY = Math.round((previewCanvas.height - scaledHeight) / 2);

        previewCtx.drawImage(
          bitmap,
          0, 0, bitmap.width, bitmap.height,
          offsetX, offsetY, scaledWidth, scaledHeight
        );

        const prefetchAhead = Math.min(30, state.previewFps);
        cache.prefetch(frameIndex, prefetchAhead);
        return;
      }

      await withTimeout(
        Promise.resolve(rendererAtStart.renderAt(t)),
        PREVIEW_RENDER_TIMEOUT_MS,
        '预览 renderAt 超时'
      );

      if (
        previewGeneration !== generationAtStart ||
        currentRenderer !== rendererAtStart ||
        previewRenderInFlight?.id !== jobId
      ) {
        return;
      }

      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

      const scaledWidth = currentRenderer.width * state.contentScale;
      const scaledHeight = currentRenderer.height * state.contentScale;
      const offsetX = Math.round((previewCanvas.width - scaledWidth) / 2);
      const offsetY = Math.round((previewCanvas.height - scaledHeight) / 2);

      previewCtx.drawImage(
        canvas,
        0, 0, currentRenderer.width, currentRenderer.height,
        offsetX, offsetY, scaledWidth, scaledHeight
      );

    } catch (error) {
      console.error('预览渲染失败:', error);
    } finally {
      if (previewRenderInFlight?.id === jobId) {
        previewRenderInFlight = null;
      }
    }
  }

  // 更新进度显示
  function updateProgress(progress: ExportProgress): void {
    state.progress = progress;

    if (elements.progressBar) {
      elements.progressBar.style.width = `${progress.percent}%`;

      // 更新进度条颜色
      elements.progressBar.classList.remove('success', 'error');
      if (progress.phase === 'done') {
        elements.progressBar.classList.add('success');
      } else if (progress.phase === 'error') {
        elements.progressBar.classList.add('error');
      }
    }

    if (elements.progressPercent) {
      elements.progressPercent.textContent = `${progress.percent}%`;
    }

    if (elements.progressInfo) {
      if (progress.totalFrames > 0) {
        elements.progressInfo.textContent = `帧: ${progress.currentFrame}/${progress.totalFrames}`;
      } else {
        elements.progressInfo.textContent = '';
      }
    }

    if (elements.progressTime) {
      if (progress.estimatedTimeRemaining !== undefined) {
        const seconds = Math.ceil(progress.estimatedTimeRemaining / 1000);
        elements.progressTime.textContent = `剩余: ~${seconds}s`;
      } else {
        elements.progressTime.textContent = '';
      }
    }

    // 更新遮罩
    if (elements.overlay) {
      const overlay = elements.overlay as HTMLElement;
      if (state.isExporting && progress.phase !== 'done' && progress.phase !== 'error') {
        overlay.style.display = 'flex';
        const message = overlay.querySelector('.export-overlay__message');
        if (message) {
          const phaseText: Record<string, string> = {
            initializing: '正在初始化...',
            rendering: `正在渲染帧 (${progress.percent}%)`,
            encoding: `正在编码视频 (${progress.percent}%)`,
            merging: '正在合并视频...',
          };
          message.textContent = phaseText[progress.phase] ?? '处理中...';
        }
      } else {
        overlay.style.display = 'none';
      }
    }
  }

  // 更新按钮状态
  function updateButtons(): void {
    if (elements.startBtn) {
      elements.startBtn.disabled = state.isExporting;
    }
    if (elements.cancelBtn) {
      elements.cancelBtn.disabled = !state.isExporting;
      (elements.cancelBtn as HTMLElement).style.display = state.isExporting ? 'inline-flex' : 'none';
    }
    if (elements.downloadBtn) {
      elements.downloadBtn.disabled = !state.result?.success;
      (elements.downloadBtn as HTMLElement).style.display = state.result?.success ? 'inline-flex' : 'none';
    }
  }

  // 开始导出
  async function startExport(): Promise<void> {
    if (state.isExporting) return;

    state.isExporting = true;
    state.result = null;
    updateButtons();
    updateProgress({ ...INITIAL_PROGRESS, phase: 'initializing' });

    // 导出配置（包含内容缩放）
    const exportConfig: ExportConfig = {
      ...state.config,
      contentScale: state.contentScale,
      playbackRate: state.playbackRate,
    };

    exportController = createExportController(
      canvas,
      currentRenderer,
      exportConfig,
      updateProgress
    );

    const result = await exportController.start();
    state.result = result;
    state.isExporting = false;

    updateButtons();

    if (!result.success) {
      console.error('导出失败:', result.error);
    }
  }

  // 取消导出
  function cancelExport(): void {
    exportController?.cancel();
  }

  // 下载文件
  function download(): void {
    if (state.result?.success && state.result.blob && state.result.filename) {
      downloadBlob(state.result.blob, state.result.filename);
    }
  }

  // 事件监听 - Demo 选择
  elements.demoSelect?.addEventListener('change', (e) => {
    switchDemo((e.target as HTMLSelectElement).value);
  });

  // 事件监听 - 编码格式
  elements.codecSelect?.addEventListener('change', (e) => {
    state.config.codec = (e.target as HTMLSelectElement).value as CodecType;
    updateRiskWarning();
  });

  // 事件监听 - 分辨率
  elements.resolutionSelect?.addEventListener('change', (e) => {
    const [width, height] = (e.target as HTMLSelectElement).value.split('x').map(Number);
    if (width && height) {
      state.config.width = width;
      state.config.height = height;
    }
    updatePreview();
    updateRiskWarning();
    updateToggleButtons();

    if (state.currentDemoId === 'custom-html') {
      resetPreviewCache();
      rebuildCustomHtmlRenderer();
    }
  });

  // 快捷按钮状态
  let currentResolution: '1080' | '720' = '1080';
  let currentRatio: 'square' | 'normal' = 'normal';
  let currentOrientation: 'portrait' | 'landscape' = 'portrait';

  // 根据快捷按钮状态计算分辨率
  function calculateResolution(): { width: number; height: number } {
    const base = currentResolution === '1080' ? 1080 : 720;

    if (currentRatio === 'square') {
      return { width: base, height: base };
    }

    // 正常比例 (9:16 或 16:9)
    const longSide = currentResolution === '1080' ? 1920 : 1280;
    const shortSide = base;

    if (currentOrientation === 'portrait') {
      return { width: shortSide, height: longSide };
    } else {
      return { width: longSide, height: shortSide };
    }
  }

  // 更新分辨率并同步 UI
  function applyResolutionFromShortcuts(): void {
    const { width, height } = calculateResolution();
    state.config.width = width;
    state.config.height = height;

    // 同步下拉框
    const newValue = `${width}x${height}`;
    const matchingOption = Array.from(elements.resolutionSelect?.options ?? [])
      .find(opt => opt.value === newValue);

    if (matchingOption) {
      elements.resolutionSelect!.value = newValue;
    }

    updatePreview();
    updateRiskWarning();

    if (state.currentDemoId === 'custom-html') {
      resetPreviewCache();
      rebuildCustomHtmlRenderer();
    }
  }

  // 更新切换按钮的显示文字和状态
  function updateToggleButtons(): void {
    // 根据当前分辨率反推状态
    const { width, height } = state.config;
    const isSquare = width === height;
    const isPortrait = height > width;

    // 判断清晰度（用短边判断）
    const minDim = Math.min(width, height);
    currentResolution = minDim >= 1080 ? '1080' : '720';
    currentRatio = isSquare ? 'square' : 'normal';
    currentOrientation = isPortrait ? 'portrait' : 'landscape';

    // 更新按钮文字
    if (elements.toggleResolution) {
      elements.toggleResolution.textContent = currentResolution === '1080' ? '1080p' : '720p';
    }
    if (elements.toggleRatio) {
      elements.toggleRatio.textContent = currentRatio === 'square' ? '方形' : '正常';
    }
    if (elements.toggleOrientation) {
      elements.toggleOrientation.textContent = currentOrientation === 'portrait' ? '竖屏' : '横屏';
      // 方形时禁用方向按钮
      elements.toggleOrientation.classList.toggle('disabled', currentRatio === 'square');
    }
  }

  // 事件监听 - 清晰度切换
  elements.toggleResolution?.addEventListener('click', () => {
    currentResolution = currentResolution === '1080' ? '720' : '1080';
    applyResolutionFromShortcuts();
    updateToggleButtons();
  });

  // 事件监听 - 比例切换
  elements.toggleRatio?.addEventListener('click', () => {
    currentRatio = currentRatio === 'normal' ? 'square' : 'normal';
    applyResolutionFromShortcuts();
    updateToggleButtons();
  });

  // 事件监听 - 方向切换
  elements.toggleOrientation?.addEventListener('click', () => {
    if (currentRatio === 'square') return; // 方形时不切换
    currentOrientation = currentOrientation === 'portrait' ? 'landscape' : 'portrait';
    applyResolutionFromShortcuts();
    updateToggleButtons();
  });

  // 事件监听 - 内容缩放滑块
  elements.contentScaleInput?.addEventListener('input', (e) => {
    state.contentScale = Number((e.target as HTMLInputElement).value);
    updatePreview();
  });

  // 事件监听 - 动画速度滑块
  elements.animationSpeedInput?.addEventListener('input', (e) => {
    state.playbackRate = Number((e.target as HTMLInputElement).value);
    if (elements.animationSpeedValue) {
      elements.animationSpeedValue.textContent = `${state.playbackRate.toFixed(1)}x`;
    }
    // 重置动画起始时间，避免跳帧
    resetPreview();
  });

  // 事件监听 - 循环开关
  elements.loopPreviewBtn?.addEventListener('click', () => {
    // 保持时间线连续：从“当前画面”继续（而不是因为 elapsed 已超过 duration 直接跳到末尾）
    const now = performance.now();
    const duration = currentRenderer.duration;
    if (duration > 0) {
      const elapsed =
        ((now - animationStartTime) / 1000) * state.playbackRate + animationPausedTime;
      const currentT = state.loopPreview ? (elapsed % duration) : Math.min(elapsed, duration);
      animationStartTime = now;
      animationPausedTime = currentT;
    } else {
      animationStartTime = now;
      animationPausedTime = 0;
    }

    state.loopPreview = !state.loopPreview;
    updatePreviewControls();
    invalidatePreview();
  });

  // 事件监听 - 重置预览
  elements.resetPreviewBtn?.addEventListener('click', () => {
    resetPreview();
  });

  elements.previewFpsSelect?.addEventListener('change', (e) => {
    state.previewFps = Number((e.target as HTMLSelectElement).value) as 10 | 15 | 30;
    resetPreviewCache();
    invalidatePreview();
  });

  elements.previewScaleSelect?.addEventListener('change', (e) => {
    state.previewScale = Number((e.target as HTMLSelectElement).value) as 0.5 | 0.75 | 1;
    resetPreviewCache();
    updatePreview();
    invalidatePreview();
  });

  elements.fpsSelect?.addEventListener('change', (e) => {
    state.config.fps = Number((e.target as HTMLSelectElement).value) as FpsOption;
    updateRiskWarning();
  });

  // 事件监听 - 时长
  elements.durationSelect?.addEventListener('change', (e) => {
    state.config.duration = Number((e.target as HTMLSelectElement).value);
    updateRiskWarning();

    modalPreview?.setDurationSeconds(state.config.duration);

    if (state.currentDemoId === 'custom-html') {
      resetPreviewCache();
      rebuildCustomHtmlRenderer();
    }
  });

  elements.startBtn?.addEventListener('click', startExport);
  elements.cancelBtn?.addEventListener('click', cancelExport);
  elements.downloadBtn?.addEventListener('click', download);

  // ========== HTML 编辑器模态弹窗 ==========
  let modalEditor: HtmlEditor | null = null;
  let modalPreview: IframePreview | null = null;
  let modalRecordMode: RecordMode = 'deterministic';
  let modalTransparentMode: TransparentMode = 'auto';
  // 默认使用 html2canvas 预览，兼容性更好；SnapDOM 虽然快但容易在隐藏 iframe 中失效
  let modalCaptureEngine: CaptureEngine = 'html2canvas';
  let modalHtmlCode = DEFAULT_HTML_TEMPLATE;

  const modalElements = {
    modal: container.querySelector('#html-editor-modal') as HTMLElement,
    editorContainer: container.querySelector('#modal-editor-container') as HTMLElement,
    previewContainer: container.querySelector('#modal-preview-container') as HTMLElement,
    recordModeSelect: container.querySelector('#modal-record-mode') as HTMLSelectElement,
    transparentModeSelect: container.querySelector('#modal-transparent-mode') as HTMLSelectElement,
    captureEngineSelect: container.querySelector('#modal-capture-engine') as HTMLSelectElement,
    openBtn: container.querySelector('#open-html-editor-btn') as HTMLButtonElement,
    closeBtn: container.querySelector('#close-html-editor-btn') as HTMLButtonElement,
    applyBtn: container.querySelector('#apply-html-btn') as HTMLButtonElement,
    cancelBtn: container.querySelector('#cancel-html-btn') as HTMLButtonElement,
    templateBtns: container.querySelectorAll('.modal-body .template-btn') as NodeListOf<HTMLButtonElement>,
  };

  function processModalHtml(html: string): string {
    return injectTransparentBackground(html, { mode: modalTransparentMode });
  }

  function openHtmlEditorModal(): void {
    modalElements.modal.style.display = 'flex';

    // 初始化编辑器（如果还没有）
    if (!modalEditor && modalElements.editorContainer) {
      modalEditor = createHtmlEditor({
        container: modalElements.editorContainer,
        initialCode: modalHtmlCode,
        onChange: (code) => {
          modalHtmlCode = code;
          modalPreview?.updateContent(processModalHtml(code));
        },
        debounceDelay: 300,
      });
    }

    // 初始化预览
    if (modalElements.previewContainer) {
      if (!modalPreview) {
        modalPreview = createIframePreview({
          container: modalElements.previewContainer,
          width: state.config.width,
          height: state.config.height,
          durationSeconds: state.config.duration,
        });
      } else {
        modalPreview.resize(state.config.width, state.config.height);
        modalPreview.setDurationSeconds(state.config.duration);
      }
      modalPreview.updateContent(processModalHtml(modalHtmlCode));
    }

    // 启动预览动画
    startModalPreviewLoop();
  }

  function closeHtmlEditorModal(): void {
    modalElements.modal.style.display = 'none';
    stopModalPreviewLoop();
  }

  let modalPreviewAnimationId: number | null = null;

  function startModalPreviewLoop(): void {
    if (modalRecordMode !== 'deterministic') return;
    const startTime = performance.now();
    function loop(): void {
      const elapsed = (performance.now() - startTime) / 1000;
      const t = (elapsed % state.config.duration) / state.config.duration;
      modalPreview?.setProgress(t);
      modalPreviewAnimationId = requestAnimationFrame(loop);
    }
    modalPreviewAnimationId = requestAnimationFrame(loop);
  }

  function stopModalPreviewLoop(): void {
    if (modalPreviewAnimationId !== null) {
      cancelAnimationFrame(modalPreviewAnimationId);
      modalPreviewAnimationId = null;
    }
  }

  // 应用 HTML 动画
  function applyHtmlAnimation(): void {
    if (!modalEditor) return;

    customHtmlState = {
      html: modalHtmlCode,
      recordMode: modalRecordMode,
      transparentMode: modalTransparentMode,
      captureEngine: modalCaptureEngine,
    };

    resetPreviewCache();
    rebuildCustomHtmlRenderer();

    // 更新 demo 选择框显示
    if (elements.demoSelect) {
      // 添加自定义选项（如果不存在）
      let customOption = elements.demoSelect.querySelector('option[value="custom-html"]') as HTMLOptionElement;
      if (!customOption) {
        customOption = document.createElement('option');
        customOption.value = 'custom-html';
        customOption.textContent = '🎨 自定义 HTML';
        elements.demoSelect.appendChild(customOption);
      }
      elements.demoSelect.value = 'custom-html';
    }

    closeHtmlEditorModal();
    updatePreview();
  }

  // 事件监听
  modalElements.openBtn?.addEventListener('click', openHtmlEditorModal);
  modalElements.closeBtn?.addEventListener('click', closeHtmlEditorModal);
  modalElements.cancelBtn?.addEventListener('click', closeHtmlEditorModal);
  modalElements.applyBtn?.addEventListener('click', applyHtmlAnimation);

  modalElements.recordModeSelect?.addEventListener('change', (e) => {
    modalRecordMode = (e.target as HTMLSelectElement).value as RecordMode;
    stopModalPreviewLoop();
    if (modalRecordMode === 'deterministic') {
      startModalPreviewLoop();
    } else {
      modalPreview?.reset();
    }
  });

  modalElements.transparentModeSelect?.addEventListener('change', (e) => {
    modalTransparentMode = (e.target as HTMLSelectElement).value as TransparentMode;
    if (modalEditor) {
      modalPreview?.updateContent(processModalHtml(modalHtmlCode));
    }
  });

  modalElements.captureEngineSelect?.addEventListener('change', (e) => {
    modalCaptureEngine = (e.target as HTMLSelectElement).value as CaptureEngine;
  });

  modalElements.templateBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const templateType = btn.dataset.template;
      if (templateType === 'deterministic' && modalEditor) {
        modalHtmlCode = DEFAULT_HTML_TEMPLATE;
        modalEditor.setCode(modalHtmlCode);
        modalPreview?.updateContent(processModalHtml(modalHtmlCode));
      } else if (templateType === 'realtime' && modalEditor) {
        modalHtmlCode = REALTIME_HTML_TEMPLATE;
        modalEditor.setCode(modalHtmlCode);
        modalPreview?.updateContent(processModalHtml(modalHtmlCode));
      } else if (templateType === 'glass-card' && modalEditor) {
        modalHtmlCode = GLASS_CARD_STATS_TEMPLATE;
        modalEditor.setCode(modalHtmlCode);
        modalPreview?.updateContent(processModalHtml(modalHtmlCode));
      }
    });
  });

  // 点击遮罩关闭
  modalElements.modal?.addEventListener('click', (e) => {
    if (e.target === modalElements.modal) {
      closeHtmlEditorModal();
    }
  });

  // 初始化
  updatePreview();
  updateRiskWarning();
  updateButtons();
  updateToggleButtons();
  updatePreviewControls();

  // 启动预览动画循环
  let animationId: number | null = null;
  animationStartTime = performance.now();

  function previewLoop(timestamp: number): void {
    if (!state.isExporting) {
      // 计算经过的时间（考虑速度）
      const elapsed = ((timestamp - animationStartTime) / 1000) * state.playbackRate + animationPausedTime;
      const duration = currentRenderer.duration;
      const t = state.loopPreview ? (elapsed % duration) : Math.min(elapsed, duration);

      // 自定义 HTML 预览：html2canvas 极重，降低渲染频率避免 UI 卡死
      const targetFps = state.currentDemoId === 'custom-html' ? state.previewFps : 60;
      const minInterval = 1000 / targetFps;
      if (timestamp - lastPreviewRenderTs >= minInterval) {
        lastPreviewRenderTs = timestamp;
        renderPreviewFrame(t);
      }
    }
    animationId = requestAnimationFrame(previewLoop);
  }

  // 监听窗口 resize 事件，更新边框位置
  const handleResize = (): void => {
    updateOutputFrame();
  };
  window.addEventListener('resize', handleResize);

  animationId = requestAnimationFrame(previewLoop);

  return {
    destroy: () => {
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
      stopModalPreviewLoop();
      modalEditor?.destroy();
      modalPreview?.destroy();
      window.removeEventListener('resize', handleResize);
      exportController?.cancel();
      container.innerHTML = '';
    },
    setRenderer: (r: CanvasRenderer) => {
      currentRenderer = r;
    },
  };
}

/**
 * 创建应用 HTML
 */
function createAppHTML(state: AppState, canUseMultiThread: boolean): string {
  const warningHTML = state.warnings.length > 0
    ? `<div class="warning-banner">
        <span class="warning-banner__icon">⚠️</span>
        <span class="warning-banner__text">${state.warnings[0]}</span>
      </div>`
    : '';

  // Demo 动画选项
  const demoOptions = DEMO_ANIMATIONS.map((d, i) =>
    `<option value="${d.id}" ${i === 0 ? 'selected' : ''}>${d.name}</option>`
  ).join('');

  const resolutionOptions = RESOLUTION_PRESETS.map((r) =>
    `<option value="${r.width}x${r.height}" ${r.width === state.config.width && r.height === state.config.height ? 'selected' : ''}>${r.label}</option>`
  ).join('');

  const durationOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((d) => `<option value="${d}" ${d === state.config.duration ? 'selected' : ''}>${d} 秒</option>`)
    .join('');

  return `
    ${warningHTML}

    <div class="main-layout">
      <div class="preview-section">
        <div class="preview-header">
          <h2 class="preview-title">预览 (所见即所得)</h2>
        </div>
        <div class="preview-canvas-wrapper">
          <div class="output-frame"></div>
        </div>
        <div class="preview-footer">
          <span class="preview-resolution-info">输出: 1920×1080 | 内容缩放: 1.0x</span>
        </div>
      </div>

      <div class="control-panel">
        <div class="panel-card">
          <h3 class="panel-title">🎬 动画选择</h3>

          <div class="form-group">
            <label class="form-label">示例动画</label>
            <select id="demo-select" class="form-select">
              ${demoOptions}
            </select>
          </div>

          <div class="form-group">
            <button id="open-html-editor-btn" class="btn btn-secondary btn-full">
              ✏️ 自定义 HTML 动画
            </button>
          </div>
        </div>

        <div class="panel-card">
          <h3 class="panel-title">📹 导出设置</h3>

          <div class="form-group">
            <label class="form-label">编码格式</label>
            <select id="codec-select" class="form-select">
              <option value="qtrle" selected>${getCodecDisplayName('qtrle')}</option>
              <option value="prores_4444">${getCodecDisplayName('prores_4444')}</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">输出分辨率</label>
            <div class="resolution-row">
              <select id="resolution-select" class="form-select">
                ${resolutionOptions}
              </select>
            </div>
            <div class="resolution-shortcuts">
              <button type="button" class="btn-toggle" id="toggle-resolution">1080p</button>
              <button type="button" class="btn-toggle" id="toggle-ratio">正常</button>
              <button type="button" class="btn-toggle" id="toggle-orientation">竖屏</button>
            </div>
          </div>

          <div class="form-group">
            <label class="form-label">
              动画内容缩放 <span id="content-scale-value" class="scale-value">1.0x</span>
            </label>
            <input
              type="range"
              id="content-scale-input"
              class="form-range"
              min="0.5"
              max="3"
              step="0.1"
              value="1"
            />
            <div class="range-labels">
              <span>0.5x</span>
              <span>1x</span>
              <span>2x</span>
              <span>3x</span>
            </div>
            <small class="form-hint">调整动画在画面中的大小，预览即为最终效果</small>
          </div>

          <div class="form-group">
            <label class="form-label">
              播放速度 <span id="animation-speed-value" class="scale-value">1.0x</span>
            </label>
            <input
              type="range"
              id="animation-speed-input"
              class="form-range"
              min="0.1"
              max="5"
              step="0.1"
              value="1"
            />
            <div class="range-labels">
              <span>0.1x</span>
              <span>1x</span>
              <span>2x</span>
              <span>5x</span>
            </div>
            <small class="form-hint">影响预览与导出（更慢或更快）</small>
          </div>

          <div class="form-group">
            <label class="form-label">预览控制</label>
            <div class="btn-group">
              <button type="button" class="btn-toggle" id="toggle-loop-preview">循环: 开</button>
              <button type="button" class="btn btn-secondary" id="reset-preview-btn">重置</button>
            </div>
            <small class="form-hint">一次性动画可关闭循环，播放到末尾会停住</small>
          </div>

          <div class="form-group">
            <label class="form-label">预览帧率</label>
            <select id="preview-fps-select" class="form-select">
              <option value="10" ${state.previewFps === 10 ? 'selected' : ''}>10 fps</option>
              <option value="15" ${state.previewFps === 15 ? 'selected' : ''}>15 fps</option>
              <option value="30" ${state.previewFps === 30 ? 'selected' : ''}>30 fps</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">预览分辨率</label>
            <select id="preview-scale-select" class="form-select">
              <option value="0.5" ${state.previewScale === 0.5 ? 'selected' : ''}>0.5x</option>
              <option value="0.75" ${state.previewScale === 0.75 ? 'selected' : ''}>0.75x</option>
              <option value="1" ${state.previewScale === 1 ? 'selected' : ''}>1x</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">帧率</label>
            <select id="fps-select" class="form-select">
              <option value="30" selected>30 fps</option>
              <option value="60">60 fps</option>
            </select>
          </div>

          <div class="form-group">
            <label class="form-label">时长</label>
            <select id="duration-select" class="form-select">
              ${durationOptions}
            </select>
          </div>

          <div class="risk-warning" style="display: none;"></div>
        </div>

        <div class="panel-card progress-section">
          <h3 class="panel-title">📊 进度</h3>

          <div class="progress-bar-wrapper">
            <div class="progress-bar" style="width: 0%"></div>
          </div>

          <div class="progress-info">
            <span class="progress-percent">0%</span>
            <span class="progress-frame-info"></span>
            <span class="progress-time"></span>
          </div>
        </div>

        <div class="panel-card">
          <div class="btn-group">
            <button id="start-btn" class="btn btn-primary btn-full">
              🚀 开始导出
            </button>
            <button id="cancel-btn" class="btn btn-danger" style="display: none;">
              取消
            </button>
            <button id="download-btn" class="btn btn-success" style="display: none;">
              📥 下载
            </button>
          </div>
        </div>
      </div>
    </div>

    <div class="export-overlay" style="display: none;">
      <div class="spinner"></div>
      <div class="export-overlay__message">正在处理...</div>
      <div class="export-overlay__warning">⚠️ 请勿关闭页面</div>
      <button id="overlay-cancel-btn" class="btn btn-danger">取消导出</button>
    </div>

    <!-- HTML 编辑器模态弹窗 -->
    <div id="html-editor-modal" class="modal-overlay" style="display: none;">
      <div class="modal-container html-editor-modal">
        <div class="modal-header">
          <h2>✏️ 自定义 HTML 动画</h2>
          <button id="close-html-editor-btn" class="modal-close-btn">✕</button>
        </div>
        <div class="modal-body">
          <div class="html-editor-layout">
            <div class="html-editor-left">
              <div class="editor-toolbar">
                <button class="template-btn" data-template="deterministic">确定性模板</button>
                <button class="template-btn" data-template="realtime">实时模板</button>
                <button class="template-btn" data-template="glass-card">卡片示例</button>
                <select id="modal-record-mode" class="form-select" style="width: auto;">
                  <option value="deterministic">确定性模式</option>
                  <option value="realtime">实时模式</option>
                </select>
              </div>
              <div id="modal-editor-container" class="modal-editor-container"></div>
            </div>
            <div class="html-editor-right">
              <div class="modal-preview-header">
                <span>预览</span>
                <select id="modal-capture-engine" class="form-select" style="width: auto;">
                  <option value="snapdom" selected>SnapDOM (推荐)</option>
                  <option value="html2canvas">html2canvas</option>
                </select>
                <select id="modal-transparent-mode" class="form-select" style="width: auto;">
                  <option value="auto">自动透明</option>
                  <option value="none">不处理</option>
                  <option value="custom">指定颜色</option>
                </select>
              </div>
              <div id="modal-preview-container" class="modal-preview-container"></div>
            </div>
          </div>
        </div>
        <div class="modal-footer">
          <button id="apply-html-btn" class="btn btn-primary">✓ 应用此动画</button>
          <button id="cancel-html-btn" class="btn btn-secondary">取消</button>
        </div>
      </div>
    </div>
  `;
}
