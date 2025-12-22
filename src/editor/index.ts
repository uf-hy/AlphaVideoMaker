/**
 * 编辑器模块导出
 */

export { createHtmlEditor, type HtmlEditor, type HtmlEditorOptions } from './html-editor';
export { createIframePreview, type IframePreview, type IframePreviewOptions } from './iframe-preview';
export {
  createHtmlAnimationRenderer,
  createHtmlExportRenderer,
  type RecordMode,
  type HtmlAnimationRendererOptions,
} from './html-renderer';
export {
  injectTransparentBackground,
  type TransparentMode,
  type InjectTransparentBackgroundOptions,
} from './html-utils';
export { DEFAULT_HTML_TEMPLATE, REALTIME_HTML_TEMPLATE } from './templates';
