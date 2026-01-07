/**
 * 帧缓存模块
 * LRU 缓存 + 预渲染调度，用于预览时的帧缓存
 */

export interface FrameCacheOptions {
  maxFrames: number;
  previewFps: number;
  duration: number;
  onRenderFrame: (frameIndex: number) => Promise<ImageBitmap>;
}

export interface FrameCache {
  get(frameIndex: number): ImageBitmap | undefined;
  getOrRender(frameIndex: number): Promise<ImageBitmap>;
  prefetch(currentFrame: number, ahead: number): void;
  clear(): void;
  getCacheStats(): { cached: number; total: number };
  dispose(): void;
}

export function createFrameCache(options: FrameCacheOptions): FrameCache {
  const { maxFrames, previewFps, duration, onRenderFrame } = options;

  const totalFrames = Math.ceil(duration * previewFps);
  const cache = new Map<number, ImageBitmap>();
  const lruOrder: number[] = [];
  const pendingRenders = new Map<number, Promise<ImageBitmap>>();
  let prefetchQueue: number[] = [];
  let isPrefetching = false;
  let disposed = false;

  function touchLru(frameIndex: number): void {
    const idx = lruOrder.indexOf(frameIndex);
    if (idx !== -1) {
      lruOrder.splice(idx, 1);
    }
    lruOrder.push(frameIndex);
  }

  function evictIfNeeded(): void {
    while (cache.size > maxFrames && lruOrder.length > 0) {
      const oldest = lruOrder.shift();
      if (oldest !== undefined) {
        const bitmap = cache.get(oldest);
        if (bitmap) {
          bitmap.close();
        }
        cache.delete(oldest);
      }
    }
  }

  async function renderAndCache(frameIndex: number): Promise<ImageBitmap> {
    if (disposed) {
      throw new Error('FrameCache disposed');
    }

    const existing = pendingRenders.get(frameIndex);
    if (existing) {
      return existing;
    }

    const promise = onRenderFrame(frameIndex).then((bitmap) => {
      if (!disposed) {
        cache.set(frameIndex, bitmap);
        touchLru(frameIndex);
        evictIfNeeded();
      }
      pendingRenders.delete(frameIndex);
      return bitmap;
    }).catch((err) => {
      pendingRenders.delete(frameIndex);
      throw err;
    });

    pendingRenders.set(frameIndex, promise);
    return promise;
  }

  async function processPrefetchQueue(): Promise<void> {
    if (isPrefetching || disposed) return;
    isPrefetching = true;

    while (prefetchQueue.length > 0 && !disposed) {
      const frameIndex = prefetchQueue.shift();
      if (frameIndex === undefined) break;

      if (cache.has(frameIndex) || pendingRenders.has(frameIndex)) {
        continue;
      }

      try {
        await renderAndCache(frameIndex);
        // 让出主线程
        await new Promise((resolve) => setTimeout(resolve, 0));
      } catch {
        // 预取失败不阻塞
      }
    }

    isPrefetching = false;
  }

  return {
    get(frameIndex: number): ImageBitmap | undefined {
      const bitmap = cache.get(frameIndex);
      if (bitmap) {
        touchLru(frameIndex);
      }
      return bitmap;
    },

    async getOrRender(frameIndex: number): Promise<ImageBitmap> {
      const cached = cache.get(frameIndex);
      if (cached) {
        touchLru(frameIndex);
        return cached;
      }
      return renderAndCache(frameIndex);
    },

    prefetch(currentFrame: number, ahead: number): void {
      if (disposed) return;

      const framesToPrefetch: number[] = [];
      for (let i = 1; i <= ahead; i++) {
        const nextFrame = currentFrame + i;
        if (nextFrame < totalFrames && !cache.has(nextFrame) && !pendingRenders.has(nextFrame)) {
          framesToPrefetch.push(nextFrame);
        }
      }

      prefetchQueue = framesToPrefetch;

      if (typeof requestIdleCallback !== 'undefined') {
        requestIdleCallback(() => processPrefetchQueue());
      } else {
        setTimeout(() => processPrefetchQueue(), 16);
      }
    },

    clear(): void {
      for (const bitmap of cache.values()) {
        bitmap.close();
      }
      cache.clear();
      lruOrder.length = 0;
      prefetchQueue = [];
      pendingRenders.clear();
    },

    getCacheStats(): { cached: number; total: number } {
      return { cached: cache.size, total: totalFrames };
    },

    dispose(): void {
      disposed = true;
      this.clear();
    },
  };
}
