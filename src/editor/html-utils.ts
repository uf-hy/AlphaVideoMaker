export type TransparentMode = 'auto' | 'none' | 'custom';

export interface InjectTransparentBackgroundOptions {
  mode: TransparentMode;
  /**
   * mode=custom 时可用。当前仅做占位：实际“抠色转透明”需要更复杂的实现。
   */
  customBgColor?: string;
}

export interface InjectContentScaleOptions {
  contentScale: number;
}

/**
 * 注入透明背景处理样式（用于 iframe/srcdoc 场景）
 *
 * - mode=none: 不做任何处理
 * - mode=auto: 强制 html/body 背景透明
 * - mode=custom: 当前等同于 auto（预留）
 */
export function injectTransparentBackground(
  html: string,
  options: InjectTransparentBackgroundOptions
): string {
  if (options.mode === 'none') return html;

  // NOTE: custom 模式目前仅占位，避免误导用户以为已实现抠色。
  const bgStyle =
    options.mode === 'auto' || options.mode === 'custom'
      ? 'background: transparent !important; background-color: transparent !important;'
      : '';

  const injectStyle = `<style id="__alpha_inject__">html,body{${bgStyle}}</style>`;

  if (html.includes('</head>')) {
    return html.replace('</head>', `${injectStyle}</head>`);
  }

  return injectStyle + html;
}

/**
 * 注入内容缩放（用于“自定义 HTML”预览/导出的一致性）
 *
 * 注意：这是对整个 body 做 transform 缩放，能匹配“内容缩放”语义，但也会影响 layout。
 */
export function injectContentScale(html: string, options: InjectContentScaleOptions): string {
  const contentScale = Number(options.contentScale);
  if (!Number.isFinite(contentScale) || contentScale === 1) return html;

  const injectStyle = `<style id="__alpha_content_scale__">body{transform:scale(${contentScale});transform-origin:50% 50%;}</style>`;

  if (html.includes('</head>')) {
    return html.replace('</head>', `${injectStyle}</head>`);
  }

  return injectStyle + html;
}
