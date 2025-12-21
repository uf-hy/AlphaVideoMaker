#!/bin/bash
# Alpha Video Maker 启动脚本
# 端口: 32103 (CN Web前端 #03)

cd "$(dirname "$0")"

PORT=32103
LOG_FILE="./server.log"
PID_FILE="./server.pid"

# 检查是否已在运行
if [ -f "$PID_FILE" ]; then
    OLD_PID=$(cat "$PID_FILE")
    if ps -p "$OLD_PID" > /dev/null 2>&1; then
        echo "⚠️  服务已在运行 (PID: $OLD_PID, 端口: $PORT)"
        echo "   如需重启请先执行 ./stop.sh"
        exit 1
    else
        rm -f "$PID_FILE"
    fi
fi

# 检查端口是否被占用
if ss -tlnp | grep -q ":$PORT "; then
    echo "❌ 端口 $PORT 已被占用"
    ss -tlnp | grep ":$PORT "
    exit 1
fi

# 后台启动 Vite 开发服务器
echo "🚀 启动 Alpha Video Maker..."
echo "   端口: $PORT"
echo "   日志: $LOG_FILE"

nohup npm run dev -- --port $PORT --host 0.0.0.0 > "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# 等待启动
sleep 2

if ps -p $(cat "$PID_FILE") > /dev/null 2>&1; then
    echo "✅ 启动成功 (PID: $(cat $PID_FILE))"
    echo "   访问: http://localhost:$PORT"
else
    echo "❌ 启动失败，请查看日志: $LOG_FILE"
    rm -f "$PID_FILE"
    exit 1
fi
