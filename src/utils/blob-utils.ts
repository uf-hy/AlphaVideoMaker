/**
 * Blob 工具函数
 */

/**
 * 将 Canvas 转换为 PNG Blob
 * @param canvas HTML Canvas 元素
 * @returns PNG 格式的 Blob
 */
export function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error('Canvas toBlob 失败，可能是 tainted canvas'));
        }
      },
      'image/png',
      1.0
    );
  });
}

/**
 * 将 Blob 转换为 ArrayBuffer
 */
export function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return blob.arrayBuffer();
}

/**
 * 将 Blob 转换为 Uint8Array
 */
export async function blobToUint8Array(blob: Blob): Promise<Uint8Array> {
  const buffer = await blob.arrayBuffer();
  return new Uint8Array(buffer);
}

/**
 * 创建下载链接并触发下载
 * @param blob 要下载的 Blob
 * @param filename 文件名
 */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // 延迟释放 URL，确保下载已开始
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * 生成带时间戳的文件名
 * @param prefix 文件名前缀
 * @param extension 文件扩展名
 */
export function generateFilename(prefix: string, extension: string): string {
  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[-:]/g, '')
    .replace('T', '_')
    .slice(0, 15);
  return `${prefix}_${timestamp}.${extension}`;
}

/**
 * 格式化文件大小
 * @param bytes 字节数
 */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  if (bytes < 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
