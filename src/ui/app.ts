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
import { detectEnvironment, checkMemoryRisk, downloadBlob } from '@/utils';
import { getCodecDisplayName } from '@/encoder';
import { DEMO_ANIMATIONS } from '@/demo';
import {
  createHtmlEditor,
  createIframePreview,
  createHtmlExportRenderer,
  DEFAULT_HTML_TEMPLATE,
  REALTIME_HTML_TEMPLATE,
  type HtmlEditor,
  type IframePreview,
  type RecordMode,
  injectTransparentBackground,
  injectContentScale,
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
      hiddenContainer.style.cssText = 'position: absolute; left: -9999px; top: -9999px;';
      document.body.appendChild(hiddenContainer);
    }

    customHtmlHiddenContainer = hiddenContainer;
    return hiddenContainer;
  }

  function rebuildCustomHtmlRenderer(): void {
    if (!customHtmlState) return;

    // 清理旧 renderer，避免 iframe 堆积
    customHtmlRenderer?.dispose?.();

    // HTML 渲染器的输出尺寸必须与 config 一致，否则会出现裁剪（文字“消失”）
    canvas.width = state.config.width;
    canvas.height = state.config.height;

    const exportHtml = injectTransparentBackground(customHtmlState.html, {
      mode: customHtmlState.transparentMode,
    });
    const previewHtml = injectContentScale(exportHtml, { contentScale: state.contentScale });

    customHtmlRenderer = createHtmlExportRenderer({
      html: exportHtml,
      width: state.config.width,
      height: state.config.height,
      duration: state.config.duration,
      mode: customHtmlState.recordMode,
      hiddenContainer: getOrCreateCustomHtmlHiddenContainer(),
      canvas,
      ctx,
    });

    currentRenderer = customHtmlRenderer;
    state.currentDemoId = 'custom-html';

    const vp = ensureVisibleHtmlPreview();
    vp.resize(state.config.width, state.config.height);
    vp.updateContent(previewHtml);

    updatePreviewModeVisibility();
  }

  // 检测环境
  const env = detectEnvironment();
  state.warnings = env.warnings;

  // 创建 DOM
  container.innerHTML = createAppHTML(state, env.canUseMultiThread);

  // 创建预览 Canvas（用于所见即所得预览）
  const previewCanvas = document.createElement('canvas');
  const previewCtx = previewCanvas.getContext('2d');

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
    fpsSelect: container.querySelector('#fps-select') as HTMLSelectElement,
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

  // 自定义 HTML：在预览区直接显示 iframe（更接近真实渲染，避免 html2canvas 实时截图卡顿）
  const htmlPreviewWrapper = document.createElement('div');
  htmlPreviewWrapper.className = 'preview-container';
  htmlPreviewWrapper.style.width = '100%';
  htmlPreviewWrapper.style.height = '100%';
  htmlPreviewWrapper.style.display = 'none';

  let visibleHtmlPreview: IframePreview | null = null;

  function ensureVisibleHtmlPreview(): IframePreview {
    if (!visibleHtmlPreview) {
      visibleHtmlPreview = createIframePreview({
        container: htmlPreviewWrapper,
        width: state.config.width,
        height: state.config.height,
      });
    }
    return visibleHtmlPreview;
  }

  function updatePreviewModeVisibility(): void {
    const isCustomHtml = state.currentDemoId === 'custom-html';
    previewCanvas.style.display = isCustomHtml ? 'none' : '';
    htmlPreviewWrapper.style.display = isCustomHtml ? 'flex' : 'none';
    requestAnimationFrame(() => updateOutputFrame());
  }

  // 将预览 Canvas 添加到预览区
  previewCanvas.classList.add('preview-canvas');
  elements.canvasWrapper?.appendChild(previewCanvas);
  elements.canvasWrapper?.appendChild(htmlPreviewWrapper);

  // 更新输出边框位置（跟随 canvas 实际显示区域）
  function updateOutputFrame(): void {
    if (!elements.outputFrame || !elements.canvasWrapper) return;

    const wrapper = elements.canvasWrapper;
    const wrapperRect = wrapper.getBoundingClientRect();
    const rectTarget =
      state.currentDemoId === 'custom-html' && visibleHtmlPreview
        ? visibleHtmlPreview.getIframe()
        : previewCanvas;
    const canvasRect = rectTarget.getBoundingClientRect();

    // 计算 canvas 相对于 wrapper 的位置
    const offsetLeft = canvasRect.left - wrapperRect.left;
    const offsetTop = canvasRect.top - wrapperRect.top;

    // 更新边框位置和尺寸
    elements.outputFrame.style.left = `${offsetLeft}px`;
    elements.outputFrame.style.top = `${offsetTop}px`;
    elements.outputFrame.style.width = `${canvasRect.width}px`;
    elements.outputFrame.style.height = `${canvasRect.height}px`;
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

  // 切换 Demo 动画
  function switchDemo(demoId: string): void {
    if (demoId === 'custom-html') {
      if (customHtmlRenderer) {
        currentRenderer = customHtmlRenderer;
        state.currentDemoId = 'custom-html';
        canvas.width = currentRenderer.width;
        canvas.height = currentRenderer.height;
        updatePreview();
        updatePreviewModeVisibility();
      }
      return;
    }

    const demo = DEMO_ANIMATIONS.find(d => d.id === demoId);
    if (demo) {
      state.currentDemoId = demoId;
      currentRenderer = demo.factory(ctx);

      // 更新源 Canvas 尺寸为新动画的尺寸
      canvas.width = currentRenderer.width;
      canvas.height = currentRenderer.height;

      updatePreview();
      updatePreviewModeVisibility();
    }
  }

  // 渲染预览帧（所见即所得）- 支持异步渲染器
  let isRenderingFrame = false;

  async function renderPreviewFrame(t: number): Promise<void> {
    if (!previewCtx || isRenderingFrame) return;

    isRenderingFrame = true;

    try {
      // 先在源 Canvas 上渲染动画（支持异步）
      try {
        await currentRenderer.renderAt(t);
      } catch (error) {
        // 避免未处理 Promise 拒绝导致循环异常；并为“资源 load 卡住”类问题留出恢复机会
        console.error('预览渲染失败:', error);
        return;
      }

      // 清除预览 Canvas
      previewCtx.clearRect(0, 0, previewCanvas.width, previewCanvas.height);

      // 计算缩放后的尺寸
      const scaledWidth = currentRenderer.width * state.contentScale;
      const scaledHeight = currentRenderer.height * state.contentScale;

      // 居中绘制
      const offsetX = (previewCanvas.width - scaledWidth) / 2;
      const offsetY = (previewCanvas.height - scaledHeight) / 2;

      // 将源 Canvas 内容缩放绘制到预览 Canvas
      previewCtx.drawImage(
        canvas,
        0, 0, currentRenderer.width, currentRenderer.height,
        offsetX, offsetY, scaledWidth, scaledHeight
      );
    } finally {
      isRenderingFrame = false;
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
    if (state.currentDemoId === 'custom-html') {
      rebuildCustomHtmlRenderer();
    }
  });

  // 事件监听 - 动画速度滑块
  elements.animationSpeedInput?.addEventListener('input', (e) => {
    state.playbackRate = Number((e.target as HTMLInputElement).value);
    if (elements.animationSpeedValue) {
      elements.animationSpeedValue.textContent = `${state.playbackRate.toFixed(1)}x`;
    }
    // 重置动画起始时间，避免跳帧
    animationStartTime = performance.now();
    animationPausedTime = 0;
  });

  // 事件监听 - 帧率
  elements.fpsSelect?.addEventListener('change', (e) => {
    state.config.fps = Number((e.target as HTMLSelectElement).value) as FpsOption;
    updateRiskWarning();
  });

  // 事件监听 - 时长
  elements.durationSelect?.addEventListener('change', (e) => {
    state.config.duration = Number((e.target as HTMLSelectElement).value);
    updateRiskWarning();

    if (state.currentDemoId === 'custom-html') {
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
  let modalHtmlCode = DEFAULT_HTML_TEMPLATE;

  const modalElements = {
    modal: container.querySelector('#html-editor-modal') as HTMLElement,
    editorContainer: container.querySelector('#modal-editor-container') as HTMLElement,
    previewContainer: container.querySelector('#modal-preview-container') as HTMLElement,
    recordModeSelect: container.querySelector('#modal-record-mode') as HTMLSelectElement,
    transparentModeSelect: container.querySelector('#modal-transparent-mode') as HTMLSelectElement,
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
        });
      } else {
        modalPreview.resize(state.config.width, state.config.height);
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
    };

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
  updatePreviewModeVisibility();

  // 启动预览动画循环
  let animationId: number | null = null;
  animationStartTime = performance.now();

  function previewLoop(timestamp: number): void {
    if (!state.isExporting) {
      // 计算经过的时间（考虑速度）
      const elapsed = ((timestamp - animationStartTime) / 1000) * state.playbackRate + animationPausedTime;
      // 循环播放
      const t = elapsed % currentRenderer.duration;
      if (
        state.currentDemoId === 'custom-html' &&
        customHtmlState?.recordMode === 'deterministic' &&
        visibleHtmlPreview
      ) {
        const progress = (t % state.config.duration) / state.config.duration;
        visibleHtmlPreview.setProgress(progress);
      } else {
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
      visibleHtmlPreview?.destroy();
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
