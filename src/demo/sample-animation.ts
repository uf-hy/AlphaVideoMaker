/**
 * 示例动画
 * 符合 CanvasRenderer 接口的演示动画
 */

import type { CanvasRenderer } from '@/core/types';

/**
 * 示例 1: 旋转渐变方块
 * 测试 alpha 边缘渲染
 */
export class RotatingSquareAnimation implements CanvasRenderer {
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 5;

  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  renderAt(t: number): void {
    const { ctx, width, height } = this;

    // 清除画布（透明背景）
    ctx.clearRect(0, 0, width, height);

    // 计算旋转角度
    const angle = (t / this.duration) * Math.PI * 2;

    // 绘制旋转方块
    ctx.save();
    ctx.translate(width / 2, height / 2);
    ctx.rotate(angle);

    // 渐变填充
    const gradient = ctx.createLinearGradient(-150, -150, 150, 150);
    gradient.addColorStop(0, 'rgba(99, 102, 241, 0.9)'); // 紫色
    gradient.addColorStop(0.5, 'rgba(236, 72, 153, 0.8)'); // 粉色
    gradient.addColorStop(1, 'rgba(34, 211, 238, 0.9)'); // 青色

    ctx.fillStyle = gradient;
    ctx.fillRect(-150, -150, 300, 300);

    // 绘制边框
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.5)';
    ctx.lineWidth = 4;
    ctx.strokeRect(-150, -150, 300, 300);

    ctx.restore();

    // 绘制半透明圆形
    const circleX = width / 2 + Math.cos(angle * 2) * 200;
    const circleY = height / 2 + Math.sin(angle * 2) * 100;

    const circleGradient = ctx.createRadialGradient(
      circleX, circleY, 0,
      circleX, circleY, 80
    );
    circleGradient.addColorStop(0, 'rgba(250, 204, 21, 0.8)');
    circleGradient.addColorStop(1, 'rgba(250, 204, 21, 0)');

    ctx.fillStyle = circleGradient;
    ctx.beginPath();
    ctx.arc(circleX, circleY, 80, 0, Math.PI * 2);
    ctx.fill();
  }

  dispose(): void {
    // 清理资源
  }
}

/**
 * 示例 2: 弹跳小球
 * 测试关键帧运动
 */
export class BouncingBallAnimation implements CanvasRenderer {
  readonly width = 1080;
  readonly height = 1080;
  readonly duration = 3;

  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  renderAt(t: number): void {
    const { ctx, width, height, duration } = this;

    ctx.clearRect(0, 0, width, height);

    // 弹跳运动
    const progress = t / duration;
    const bounceHeight = height * 0.6;
    const bounceFreq = 3; // 3 次弹跳

    // 使用 sin 函数模拟弹跳
    const y = height - 100 - Math.abs(Math.sin(progress * Math.PI * bounceFreq)) * bounceHeight;

    // 水平移动
    const x = 100 + (width - 200) * progress;

    // 绘制阴影
    const shadowY = height - 50;
    const shadowScale = 1 - (height - 100 - y) / bounceHeight * 0.5;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.3)';
    ctx.beginPath();
    ctx.ellipse(x, shadowY, 60 * shadowScale, 20 * shadowScale, 0, 0, Math.PI * 2);
    ctx.fill();

    // 绘制小球
    const ballGradient = ctx.createRadialGradient(x - 20, y - 20, 0, x, y, 50);
    ballGradient.addColorStop(0, 'rgba(239, 68, 68, 1)');
    ballGradient.addColorStop(0.7, 'rgba(185, 28, 28, 1)');
    ballGradient.addColorStop(1, 'rgba(127, 29, 29, 1)');

    ctx.fillStyle = ballGradient;
    ctx.beginPath();
    ctx.arc(x, y, 50, 0, Math.PI * 2);
    ctx.fill();

    // 高光
    ctx.fillStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.beginPath();
    ctx.arc(x - 15, y - 15, 15, 0, Math.PI * 2);
    ctx.fill();
  }

  dispose(): void {
    // 清理资源
  }
}

/**
 * 示例 3: 文字淡入淡出
 * 测试细节渲染和半透明
 */
export class FadingTextAnimation implements CanvasRenderer {
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 4;

