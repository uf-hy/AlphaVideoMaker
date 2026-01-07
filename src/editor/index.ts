/**
 * 编辑器模块导出
 */

export { createHtmlEditor, type HtmlEditor, type HtmlEditorOptions } from './html-editor';
export { createIframePreview, type IframePreview, type IframePreviewOptions } from './iframe-preview';
export {
  createHtmlAnimationRenderer,
  createHtmlExportRenderer,
  type RecordMode,
  type CaptureEngine,
  type HtmlAnimationRendererOptions,
} from './html-renderer';
export {
  injectTransparentBackground,
  type TransparentMode,
  type InjectTransparentBackgroundOptions,
} from './html-utils';
export {
  DEFAULT_HTML_TEMPLATE,
  REALTIME_HTML_TEMPLATE,
  GLASS_CARD_STATS_TEMPLATE,
} from './templates';
export {
  createFrameCache,
  type FrameCache,
  type FrameCacheOptions,
} from './frame-cache';
