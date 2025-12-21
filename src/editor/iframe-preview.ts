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
}

export interface IframePreview {
  /** 更新 HTML 内容 */
  updateContent(html: string): void;
  /** 设置 CSS 变量 --t 的值 */
  setProgress(t: number): void;
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

  /**
   * 注入透明背景样式和 --t 变量支持
   */
  function injectStyles(html: string): string {
    // 注入透明背景样式
    const transparentStyle = `
      <style id="__alpha_video_inject__">
        html, body {
          background: transparent !important;
          background-color: transparent !important;
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

  return {
    updateContent(html: string): void {
      currentHtml = html;
      const processedHtml = injectStyles(html);

      // 使用 srcdoc 设置内容
      iframe.srcdoc = processedHtml;
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