  private ctx: CanvasRenderingContext2D;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
  }

  renderAt(t: number): void {
    const { ctx, width, height, duration } = this;

    ctx.clearRect(0, 0, width, height);

    // 计算淡入淡出透明度
    const progress = t / duration;
    let alpha: number;

    if (progress < 0.3) {
      // 淡入
      alpha = progress / 0.3;
    } else if (progress < 0.7) {
      // 保持
      alpha = 1;
    } else {
      // 淡出
      alpha = (1 - progress) / 0.3;
    }

    // 绘制背景装饰（半透明）
    ctx.save();
    ctx.globalAlpha = alpha * 0.3;

    for (let i = 0; i < 5; i++) {
      const radius = 100 + i * 50;
      ctx.strokeStyle = `hsl(${i * 30 + t * 50}, 70%, 60%)`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(width / 2, height / 2, radius, 0, Math.PI * 2);
      ctx.stroke();
    }

    ctx.restore();

    // 绘制主文字
    ctx.save();
    ctx.globalAlpha = alpha;

    ctx.font = 'bold 120px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    // 文字渐变
    const textGradient = ctx.createLinearGradient(
      width / 2 - 300, 0,
      width / 2 + 300, 0
    );
    textGradient.addColorStop(0, '#6366f1');
    textGradient.addColorStop(0.5, '#ec4899');
    textGradient.addColorStop(1, '#06b6d4');

    ctx.fillStyle = textGradient;
    ctx.fillText('Alpha Video', width / 2, height / 2 - 60);

    // 副标题
    ctx.font = '400 48px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.fillStyle = `rgba(255, 255, 255, ${alpha * 0.8})`;
    ctx.fillText('Canvas 透明视频导出', width / 2, height / 2 + 60);

    ctx.restore();
  }

  dispose(): void {
    // 清理资源
  }
}

/**
 * 示例 4: 粒子系统
 * 测试复杂 alpha 混合
 */
export class ParticleAnimation implements CanvasRenderer {
  readonly width = 1920;
  readonly height = 1080;
  readonly duration = 5;

  private ctx: CanvasRenderingContext2D;
  private particles: Array<{
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    hue: number;
    life: number;
  }>;

  constructor(ctx: CanvasRenderingContext2D) {
    this.ctx = ctx;
    this.particles = [];

    // 预生成粒子
    for (let i = 0; i < 100; i++) {
      this.particles.push({
        x: Math.random() * this.width,
        y: Math.random() * this.height,
        vx: (Math.random() - 0.5) * 200,
        vy: (Math.random() - 0.5) * 200,
        size: Math.random() * 20 + 5,
        hue: Math.random() * 360,
        life: Math.random(),
      });
    }
  }

  renderAt(t: number): void {
    const { ctx, width, height, particles } = this;

    ctx.clearRect(0, 0, width, height);

    for (const p of particles) {
      // 根据时间计算粒子位置（确定性）
      const x = (p.x + p.vx * t) % width;
      const y = (p.y + p.vy * t) % height;

      // 计算透明度（脉冲效果）
      const pulse = Math.sin(t * 3 + p.life * Math.PI * 2) * 0.3 + 0.7;

      // 绘制粒子
      const gradient = ctx.createRadialGradient(x, y, 0, x, y, p.size);
      gradient.addColorStop(0, `hsla(${p.hue + t * 30}, 80%, 60%, ${pulse})`);
      gradient.addColorStop(1, `hsla(${p.hue + t * 30}, 80%, 60%, 0)`);

      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(
        x < 0 ? x + width : x,
        y < 0 ? y + height : y,
        p.size,
        0,
        Math.PI * 2
      );
      ctx.fill();
    }
  }

  dispose(): void {
    this.particles = [];
  }
}

/**
 * 创建默认示例动画
 */
export function createDefaultAnimation(
  ctx: CanvasRenderingContext2D
): CanvasRenderer {
  return new RotatingSquareAnimation(ctx);
}

/**
 * 可用的示例动画列表
 */
export const DEMO_ANIMATIONS = [
  { id: 'rotating-square', name: '旋转方块', factory: (ctx: CanvasRenderingContext2D) => new RotatingSquareAnimation(ctx) },
  { id: 'bouncing-ball', name: '弹跳小球', factory: (ctx: CanvasRenderingContext2D) => new BouncingBallAnimation(ctx) },
  { id: 'fading-text', name: '文字淡入淡出', factory: (ctx: CanvasRenderingContext2D) => new FadingTextAnimation(ctx) },
  { id: 'particles', name: '粒子系统', factory: (ctx: CanvasRenderingContext2D) => new ParticleAnimation(ctx) },
] as const;
