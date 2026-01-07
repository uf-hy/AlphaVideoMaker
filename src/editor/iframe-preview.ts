/**
 * iframe 预览组件
 * 用于实时预览 HTML 动画
 */

export interface IframePreviewOptions {
  /** 容器元素 */
  container: HTMLElement;
  /** 宽度 */
  width: number;
  /** 高度 */
  height: number;
  /**
   * 动画总时长（秒，可选）
   * - 用于将 setProgress(t:0..1) 映射为绝对时间，进而同步 CSS Animation 时间线
   */
  durationSeconds?: number;
}

export interface IframePreview {
  /** 更新 HTML 内容 */
  updateContent(html: string): void;
  /** 设置 CSS 变量 --t 的值 */
  setProgress(t: number): void;
  /** 设置动画总时长（秒） */
  setDurationSeconds(durationSeconds: number): void;
  /** 重置动画（重新加载 iframe） */
  reset(): void;
  /** 获取 iframe 的 contentWindow */
  getContentWindow(): Window | null;
  /** 获取 iframe 元素 */
  getIframe(): HTMLIFrameElement;
  /** 调整尺寸 */
  resize(width: number, height: number): void;
  /** 销毁 */
  destroy(): void;
}

/**
 * 创建 iframe 预览
 */
export function createIframePreview(options: IframePreviewOptions): IframePreview {
  const { container, width, height } = options;

  // 创建 iframe
  const iframe = document.createElement('iframe');
  iframe.style.cssText = `
    width: ${width}px;
    height: ${height}px;
    border: none;
    background: transparent;
  `;
  iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin');

  container.appendChild(iframe);

  let currentHtml = '';
  let durationSeconds = options.durationSeconds ?? 0;
  let hasLoadedOnce = false;
  let cachedAnimations: Animation[] | null = null;
  let animationScanAttempts = 0;

  /**
   * 注入透明背景样式和 --t 变量支持
   */
  function injectStyles(html: string): string {
    const transparentStyle = `
      <style id="__alpha_video_inject__">
        html, body {
          width: 100%;
          height: 100%;
          margin: 0;
          padding: 0;
          background: transparent !important;
          background-color: transparent !important;
          overflow: hidden !important;
        }
      </style>
    `;

    // 如果有 </head>，在其前面插入
    if (html.includes('</head>')) {
      return html.replace('</head>', `${transparentStyle}</head>`);
    }

    // 如果有 <body>，在其前面插入
    if (html.includes('<body')) {
      return html.replace(/<body/i, `${transparentStyle}<body`);
    }

    // 否则直接在开头插入
    return transparentStyle + html;
  }

  function applyRuntimeVars(): void {
    try {
      const doc = iframe.contentDocument;
      if (!doc?.documentElement) return;
      if (durationSeconds > 0) {
        doc.documentElement.style.setProperty('--alpha_duration', String(durationSeconds));
      }
    } catch {
      // 忽略（sandbox/跨域）
    }
  }

  function getAnimations(doc: Document): Animation[] {
    try {
      const fn = (doc as unknown as { getAnimations?: (opts?: { subtree?: boolean }) => Animation[] })
        .getAnimations;
      if (typeof fn === 'function') {
        return fn.call(doc, { subtree: true });
      }
    } catch {
      // ignore
    }
    return [];
  }

  function syncCssAnimations(normalizedProgress: number): void {
    if (!(durationSeconds > 0)) return;

    const timeMs = normalizedProgress * durationSeconds * 1000;
    if (!Number.isFinite(timeMs) || timeMs < 0) return;

    try {
      const doc = iframe.contentDocument;
      if (!doc) return;

      // 缓存 Animation 列表，避免每帧都全量扫描；当内容更新/首次 load 时会清空缓存
      if (!cachedAnimations || (cachedAnimations.length === 0 && animationScanAttempts < 3)) {
        cachedAnimations = getAnimations(doc);
        animationScanAttempts++;
      }

      for (const anim of cachedAnimations) {
        try {
          anim.pause();
          anim.currentTime = timeMs;
        } catch {
          // ignore individual animation
        }
      }
    } catch {
      // ignore
    }
  }

  iframe.addEventListener('load', () => {
    hasLoadedOnce = true;
    cachedAnimations = null;
    animationScanAttempts = 0;
    applyRuntimeVars();
  });

  return {
    updateContent(html: string): void {
      currentHtml = html;
      const processedHtml = injectStyles(html);

      // 使用 srcdoc 设置内容
      iframe.srcdoc = processedHtml;
      cachedAnimations = null;
      animationScanAttempts = 0;
    },

    setProgress(t: number): void {
      try {
        const doc = iframe.contentDocument;
        if (doc?.documentElement) {
          doc.documentElement.style.setProperty('--t', String(t));
        }
      } catch {
        // 跨域错误，忽略
      }

      // 将 CSS Animation 时间线同步到绝对时间点（用于“非 --t 模板”的确定性导出）
      syncCssAnimations(t);
    },

    setDurationSeconds(newDurationSeconds: number): void {
      durationSeconds = newDurationSeconds;
      // 若 iframe 已加载过，立即同步变量；未加载时会在 load 里补上
      if (hasLoadedOnce) applyRuntimeVars();
    },

    reset(): void {
      if (currentHtml) {
        this.updateContent(currentHtml);
      }
    },

    getContentWindow(): Window | null {
      return iframe.contentWindow;
    },

    getIframe(): HTMLIFrameElement {
      return iframe;
    },

    resize(newWidth: number, newHeight: number): void {
      iframe.style.width = `${newWidth}px`;
      iframe.style.height = `${newHeight}px`;
    },

    destroy(): void {
      iframe.remove();
    },
  };
}
