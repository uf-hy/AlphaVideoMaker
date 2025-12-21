/**
 * 环境检测模块
 * 检测浏览器环境是否满足 FFmpeg.wasm 运行要求
 */

import type { EnvironmentInfo } from '@/core/types';

/**
 * 检测当前浏览器环境
 */
export function detectEnvironment(): EnvironmentInfo {
  const warnings: string[] = [];

  // 检测 crossOriginIsolated (COOP/COEP)
  const crossOriginIsolated = globalThis.crossOriginIsolated === true;

  // 检测 SharedArrayBuffer
  const hasSharedArrayBuffer = typeof SharedArrayBuffer !== 'undefined';

  // 检测 Web Worker
  const hasWorker = typeof Worker !== 'undefined';

  // 检测 WebAssembly
  const hasWasm =
    typeof WebAssembly !== 'undefined' &&
    typeof WebAssembly.instantiate === 'function';

  // 检测 Chromium 内核
  const isChromium = detectChromium();

  // 多线程支持需要 crossOriginIsolated + SharedArrayBuffer
  const canUseMultiThread = crossOriginIsolated && hasSharedArrayBuffer;

  // 生成警告信息
  if (!crossOriginIsolated) {
    warnings.push(
      '当前环境未启用跨源隔离（COOP/COEP），将降级为单线程编码，速度可能非常慢。'
    );
  }

  if (!isChromium) {
    warnings.push(
      '当前浏览器可能不是 Chromium 内核（Chrome/Edge），部分功能可能不稳定。'
    );
  }

  if (!hasWasm) {
    warnings.push('当前浏览器不支持 WebAssembly，无法运行 FFmpeg 编码。');
  }

  if (!hasWorker) {
    warnings.push('当前浏览器不支持 Web Worker，可能导致 UI 卡顿。');
  }

  return {
    canUseMultiThread,
    isChromium,
    hasSharedArrayBuffer,
    hasWorker,
    hasWasm,
    warnings,
  };
}

/**
 * 检测是否为 Chromium 内核浏览器
 */
function detectChromium(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const ua = navigator.userAgent;

  // Chrome、Edge、Opera、Brave 等都基于 Chromium
  const isChrome = /Chrome\/\d+/.test(ua) && !/Edg\//.test(ua);
  const isEdge = /Edg\/\d+/.test(ua);
  const isOpera = /OPR\/\d+/.test(ua);

  // 排除 Safari (WebKit 但非 Chromium)
  const isSafari = /Safari\/\d+/.test(ua) && !/Chrome\//.test(ua);

  return (isChrome || isEdge || isOpera) && !isSafari;
}

/**
 * 检测是否可以导出视频
 * @returns 如果环境满足最低要求返回 true
 */
export function canExport(): boolean {
  const env = detectEnvironment();
  return env.hasWasm && env.hasWorker;
}

/**
 * 获取环境检测的简要描述
 */
export function getEnvironmentSummary(): string {
  const env = detectEnvironment();

  const status = [];

  if (env.canUseMultiThread) {
    status.push('✅ 多线程模式');
  } else {
    status.push('⚠️ 单线程模式（较慢）');
  }

  if (env.isChromium) {
    status.push('✅ Chromium 内核');
  } else {
    status.push('⚠️ 非 Chromium 内核');
  }

  return status.join(' | ');
}
