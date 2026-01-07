/**
 * 默认 HTML 动画模板
 * 展示如何使用 CSS 变量 --t 控制动画
 */

export const DEFAULT_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    /* 背景必须透明 */
    html, body {
      background: transparent !important;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /*
     * 使用 CSS 变量 --t 控制动画
     * --t 的值范围是 0 到 1，表示动画进度
     *
     * 确定性模式下，系统会自动设置 --t 的值
     * 实时模式下，需要用 @keyframes 或 JS 动画
     */
    .circle {
      width: 200px;
      height: 200px;
      border-radius: 50%;
      background: linear-gradient(
        135deg,
        rgba(99, 102, 241, 0.9),
        rgba(168, 85, 247, 0.9)
      );
      box-shadow:
        0 0 60px rgba(99, 102, 241, 0.5),
        0 0 100px rgba(168, 85, 247, 0.3);

      /* 使用 --t 控制旋转和缩放 */
      transform:
        rotate(calc(var(--t, 0) * 720deg))
        scale(calc(0.5 + var(--t, 0) * 0.5));

      /* 使用 --t 控制透明度 */
      opacity: calc(0.3 + var(--t, 0) * 0.7);
    }

    .text {
      position: absolute;
      bottom: 20%;
      color: white;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      font-size: 24px;
      font-weight: bold;
      text-shadow: 0 2px 10px rgba(0, 0, 0, 0.5);

      /* 使用 --t 控制文字位置 */
      transform: translateY(calc((1 - var(--t, 0)) * 50px));
      opacity: var(--t, 0);
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="circle"></div>
    <div class="text">Hello Alpha Video!</div>
  </div>
</body>
</html>`;

/**
 * 实时模式示例模板
 * 使用 CSS @keyframes 动画
 */
export const REALTIME_HTML_TEMPLATE = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    html, body {
      background: transparent !important;
      width: 100%;
      height: 100%;
      overflow: hidden;
    }

    .container {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    /* 使用 @keyframes 动画（实时模式） */
    @keyframes pulse {
      0%, 100% {
        transform: scale(1);
        opacity: 0.8;
      }
      50% {
        transform: scale(1.2);
        opacity: 1;
      }
    }

    @keyframes rotate {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    .ring {
      width: 150px;
      height: 150px;
      border: 8px solid transparent;
      border-top-color: #6366f1;
      border-right-color: #a855f7;
      border-radius: 50%;
      animation: rotate 2s linear infinite;
    }

    .inner-circle {
      position: absolute;
      width: 80px;
      height: 80px;
      background: linear-gradient(135deg, #6366f1, #a855f7);
      border-radius: 50%;
      animation: pulse 1.5s ease-in-out infinite;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="ring"></div>
    <div class="inner-circle"></div>
  </div>
</body>
</html>`;

/**
 * 示例模板：毛玻璃卡片 + 进度条（偏真实 UI）
 *
 * 注意：
 * - 该模板使用 CSS Animation（@keyframes），不依赖 --t
 * - 系统会在“确定性导出”时同步 CSS Animation 到时间点（避免导出时全透明/不动）
 */
export const GLASS_CARD_STATS_TEMPLATE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <style>
        /* 基础设置：透明底，居中 */
        body { margin: 0; padding: 0; background: transparent; height: 100vh; display: flex; align-items: center; justify-content: center; font-family: "PingFang SC", "Microsoft YaHei", sans-serif; overflow: hidden; }

        /* 卡片容器：毛玻璃效果 */
        .card {
            width: 400px;
            background: rgba(255, 255, 255, 0.65);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 20px;
            padding: 30px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
            border: 1px solid rgba(255, 255, 255, 0.4);
            /* 进场动画：从下往上弹入 */
            animation: slideUp 0.8s cubic-bezier(0.16, 1, 0.3, 1) forwards;
            opacity: 0;
            transform: translateY(50px);
        }

        .title { font-size: 24px; font-weight: 800; color: #333; margin-bottom: 25px; display: flex; align-items: center; }
        .title::before { content: ''; width: 6px; height: 24px; background: #007aff; border-radius: 3px; margin-right: 12px; }

        /* 列表项布局 */
        .item { margin-bottom: 20px; position: relative; }
        .item-header { display: flex; justify-content: space-between; align-items: flex-end; margin-bottom: 8px; }
        .label { font-size: 16px; color: #555; font-weight: 600; }
        .amount { font-size: 20px; font-weight: 900; color: #000; }

        /* 单位小字 */
        .unit { font-size: 14px; font-weight: normal; color: #666; }

        /* 进度条背景 */
        .progress-bg { height: 10px; background: rgba(0,0,0,0.05); border-radius: 5px; overflow: hidden; }

        /* 进度条前景 */
        .progress-bar { height: 100%; border-radius: 5px; width: 0; animation: fillBar 1.5s cubic-bezier(0.22, 1, 0.36, 1) forwards; animation-delay: 0.5s; }

        /* 颜色定义 */
        .c-low { background: linear-gradient(90deg, #34c759, #30d158); } /* 螺蛳粉 */
        .c-mid { background: linear-gradient(90deg, #ff9500, #ffba00); } /* 鱼头 */
        .c-high { background: linear-gradient(90deg, #ff3b30, #ff453a); } /* 鸭脚煲 */

        /* 动画关键帧 */
        @keyframes slideUp { 100% { opacity: 1; transform: translateY(0); } }
        @keyframes fillBar { from { width: 0; } }
    </style>
</head>
<body>
    <div class="card">
        <div class="title">工业补助统计</div>

        <!-- 螺蛳粉 -->
        <div class="item">
            <div class="item-header">
                <span class="label">螺蛳粉补助</span>
                <span class="amount">33 <span class="unit">万</span></span>
            </div>
            <div class="progress-bg">
                <style>.bar1 { width: 33%; }</style>
                <div class="progress-bar c-low bar1"></div>
            </div>
        </div>

        <!-- 剁椒鱼头 -->
        <div class="item">
            <div class="item-header">
                <span class="label">剁椒鱼头补助</span>
                <span class="amount">60 <span class="unit">万</span></span>
            </div>
            <div class="progress-bg">
                <style>.bar2 { width: 60%; }</style>
                <div class="progress-bar c-mid bar2"></div>
            </div>
        </div>

        <!-- 螺丝鸭脚煲 -->
        <div class="item">
            <div class="item-header">
                <span class="label">螺丝鸭脚煲补助</span>
                <span class="amount">100 <span class="unit">万</span></span>
            </div>
            <div class="progress-bg">
                <style>.bar3 { width: 100%; }</style>
                <div class="progress-bar c-high bar3"></div>
            </div>
        </div>
    </div>
</body>
</html>`;
