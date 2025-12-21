/**
 * FFmpeg 桥接器
 * 主线程与 FFmpeg Worker 之间的通信桥接
 */

import type {
  FFmpegWorkerRequest,
  FFmpegWorkerResponse,
  FFmpegProgressEvent,
} from '@/core/types';

type MessageHandler = (response: FFmpegWorkerResponse) => void;
type ProgressHandler = (progress: FFmpegProgressEvent) => void;
type LogHandler = (message: string) => void;

/**
 * FFmpeg 桥接器类
 */
export class FFmpegBridge {
  private worker: Worker | null = null;
  private messageHandlers: Map<string, MessageHandler> = new Map();
  private progressHandler: ProgressHandler | null = null;
  private logHandler: LogHandler | null = null;
  private messageId = 0;
  private isReady = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;

  constructor() {
    this.createWorker();
  }

  /**
   * 创建 Worker
   */
  private createWorker(): void {
    // 使用 Vite 的 Worker 导入语法
    this.worker = new Worker(
      new URL('./ffmpeg-worker.ts', import.meta.url),
      { type: 'module' }
    );

    this.readyPromise = new Promise((resolve) => {
      this.readyResolve = resolve;
    });

    this.worker.onmessage = (event) => {
      this.handleWorkerMessage(event.data);
    };

    this.worker.onerror = (error) => {
      console.error('FFmpeg Worker 错误:', error);
    };
  }

  /**
   * 处理 Worker 消息
   */
  private handleWorkerMessage(data: FFmpegWorkerResponse & { type?: string; message?: string; progress?: number; time?: number }): void {
    // 处理特殊消息类型
    if (data.type === 'ready') {
      this.isReady = true;
      this.readyResolve?.();
      return;
    }

    if (data.type === 'progress' && this.progressHandler) {
      this.progressHandler({
        frame: 0,
        time: data.time ?? 0,
        progress: data.progress ?? 0,
      });
      return;
    }

    if (data.type === 'log' && this.logHandler) {
      this.logHandler(data.message ?? '');
      return;
    }

    // 处理请求响应
    const handler = this.messageHandlers.get(data.id);
    if (handler) {
      handler(data);
      this.messageHandlers.delete(data.id);
    }
  }

  /**
   * 等待 Worker 准备就绪
   */
  async waitReady(): Promise<void> {
    if (this.isReady) {
      return;
    }
    await this.readyPromise;
  }

  /**
   * 发送消息到 Worker 并等待响应
   */
  private async sendMessage<T>(
    type: FFmpegWorkerRequest['type'],
    payload?: unknown
  ): Promise<T> {
    if (!this.worker) {
      throw new Error('Worker 未初始化');
    }

    await this.waitReady();

    const id = (++this.messageId).toString();

    return new Promise((resolve, reject) => {
      this.messageHandlers.set(id, (response) => {
        if (response.success) {
          resolve(response.data as T);
        } else {
          reject(new Error(response.error ?? '未知错误'));
        }
      });

      const request: FFmpegWorkerRequest = { id, type, payload };
      this.worker?.postMessage(request);
    });
  }

  /**
   * 设置进度回调
   */
  onProgress(handler: ProgressHandler): void {
    this.progressHandler = handler;
  }

  /**
   * 设置日志回调
   */
  onLog(handler: LogHandler): void {
    this.logHandler = handler;
  }

  /**
   * 加载 FFmpeg
   */
  async load(useMultiThread: boolean): Promise<void> {
    await this.sendMessage('load', { useMultiThread });
  }

  /**
   * 执行 FFmpeg 命令
   */
  async exec(args: string[]): Promise<void> {
    await this.sendMessage('exec', { args });
  }

  /**
   * 写入文件
   */
  async writeFile(path: string, data: Uint8Array): Promise<void> {
    await this.sendMessage('writeFile', { path, data });
  }

  /**
   * 读取文件
   */
  async readFile(path: string): Promise<Uint8Array> {
    const result = await this.sendMessage<{ data: Uint8Array }>('readFile', {
      path,
    });
    return result.data;
  }

  /**
   * 删除文件
   */
  async deleteFile(path: string): Promise<void> {
    await this.sendMessage('deleteFile', { path });
  }

  /**
   * 创建目录
   */
  async createDir(path: string): Promise<void> {
    await this.sendMessage('createDir', { path });
  }

  /**
   * 删除目录
   */
  async deleteDir(path: string): Promise<void> {
    await this.sendMessage('deleteDir', { path });
  }

  /**
   * 列出目录
   */
  async listDir(path: string): Promise<string[]> {
    const result = await this.sendMessage<{ entries: string[] }>('listDir', {
      path,
    });
    return result.entries;
  }

  /**
   * 终止 Worker
   */
  terminate(): void {
    if (this.worker) {
      this.worker.postMessage({ id: '0', type: 'terminate' });
      this.worker.terminate();
      this.worker = null;
      this.isReady = false;
      this.messageHandlers.clear();
    }
  }
}

/**
 * 创建 FFmpeg 桥接器实例
 */
export function createFFmpegBridge(): FFmpegBridge {
  return new FFmpegBridge();
}
