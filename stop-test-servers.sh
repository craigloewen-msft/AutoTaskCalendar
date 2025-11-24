#!/bin/bash
# Script to stop test servers

if [ -f /tmp/test-servers.pid ]; then
  read BACKEND_PID FRONTEND_PID < /tmp/test-servers.pid
  echo "Stopping backend (PID: $BACKEND_PID)"
  kill $BACKEND_PID 2>/dev/null || true
  echo "Stopping frontend (PID: $FRONTEND_PID)"
  kill $FRONTEND_PID 2>/dev/null || true
  rm /tmp/test-servers.pid
  echo "Servers stopped"
else
  echo "No PID file found, attempting to kill by process name"
  pkill -f "node app.js" || true
  pkill -f "vue-cli-service serve" || true
fi
