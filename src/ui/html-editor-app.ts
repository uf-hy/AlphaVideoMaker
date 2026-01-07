/**
 * HTML 编辑器应用
 * 左右分栏布局：左侧代码编辑器，右侧预览和控制面板
 */

import type { ExportConfig, ExportProgress, ExportResult, CodecType, FpsOption } from '@/core/types';
import { DEFAULT_EXPORT_CONFIG, RESOLUTION_PRESETS, INITIAL_PROGRESS } from '@/core/types';
import { createExportController, ExportController } from '@/core/export-controller';
import { detectEnvironment, downloadBlob } from '@/utils';
import { getCodecDisplayName } from '@/encoder';
import {
  createHtmlEditor,
  createIframePreview,
  createHtmlExportRenderer,
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
interface HtmlEditorAppState {
  config: ExportConfig;
  progress: ExportProgress;
  isExporting: boolean;
  result: ExportResult | null;
  recordMode: RecordMode;
  captureEngine: CaptureEngine;
  transparentMode: TransparentMode;
  customBgColor: string;
}

/**
 * 创建 HTML 编辑器应用
 */
export function createHtmlEditorApp(container: HTMLElement): { destroy: () => void } {
  const env = detectEnvironment();

  // 状态
  const state: HtmlEditorAppState = {
    config: { ...DEFAULT_EXPORT_CONFIG },
    progress: { ...INITIAL_PROGRESS },
    isExporting: false,
    result: null,
    recordMode: 'deterministic',
    captureEngine: 'snapdom',
    transparentMode: 'auto',
    customBgColor: '#00ff00',
  };

  let editor: HtmlEditor | null = null;
  let preview: IframePreview | null = null;
  let exportController: ExportController | null = null;
  let previewAnimationId: number | null = null;

  // 创建 DOM
  container.innerHTML = createAppHTML(state, env.canUseMultiThread);

  // 获取 DOM 元素
  const elements = {
    editorContainer: container.querySelector('#editor-container') as HTMLElement,
    previewContainer: container.querySelector('#preview-container') as HTMLElement,
    hiddenContainer: container.querySelector('#hidden-render-container') as HTMLElement,
    recordModeSelect: container.querySelector('#record-mode-select') as HTMLSelectElement,
    captureEngineSelect: container.querySelector('#capture-engine-select') as HTMLSelectElement,
    transparentModeSelect: container.querySelector('#transparent-mode-select') as HTMLSelectElement,
    customBgColorInput: container.querySelector('#custom-bg-color') as HTMLInputElement,
    customBgColorGroup: container.querySelector('#custom-bg-color-group') as HTMLElement,
    resolutionSelect: container.querySelector('#resolution-select') as HTMLSelectElement,
    fpsSelect: container.querySelector('#fps-select') as HTMLSelectElement,
    durationSelect: container.querySelector('#duration-select') as HTMLSelectElement,
    codecSelect: container.querySelector('#codec-select') as HTMLSelectElement,
    progressBar: container.querySelector('.progress-bar') as HTMLElement,
    progressPercent: container.querySelector('.progress-percent') as HTMLElement,
    startBtn: container.querySelector('#start-btn') as HTMLButtonElement,
    cancelBtn: container.querySelector('#cancel-btn') as HTMLButtonElement,
    downloadBtn: container.querySelector('#download-btn') as HTMLButtonElement,
    resetBtn: container.querySelector('#reset-btn') as HTMLButtonElement,
    templateBtns: container.querySelectorAll('.template-btn') as NodeListOf<HTMLButtonElement>,
    previewInfo: container.querySelector('.preview-info') as HTMLElement,
  };

  // 初始化编辑器
  editor = createHtmlEditor({
    container: elements.editorContainer,
    initialCode: DEFAULT_HTML_TEMPLATE,
    onChange: (code) => {
      preview?.updateContent(processHtml(code));
    },
    debounceDelay: 300,
  });

  // 初始化预览
  preview = createIframePreview({
    container: elements.previewContainer,
    width: state.config.width,
    height: state.config.height,
    durationSeconds: state.config.duration,
  });
  preview.setDurationSeconds(state.config.duration);

  preview.updateContent(processHtml(DEFAULT_HTML_TEMPLATE));

  /**
   * 处理 HTML（注入透明背景样式）
   */
  function processHtml(html: string): string {
    return injectTransparentBackground(html, {
      mode: state.transparentMode,
      customBgColor: state.customBgColor,
    });
  }

  /**
   * 更新预览尺寸
   */
  function updatePreviewSize(): void {
    const { width, height } = state.config;
    preview?.resize(width, height);
    preview?.setDurationSeconds(state.config.duration);

    // 更新预览容器的宽高比
    const previewWrapper = elements.previewContainer.parentElement;
    if (previewWrapper) {
      previewWrapper.style.setProperty('--preview-aspect-ratio', `${width}/${height}`);
    }

    if (elements.previewInfo) {
      elements.previewInfo.textContent = `${width}×${height} | ${state.config.fps}fps | ${state.config.duration}s`;
    }
  }

  /**
   * 预览动画循环（确定性模式）
   */
  function startPreviewLoop(): void {
    if (state.recordMode !== 'deterministic') return;

    const startTime = performance.now();

    function loop(): void {
      if (state.isExporting) {
        previewAnimationId = requestAnimationFrame(loop);
        return;
      }

      const elapsed = (performance.now() - startTime) / 1000;
      const t = (elapsed % state.config.duration) / state.config.duration;
      preview?.setProgress(t);

      previewAnimationId = requestAnimationFrame(loop);
    }

    previewAnimationId = requestAnimationFrame(loop);
  }

  /**
   * 停止预览循环
   */
  function stopPreviewLoop(): void {
    if (previewAnimationId !== null) {
      cancelAnimationFrame(previewAnimationId);
      previewAnimationId = null;
    }
  }

  /**
   * 更新进度显示
   */
  function updateProgress(progress: ExportProgress): void {
    state.progress = progress;

    if (elements.progressBar) {
      elements.progressBar.style.width = `${progress.percent}%`;
    }
    if (elements.progressPercent) {
      elements.progressPercent.textContent = `${progress.percent}%`;
    }
  }

  /**
   * 更新按钮状态
   */
  function updateButtons(): void {
    elements.startBtn.disabled = state.isExporting;
    elements.cancelBtn.style.display = state.isExporting ? 'inline-flex' : 'none';
    elements.downloadBtn.style.display = state.result?.success ? 'inline-flex' : 'none';
  }

  /**
   * 开始导出
   */
  async function startExport(): Promise<void> {
    if (state.isExporting || !editor) return;

    state.isExporting = true;
    state.result = null;
    updateButtons();
    updateProgress({ ...INITIAL_PROGRESS, phase: 'initializing' });

    let htmlRenderer: ReturnType<typeof createHtmlExportRenderer> | null = null;

    try {
      // 创建用于导出的 canvas
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = state.config.width;
      exportCanvas.height = state.config.height;
      const exportCtx = exportCanvas.getContext('2d');

      if (!exportCtx) {
        throw new Error('无法创建导出 Canvas');
      }

      // 创建 HTML 渲染器
      htmlRenderer = createHtmlExportRenderer({
        html: processHtml(editor.getCode()),
        width: state.config.width,
        height: state.config.height,
        duration: state.config.duration,
        mode: state.recordMode,
        captureEngine: state.captureEngine,
        hiddenContainer: elements.hiddenContainer,
        canvas: exportCanvas,
        ctx: exportCtx,
      });

      // 创建导出控制器
      exportController = createExportController(
        exportCanvas,
        htmlRenderer,
        state.config,
        updateProgress
      );

      const result = await exportController.start();
      state.result = result;

      if (!result.success) {
        console.error('导出失败:', result.error);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('导出异常:', error);
      state.result = { success: false, error: message };
      updateProgress({ ...INITIAL_PROGRESS, phase: 'error', error: message });
    } finally {
      state.isExporting = false;
      updateButtons();
      htmlRenderer?.dispose?.();
    }
  }

  /**
   * 取消导出
   */
  function cancelExport(): void {
    exportController?.cancel();
    state.isExporting = false;
    updateButtons();
  }

  /**
   * 下载文件
   */
  function download(): void {
    if (state.result?.success && state.result.blob && state.result.filename) {
      downloadBlob(state.result.blob, state.result.filename);
    }
  }

  // 事件监听
  elements.recordModeSelect?.addEventListener('change', (e) => {
    state.recordMode = (e.target as HTMLSelectElement).value as RecordMode;
    stopPreviewLoop();
    if (state.recordMode === 'deterministic') {
      startPreviewLoop();
    } else {
      preview?.reset();
    }
  });

  elements.captureEngineSelect?.addEventListener('change', (e) => {
    state.captureEngine = (e.target as HTMLSelectElement).value as CaptureEngine;
  });

  elements.transparentModeSelect?.addEventListener('change', (e) => {
    state.transparentMode = (e.target as HTMLSelectElement).value as TransparentMode;
    elements.customBgColorGroup.style.display = state.transparentMode === 'custom' ? 'block' : 'none';
    if (editor) {
      preview?.updateContent(processHtml(editor.getCode()));
    }
  });

  elements.customBgColorInput?.addEventListener('change', (e) => {
    state.customBgColor = (e.target as HTMLInputElement).value;
  });

  elements.resolutionSelect?.addEventListener('change', (e) => {
    const [width, height] = (e.target as HTMLSelectElement).value.split('x').map(Number);
    if (width && height) {
      state.config.width = width;
      state.config.height = height;
      updatePreviewSize();
    }
  });

  elements.fpsSelect?.addEventListener('change', (e) => {
    state.config.fps = Number((e.target as HTMLSelectElement).value) as FpsOption;
    updatePreviewSize();
  });

  elements.durationSelect?.addEventListener('change', (e) => {
    state.config.duration = Number((e.target as HTMLSelectElement).value);
    updatePreviewSize();
  });

  elements.codecSelect?.addEventListener('change', (e) => {
    state.config.codec = (e.target as HTMLSelectElement).value as CodecType;
  });

  elements.startBtn?.addEventListener('click', startExport);
  elements.cancelBtn?.addEventListener('click', cancelExport);
  elements.downloadBtn?.addEventListener('click', download);

  elements.resetBtn?.addEventListener('click', () => {
    if (editor) {
      const template = state.recordMode === 'deterministic' ? DEFAULT_HTML_TEMPLATE : REALTIME_HTML_TEMPLATE;
      editor.setCode(template);
      preview?.updateContent(processHtml(template));
    }
  });

  // 模板按钮
  elements.templateBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const templateType = btn.dataset.template;
      if (templateType === 'deterministic' && editor) {
        editor.setCode(DEFAULT_HTML_TEMPLATE);
        preview?.updateContent(processHtml(DEFAULT_HTML_TEMPLATE));
      } else if (templateType === 'realtime' && editor) {
        editor.setCode(REALTIME_HTML_TEMPLATE);
        preview?.updateContent(processHtml(REALTIME_HTML_TEMPLATE));
      } else if (templateType === 'glass-card' && editor) {
        editor.setCode(GLASS_CARD_STATS_TEMPLATE);
        preview?.updateContent(processHtml(GLASS_CARD_STATS_TEMPLATE));
      }
    });
  });

  // 初始化
  updatePreviewSize();
  updateButtons();
  startPreviewLoop();

  return {
    destroy(): void {
      stopPreviewLoop();
      editor?.destroy();
      preview?.destroy();
      exportController?.cancel();
      container.innerHTML = '';
    },
  };
}

