# Multi-stage: build SPA, then serve via FastAPI
FROM node:20.19.5-alpine AS frontend
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json* ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

FROM python:3.12.12-slim AS runtime
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORTAL_DATA_DIR=/data \
    PORTAL_STATIC_DIR=/app/static \
    PORTAL_PROBE_BASE=https://rep.local.inion \
    PORTAL_CA_FILE=/etc/portal/ca.crt

RUN apt-get update && apt-get install -y --no-install-recommends curl \
  && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY backend/*.py ./
COPY --from=frontend /web/dist /app/static

RUN mkdir -p /data
VOLUME ["/data"]

EXPOSE 3000
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "3000"]
