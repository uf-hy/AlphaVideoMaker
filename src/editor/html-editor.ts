/**
 * HTML 代码编辑器模块
 * 基于 CodeMirror 6 实现
 */

import { EditorView, basicSetup } from 'codemirror';
import { html } from '@codemirror/lang-html';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorState } from '@codemirror/state';

export interface HtmlEditorOptions {
  /** 编辑器容器 */
  container: HTMLElement;
  /** 初始代码 */
  initialCode?: string;
  /** 代码变更回调 */
  onChange?: (code: string) => void;
  /** 防抖延迟 (ms) */
  debounceDelay?: number;
}

export interface HtmlEditor {
  /** 获取当前代码 */
  getCode(): string;
  /** 设置代码 */
  setCode(code: string): void;
  /** 销毁编辑器 */
  destroy(): void;
}

/**
 * 创建 HTML 代码编辑器
 */
export function createHtmlEditor(options: HtmlEditorOptions): HtmlEditor {
  const {
    container,
    initialCode = '',
    onChange,
    debounceDelay = 300,
  } = options;

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  // 创建编辑器状态
  const state = EditorState.create({
    doc: initialCode,
    extensions: [
      basicSetup,
      html(),
      oneDark,
      EditorView.updateListener.of((update) => {
        if (update.docChanged && onChange) {
          // 防抖处理
          if (debounceTimer) {
            clearTimeout(debounceTimer);
          }
          debounceTimer = setTimeout(() => {
            onChange(update.state.doc.toString());
          }, debounceDelay);
        }
      }),
      EditorView.theme({
        '&': {
          height: '100%',
          fontSize: '14px',
        },
        '.cm-scroller': {
          overflow: 'auto',
          fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
        },
        '.cm-content': {
          caretColor: '#fff',
        },
        '.cm-gutters': {
          backgroundColor: '#1e1e2e',
          borderRight: '1px solid #313244',
        },
      }),
    ],
  });

  // 创建编辑器视图
  const view = new EditorView({
    state,
    parent: container,
  });

  return {
    getCode(): string {
      return view.state.doc.toString();
    },

    setCode(code: string): void {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: code,
        },
      });
    },

    destroy(): void {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
      }
      view.destroy();
    },
  };
}
