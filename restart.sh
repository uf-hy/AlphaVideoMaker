#!/bin/bash
# Alpha Video Maker 重启脚本

cd "$(dirname "$0")"

echo "🔄 重启 Alpha Video Maker..."
echo ""

# 先停止
./stop.sh

# 等待一下确保端口释放
sleep 1

# 再启动
./start.sh
