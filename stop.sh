#!/bin/bash
# Alpha Video Maker 停止脚本

cd "$(dirname "$0")"

PID_FILE="./server.pid"
PORT=32103

if [ -f "$PID_FILE" ]; then
    PID=$(cat "$PID_FILE")
    if ps -p "$PID" > /dev/null 2>&1; then
        echo "🛑 停止服务 (PID: $PID)..."
        kill "$PID" 2>/dev/null

        # 等待进程结束
        for i in {1..10}; do
            if ! ps -p "$PID" > /dev/null 2>&1; then
                break
            fi
            sleep 0.5
        done

        # 如果还没结束，强制杀死
        if ps -p "$PID" > /dev/null 2>&1; then
            echo "⚠️  进程未响应，强制终止..."
            kill -9 "$PID" 2>/dev/null
        fi

        rm -f "$PID_FILE"
        echo "✅ 服务已停止"
    else
        echo "⚠️  PID 文件存在但进程不存在，清理中..."
        rm -f "$PID_FILE"
    fi
else
    # 尝试通过端口查找进程
    PID=$(ss -tlnp | grep ":$PORT " | grep -oP 'pid=\K\d+' | head -1)
    if [ -n "$PID" ]; then
        echo "🛑 通过端口找到进程 (PID: $PID)，停止中..."
        kill "$PID" 2>/dev/null
        sleep 1
        if ps -p "$PID" > /dev/null 2>&1; then
            kill -9 "$PID" 2>/dev/null
        fi
        echo "✅ 服务已停止"
    else
        echo "ℹ️  服务未在运行"
    fi
fi
