/**
 * 分段编码器
 * 实现 chunked encode 策略，防止 OOM
 */

import type { FFmpegBridge } from './ffmpeg-bridge';
import type { CodecType, FpsOption } from '@/core/types';
import {
  buildChunkEncodeCommand,
  buildConcatCommand,
  generateConcatList,
  getFrameFilename,
  getChunkDirName,
  getPartFilename,
} from './commands';

/**
 * 编码进度回调
 */
export interface ChunkEncodeProgress {
  /** 当前分段索引 */
  chunkIndex: number;
  /** 总分段数 */
  totalChunks: number;
  /** 当前阶段 */
  stage: 'writing' | 'encoding' | 'cleaning';
  /** 阶段内进度 (0-1) */
  stageProgress: number;
}

export type ChunkEncodeProgressCallback = (progress: ChunkEncodeProgress) => void;

/**
 * 分段编码器类
 */
export class ChunkedEncoder {
  private ffmpeg: FFmpegBridge;
  private fps: FpsOption;
  private codec: CodecType;
  private partPaths: string[] = [];
  private cancelled = false;

  constructor(ffmpeg: FFmpegBridge, fps: FpsOption, codec: CodecType) {
    this.ffmpeg = ffmpeg;
    this.fps = fps;
    this.codec = codec;
  }

  /**
   * 编码单个分段
   * @param chunkIndex 分段索引
   * @param frames 帧数据数组 (Uint8Array)
   * @param onProgress 进度回调
   */
  async encodeChunk(
    chunkIndex: number,
    frames: Uint8Array[],
    totalChunks: number,
    onProgress?: ChunkEncodeProgressCallback
  ): Promise<string> {
    if (this.cancelled) {
      throw new Error('编码已取消');
    }

    const chunkDir = getChunkDirName(chunkIndex);
    const partPath = getPartFilename(chunkIndex);

    try {
      // 1. 创建分段目录
      await this.ffmpeg.createDir(chunkDir);

      // 2. 写入帧文件
      for (let i = 0; i < frames.length; i++) {
        if (this.cancelled) {
          throw new Error('编码已取消');
        }

        const frame = frames[i];
        if (!frame) {
          throw new Error(`帧数据为空: index=${i}`);
        }

        const framePath = `${chunkDir}/${getFrameFilename(i)}`;
        await this.ffmpeg.writeFile(framePath, frame);

        onProgress?.({
          chunkIndex,
          totalChunks,
          stage: 'writing',
          stageProgress: (i + 1) / frames.length,
        });
      }

      // 3. 执行编码
      onProgress?.({
        chunkIndex,
        totalChunks,
        stage: 'encoding',
        stageProgress: 0,
      });

      const args = buildChunkEncodeCommand(chunkDir, partPath, this.fps, this.codec);
      await this.ffmpeg.exec(args);

      onProgress?.({
        chunkIndex,
        totalChunks,
        stage: 'encoding',
        stageProgress: 1,
      });

      // 4. 清理帧文件
      onProgress?.({
        chunkIndex,
        totalChunks,
        stage: 'cleaning',
        stageProgress: 0,
      });

      for (let i = 0; i < frames.length; i++) {
        const framePath = `${chunkDir}/${getFrameFilename(i)}`;
        try {
          await this.ffmpeg.deleteFile(framePath);
        } catch {
          // 忽略删除错误
        }
      }

      // 删除分段目录
      try {
        await this.ffmpeg.deleteDir(chunkDir);
      } catch {
        // 忽略删除错误
      }

      onProgress?.({
        chunkIndex,
        totalChunks,
        stage: 'cleaning',
        stageProgress: 1,
      });

      // 记录分段路径
      this.partPaths.push(partPath);

      return partPath;
    } catch (error) {
      // 清理失败时的残留文件
      await this.cleanupChunk(chunkDir, frames.length);
      throw error;
    }
  }

  /**
   * 合并所有分段
   */
  async mergeChunks(): Promise<Uint8Array> {
    if (this.cancelled) {
      throw new Error('编码已取消');
    }

    if (this.partPaths.length === 0) {
      throw new Error('没有分段可合并');
    }

    // 如果只有一个分段，直接返回
    if (this.partPaths.length === 1) {
      const partPath = this.partPaths[0];
      if (!partPath) {
        throw new Error('分段路径为空');
      }
      const data = await this.ffmpeg.readFile(partPath);
      await this.cleanup();
      return data;
    }

    const listPath = 'concat_list.txt';
    const outputPath = 'output.mov';

    try {
      // 1. 生成 concat 列表
      const listContent = generateConcatList(this.partPaths);
      await this.ffmpeg.writeFile(listPath, new TextEncoder().encode(listContent));

      // 2. 执行合并
      const args = buildConcatCommand(listPath, outputPath);
      await this.ffmpeg.exec(args);

      // 3. 读取输出文件
      const data = await this.ffmpeg.readFile(outputPath);

      // 4. 清理
      await this.cleanup();

      return data;
    } catch (error) {
      await this.cleanup();
      throw error;
    }
  }

  /**
   * 清理单个分段的残留文件
   */
  private async cleanupChunk(chunkDir: string, frameCount: number): Promise<void> {
    for (let i = 0; i < frameCount; i++) {
      try {
        await this.ffmpeg.deleteFile(`${chunkDir}/${getFrameFilename(i)}`);
      } catch {
        // 忽略
      }
    }
    try {
      await this.ffmpeg.deleteDir(chunkDir);
    } catch {
      // 忽略
    }
  }

  /**
   * 清理所有临时文件
   */
  async cleanup(): Promise<void> {
    // 清理分段文件
    for (const partPath of this.partPaths) {
      try {
        await this.ffmpeg.deleteFile(partPath);
      } catch {
        // 忽略
      }
    }

    // 清理 concat 列表和输出文件
    const filesToDelete = ['concat_list.txt', 'output.mov'];
    for (const file of filesToDelete) {
      try {
        await this.ffmpeg.deleteFile(file);
      } catch {
        // 忽略
      }
    }

    this.partPaths = [];
  }

  /**
   * 取消编码
   */
  cancel(): void {
    this.cancelled = true;
  }

  /**
   * 重置状态
   */
  reset(): void {
    this.cancelled = false;
    this.partPaths = [];
  }
}

/**
 * 创建分段编码器
 */
export function createChunkedEncoder(
  ffmpeg: FFmpegBridge,
  fps: FpsOption,
  codec: CodecType
): ChunkedEncoder {
  return new ChunkedEncoder(ffmpeg, fps, codec);
}
