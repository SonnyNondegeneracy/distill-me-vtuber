#!/bin/bash
# 安全重启 distill-me-vtuber
# 不使用端口查杀，只杀自己的 node/vite 进程

cd "$(dirname "$0")"
APP_DIR="$(pwd)"

echo "App目录: $APP_DIR"

# 用 PID 文件追踪
PIDFILE="$APP_DIR/.app.pid"

# 停止旧进程：只杀 pidfile 记录的 concurrently 进程树
if [ -f "$PIDFILE" ]; then
  OLD_PID=$(cat "$PIDFILE")
  if kill -0 "$OLD_PID" 2>/dev/null; then
    echo "停止旧进程树 (PID: $OLD_PID)..."
    # kill 整个进程组
    kill -- -"$OLD_PID" 2>/dev/null || kill "$OLD_PID" 2>/dev/null
    sleep 2
    # 确认死了
    if kill -0 "$OLD_PID" 2>/dev/null; then
      kill -9 -- -"$OLD_PID" 2>/dev/null || kill -9 "$OLD_PID" 2>/dev/null
    fi
    echo "旧进程已停止"
  else
    echo "旧进程已不存在"
  fi
  rm -f "$PIDFILE"
fi

# 启动新进程，setsid 创建新进程组方便下次整组杀
echo "启动应用..."
setsid nohup npm run dev > app.log 2>&1 &
NEW_PID=$!
echo "$NEW_PID" > "$PIDFILE"

sleep 3
tail -n 8 app.log
echo ""
echo "✅ 重启完成 (PID: $NEW_PID)"
echo "   日志: tail -f $APP_DIR/app.log"
