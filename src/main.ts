/**
 * Alpha Video Maker
 * Canvas 动画透明视频导出组件
 *
 * @description 纯前端离线逐帧渲染，将 Canvas 动画导出为带 Alpha 通道的 MOV 视频
 * @author AlphaVideoMaker Team
 */

import './style.css';
import { createApp } from '@/ui';
import { createDefaultAnimation, DEMO_ANIMATIONS } from '@/demo';

/**
 * 应用初始化
 */
function init(): void {
  const appContainer = document.querySelector<HTMLDivElement>('#app');

  if (!appContainer) {
    console.error('找不到 #app 容器');
    return;
  }

  // 创建 Canvas
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    console.error('无法获取 Canvas 2D 上下文');
    appContainer.innerHTML = `
      <div style="text-align: center; padding: 50px; color: #ef4444;">
        <h1>错误</h1>
        <p>无法初始化 Canvas 2D 上下文，请检查浏览器兼容性。</p>
      </div>
    `;
    return;
  }

  // 创建默认动画
  const renderer = createDefaultAnimation(ctx);
  canvas.width = renderer.width;
  canvas.height = renderer.height;

  // 创建应用（传递 ctx 用于切换动画）
  const app = createApp(appContainer, canvas, renderer, ctx);

  // 开发环境下暴露到 window
  if (import.meta.env.DEV) {
    (window as unknown as { app: typeof app; DEMO_ANIMATIONS: typeof DEMO_ANIMATIONS }).app = app;
    (window as unknown as { DEMO_ANIMATIONS: typeof DEMO_ANIMATIONS }).DEMO_ANIMATIONS = DEMO_ANIMATIONS;
    console.log('Alpha Video Maker 已启动 (开发模式)');
    console.log('可用的示例动画:', DEMO_ANIMATIONS.map((d) => d.name).join(', '));
  }
}

// 启动应用
init();
