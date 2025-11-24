#!/bin/bash
# Script to start backend and frontend servers for testing

set -e

echo "Starting backend server..."
cd "$(dirname "$0")"
node app.js > /tmp/backend.log 2>&1 &
BACKEND_PID=$!
echo "Backend PID: $BACKEND_PID"

echo "Waiting for backend to start..."
for i in {1..30}; do
  if curl -s http://localhost:3000/ > /dev/null 2>&1; then
    echo "Backend is ready"
    break
  fi
  if [ $i -eq 30 ]; then
    echo "Backend failed to start"
    cat /tmp/backend.log
    exit 1
  fi
  sleep 1
done

echo "Starting frontend server..."
cd webinterface
npm run serve -- --port 8080 > /tmp/frontend.log 2>&1 &
FRONTEND_PID=$!
echo "Frontend PID: $FRONTEND_PID"

echo "Waiting for frontend to start..."
for i in {1..60}; do
  if curl -s http://localhost:8080/ > /dev/null 2>&1; then
    echo "Frontend is ready"
    break
  fi
  if [ $i -eq 60 ]; then
    echo "Frontend failed to start"
    cat /tmp/frontend.log
    exit 1
  fi
  sleep 1
done

echo "Both servers are running"
echo "Backend PID: $BACKEND_PID"
echo "Frontend PID: $FRONTEND_PID"
echo "$BACKEND_PID $FRONTEND_PID" > /tmp/test-servers.pid
