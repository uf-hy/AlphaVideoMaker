/**
 * FFmpeg Worker 入口
 * 在 Web Worker 中运行 FFmpeg.wasm
 */

import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

import type {
  FFmpegWorkerRequest,
  FFmpegWorkerResponse,
} from '@/core/types';

// FFmpeg 实例
let ffmpeg: FFmpeg | null = null;
let isLoaded = false;

/**
 * 加载 FFmpeg
 */
async function loadFFmpeg(useMultiThread: boolean): Promise<void> {
  if (isLoaded) {
    return;
  }

  ffmpeg = new FFmpeg();

  // 设置日志回调
  ffmpeg.on('log', ({ message }) => {
    // 发送日志到主线程（用于调试）
    self.postMessage({
      type: 'log',
      message,
    });
  });

  // 设置进度回调
  ffmpeg.on('progress', ({ progress, time }) => {
    self.postMessage({
      type: 'progress',
      progress,
      time,
    });
  });

  // 根据是否支持多线程选择不同的 core
  const baseURL = 'https://unpkg.com/@ffmpeg/core@0.12.6/dist/esm';
  const mtBaseURL = 'https://unpkg.com/@ffmpeg/core-mt@0.12.6/dist/esm';

  try {
    if (useMultiThread) {
      // 多线程模式
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${mtBaseURL}/ffmpeg-core.js`,
          'text/javascript'
        ),
        wasmURL: await toBlobURL(
          `${mtBaseURL}/ffmpeg-core.wasm`,
          'application/wasm'
        ),
        workerURL: await toBlobURL(
          `${mtBaseURL}/ffmpeg-core.worker.js`,
          'text/javascript'
        ),
      });
    } else {
      // 单线程模式
      await ffmpeg.load({
        coreURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.js`,
          'text/javascript'
        ),
        wasmURL: await toBlobURL(
          `${baseURL}/ffmpeg-core.wasm`,
          'application/wasm'
        ),
      });
    }

    isLoaded = true;
  } catch (error) {
    throw new Error(
      `FFmpeg 加载失败: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * 执行 FFmpeg 命令
 */
async function execFFmpeg(args: string[]): Promise<void> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  await ffmpeg.exec(args);
}

/**
 * 写入文件到虚拟文件系统
 */
async function writeFile(path: string, data: Uint8Array): Promise<void> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  await ffmpeg.writeFile(path, data);
}

/**
 * 从虚拟文件系统读取文件
 */
async function readFile(path: string): Promise<Uint8Array> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  const data = await ffmpeg.readFile(path);
  if (typeof data === 'string') {
    // 如果返回字符串，转换为 Uint8Array
    return new TextEncoder().encode(data);
  }
  return data;
}

/**
 * 删除虚拟文件系统中的文件
 */
async function deleteFile(path: string): Promise<void> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  await ffmpeg.deleteFile(path);
}

/**
 * 创建目录
 */
async function createDir(path: string): Promise<void> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  await ffmpeg.createDir(path);
}

/**
 * 删除目录
 */
async function deleteDir(path: string): Promise<void> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  await ffmpeg.deleteDir(path);
}

/**
 * 列出目录内容
 */
async function listDir(path: string): Promise<string[]> {
  if (!ffmpeg || !isLoaded) {
    throw new Error('FFmpeg 尚未加载');
  }

  const entries = await ffmpeg.listDir(path);
  return entries.map((entry) => entry.name);
}

/**
 * 终止 FFmpeg
 */
function terminate(): void {
  if (ffmpeg) {
    ffmpeg.terminate();
    ffmpeg = null;
    isLoaded = false;
  }
}

/**
 * 发送响应到主线程
 */
function sendResponse(response: FFmpegWorkerResponse): void {
  self.postMessage(response);
}

/**
 * 处理来自主线程的消息
 */
self.onmessage = async (event: MessageEvent<FFmpegWorkerRequest>) => {
  const { id, type, payload } = event.data;

  try {
    let result: unknown;

    switch (type) {
      case 'load': {
        const { useMultiThread } = payload as { useMultiThread: boolean };
        await loadFFmpeg(useMultiThread);
        result = { loaded: true };
        break;
      }

      case 'exec': {
        const { args } = payload as { args: string[] };
        await execFFmpeg(args);
        result = { executed: true };
        break;
      }

      case 'writeFile': {
        const { path, data } = payload as { path: string; data: Uint8Array };
        await writeFile(path, data);
        result = { written: true };
        break;
      }

      case 'readFile': {
        const { path } = payload as { path: string };
        const data = await readFile(path);
        result = { data };
        break;
      }

      case 'deleteFile': {
        const { path } = payload as { path: string };
        await deleteFile(path);
        result = { deleted: true };
        break;
      }

      case 'createDir': {
        const { path } = payload as { path: string };
        await createDir(path);
        result = { created: true };
        break;
      }

      case 'deleteDir': {
        const { path } = payload as { path: string };
        await deleteDir(path);
        result = { deleted: true };
        break;
      }

      case 'listDir': {
        const { path } = payload as { path: string };
        const entries = await listDir(path);
        result = { entries };
        break;
      }

      case 'terminate': {
        terminate();
        result = { terminated: true };
        break;
      }

      default:
        throw new Error(`未知的消息类型: ${type}`);
    }

    sendResponse({ id, success: true, data: result });
  } catch (error) {
    sendResponse({
      id,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};

// 通知主线程 Worker 已准备好
self.postMessage({ type: 'ready' });