/**
 * 创建应用 HTML
 */
function createAppHTML(state: HtmlEditorAppState, canUseMultiThread: boolean): string {
  const resolutionOptions = RESOLUTION_PRESETS.map((r) =>
    `<option value="${r.width}x${r.height}" ${r.width === state.config.width && r.height === state.config.height ? 'selected' : ''}>${r.label}</option>`
  ).join('');

  const durationOptions = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
    .map((d) => `<option value="${d}" ${d === state.config.duration ? 'selected' : ''}>${d} 秒</option>`)
    .join('');

  return `
    <div class="html-editor-app">
      <!-- 左侧：代码编辑器 -->
      <div class="editor-panel">
        <div class="panel-header">
          <h3>📝 HTML 代码</h3>
          <div class="template-buttons">
            <button class="template-btn" data-template="deterministic">确定性模板</button>
            <button class="template-btn" data-template="realtime">实时模板</button>
            <button class="template-btn" data-template="glass-card">卡片示例</button>
            <button id="reset-btn" class="template-btn">重置</button>
          </div>
        </div>
        <div id="editor-container" class="editor-container"></div>
      </div>

      <!-- 右侧：预览和控制 -->
      <div class="preview-panel">
        <div class="preview-section">
          <div class="panel-header">
            <h3>👁️ 预览</h3>
            <span class="preview-info">${state.config.width}×${state.config.height}</span>
          </div>
          <div class="preview-wrapper" style="--preview-aspect-ratio: ${state.config.width}/${state.config.height}">
            <div id="preview-container" class="preview-container"></div>
          </div>
        </div>

        <div class="control-section">
          <div class="control-group">
            <label>录制模式</label>
            <select id="record-mode-select" class="form-select">
              <option value="deterministic" selected>确定性模式 (推荐)</option>
              <option value="realtime">实时模式</option>
            </select>
            <small class="hint">确定性模式通过 CSS 变量 --t 控制动画，帧率稳定</small>
          </div>

          <div class="control-group">
            <label>截图引擎</label>
            <select id="capture-engine-select" class="form-select">
              <option value="snapdom" selected>SnapDOM (推荐)</option>
              <option value="html2canvas">html2canvas</option>
            </select>
            <small class="hint">SnapDOM 渲染更准确、速度更快</small>
          </div>

          <div class="control-group">
            <label>透明背景</label>
            <select id="transparent-mode-select" class="form-select">
              <option value="auto" selected>自动处理</option>
              <option value="none">不处理</option>
              <option value="custom">手动指定颜色</option>
            </select>
          </div>

          <div id="custom-bg-color-group" class="control-group" style="display: none;">
            <label>要替换为透明的颜色</label>
            <input type="color" id="custom-bg-color" value="#00ff00" class="form-input">
          </div>

          <div class="control-row">
            <div class="control-group">
              <label>分辨率</label>
              <select id="resolution-select" class="form-select">
                ${resolutionOptions}
              </select>
            </div>
            <div class="control-group">
              <label>帧率</label>
              <select id="fps-select" class="form-select">
                <option value="30" selected>30 fps</option>
                <option value="60">60 fps</option>
              </select>
            </div>
          </div>

          <div class="control-row">
            <div class="control-group">
              <label>时长</label>
              <select id="duration-select" class="form-select">
                ${durationOptions}
              </select>
            </div>
            <div class="control-group">
              <label>编码</label>
              <select id="codec-select" class="form-select">
                <option value="qtrle" selected>${getCodecDisplayName('qtrle')}</option>
                <option value="prores_4444">${getCodecDisplayName('prores_4444')}</option>
              </select>
            </div>
          </div>

          <div class="progress-section">
            <div class="progress-bar-wrapper">
              <div class="progress-bar" style="width: 0%"></div>
            </div>
            <span class="progress-percent">0%</span>
          </div>

          <div class="btn-group">
            <button id="start-btn" class="btn btn-primary">🚀 开始导出</button>
            <button id="cancel-btn" class="btn btn-danger" style="display: none;">取消</button>
            <button id="download-btn" class="btn btn-success" style="display: none;">📥 下载</button>
          </div>

          ${!canUseMultiThread ? '<div class="warning-hint">⚠️ 单线程模式，导出速度较慢</div>' : ''}
        </div>
      </div>

      <!-- 隐藏的渲染容器 -->
      <div id="hidden-render-container" style="position: absolute; left: -9999px; top: -9999px;"></div>
    </div>
  `;
}
