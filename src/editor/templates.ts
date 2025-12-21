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
