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
    currentDemoId: DEMO_ANIMATIONS[0]?.id ?? '',
  };

  let currentRenderer = renderer;
  let exportController: ExportController | null = null;

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

  // 将预览 Canvas 添加到预览区
  previewCanvas.classList.add('preview-canvas');
  elements.canvasWrapper?.appendChild(previewCanvas);

  // 更新输出边框位置（跟随 canvas 实际显示区域）
  function updateOutputFrame(): void {
    if (!elements.outputFrame || !elements.canvasWrapper) return;

    const wrapper = elements.canvasWrapper;
    const wrapperRect = wrapper.getBoundingClientRect();
    const canvasRect = previewCanvas.getBoundingClientRect();

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

  // 渲染预览帧（所见即所得）
  function renderPreviewFrame(t: number): void {
    if (!previewCtx) return;

    // 先在源 Canvas 上渲染动画
    currentRenderer.renderAt(t);

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

  // 事件监听 - 帧率
  elements.fpsSelect?.addEventListener('change', (e) => {
    state.config.fps = Number((e.target as HTMLSelectElement).value) as FpsOption;
    updateRiskWarning();
  });

  // 事件监听 - 时长
  elements.durationSelect?.addEventListener('change', (e) => {
    state.config.duration = Number((e.target as HTMLSelectElement).value);
    updateRiskWarning();
  });

  elements.startBtn?.addEventListener('click', startExport);
  elements.cancelBtn?.addEventListener('click', cancelExport);
  elements.downloadBtn?.addEventListener('click', download);

  // 初始化
  updatePreview();
  updateRiskWarning();
  updateButtons();
  updateToggleButtons();

  // 启动预览动画循环
  let animationId: number | null = null;

  function previewLoop(timestamp: number): void {
    if (!state.isExporting) {
      const t = (timestamp / 1000) % currentRenderer.duration;
      renderPreviewFrame(t);
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
    `<option value="${r.width}x${r.height}">${r.label}</option>`
  ).join('');

  const durationOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((d) => `<option value="${d}" ${d === 5 ? 'selected' : ''}>${d} 秒</option>`)
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
  `;
}
