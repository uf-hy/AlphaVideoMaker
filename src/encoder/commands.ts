/**
 * FFmpeg 命令生成器
 * 生成用于编码的 FFmpeg 命令参数
 */

import type { CodecType, FpsOption } from '@/core/types';

/**
 * 编码器配置
 */
interface EncoderConfig {
  /** FFmpeg 编码器名称 */
  encoder: string;
  /** 像素格式 */
  pixFmt: string;
  /** 额外参数 */
  extraArgs: string[];
}

/**
 * 编码器配置映射
 */
const ENCODER_CONFIGS: Record<CodecType, EncoderConfig> = {
  qtrle: {
    encoder: 'qtrle',
    pixFmt: 'argb', // qtrle 使用 argb 格式以支持 alpha
    // 添加单线程和进度输出参数，避免 WASM 环境下卡死
    extraArgs: ['-threads', '1'],
  },
  prores_4444: {
    encoder: 'prores_ks',
    pixFmt: 'yuva444p10le',
    extraArgs: ['-profile:v', '4444', '-vendor', 'apl0', '-threads', '1'],
  },
};

/**
 * 生成单个分段的编码命令
 * @param chunkDir 分段目录路径
 * @param outputPath 输出文件路径
 * @param fps 帧率
 * @param codec 编码格式
 */
export function buildChunkEncodeCommand(
  chunkDir: string,
  outputPath: string,
  fps: FpsOption,
  codec: CodecType
): string[] {
  const config = ENCODER_CONFIGS[codec];

  const args = [
    // 输入参数
    '-framerate',
    fps.toString(),
    '-f',
    'image2',
    '-i',
    `${chunkDir}/frame_%04d.png`,
    // 编码参数
    '-c:v',
    config.encoder,
    '-pix_fmt',
    config.pixFmt,
    // 额外参数
    ...config.extraArgs,
    // 进度输出（帮助调试）
    '-progress', 'pipe:1',
    '-stats_period', '0.5',
    // 输出
    '-y', // 覆盖输出文件
    outputPath,
  ];

  return args;
}

/**
 * 生成合并命令（使用 concat demuxer）
 * @param listFilePath concat 列表文件路径
 * @param outputPath 输出文件路径
 */
export function buildConcatCommand(
  listFilePath: string,
  outputPath: string
): string[] {
  return [
    '-f',
    'concat',
    '-safe',
    '0',
    '-i',
    listFilePath,
    '-c',
    'copy',
    '-y',
    outputPath,
  ];
}

/**
 * 生成 concat 列表文件内容
 * @param partPaths 分段文件路径数组
 */
export function generateConcatList(partPaths: string[]): string {
  return partPaths.map((path) => `file '${path}'`).join('\n');
}

/**
 * 生成帧文件名
 * @param frameIndex 帧索引（从 0 开始）
 */
export function getFrameFilename(frameIndex: number): string {
  return `frame_${frameIndex.toString().padStart(4, '0')}.png`;
}

/**
 * 生成分段目录名
 * @param chunkIndex 分段索引（从 0 开始）
 */
export function getChunkDirName(chunkIndex: number): string {
  return `chunk_${chunkIndex.toString().padStart(3, '0')}`;
}

/**
 * 生成分段输出文件名
 * @param chunkIndex 分段索引（从 0 开始）
 */
export function getPartFilename(chunkIndex: number): string {
  return `part_${chunkIndex.toString().padStart(3, '0')}.mov`;
}

/**
 * 获取编码器的显示名称
 */
export function getCodecDisplayName(codec: CodecType): string {
  const names: Record<CodecType, string> = {
    qtrle: 'Apple Animation (QTRLE)',
    prores_4444: 'Apple ProRes 4444',
  };
  return names[codec];
}

/**
 * 获取编码器的描述
 */
export function getCodecDescription(codec: CodecType): string {
  const descriptions: Record<CodecType, string> = {
    qtrle: '无损压缩，文件较大，兼容性最好',
    prores_4444: '专业级编码，高质量，文件适中',
  };
  return descriptions[codec];
}
