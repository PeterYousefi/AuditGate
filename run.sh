#!/usr/bin/env bash
set -e

# Activate virtual environment if present
if [ -d "venv" ]; then
    source venv/bin/activate
fi

echo "Starting AuditGate Governance Server on http://localhost:8000..."
uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload --reload-dir app
