# v0.8.1-rc2

# Base node image
# 临时使用镜像代理前缀以解决 buildx 网络问题（buildx 不经过 Docker daemon 的镜像加速器）
# 如果网络正常，可以改回 node:20-alpine
FROM docker.m.daocloud.io/library/node:20-alpine AS node

# Install jemalloc
RUN apk add --no-cache jemalloc
RUN apk add --no-cache python3 py3-pip uv

# Set environment variable to use jemalloc
ENV LD_PRELOAD=/usr/lib/libjemalloc.so.2

# Add `uv` for extended MCP support
COPY --from=ghcr.io/astral-sh/uv:0.6.13 /uv /uvx /bin/
RUN uv --version

RUN mkdir -p /app && chown node:node /app
WORKDIR /app

USER node

COPY --chown=node:node package.json package-lock.json ./
COPY --chown=node:node api/package.json ./api/package.json
COPY --chown=node:node client/package.json ./client/package.json
COPY --chown=node:node packages/data-provider/package.json ./packages/data-provider/package.json
COPY --chown=node:node packages/data-schemas/package.json ./packages/data-schemas/package.json
COPY --chown=node:node packages/api/package.json ./packages/api/package.json

RUN \
    # Allow mounting of these files, which have no default
    touch .env ; \
    # Create directories for the volumes to inherit the correct permissions
    mkdir -p /app/client/public/images /app/api/logs /app/uploads ; \
    npm config set fetch-retry-maxtimeout 600000 ; \
    npm config set fetch-retries 5 ; \
    npm config set fetch-retry-mintimeout 15000

# Copy and build agents-Aipyq before installing dependencies
COPY --chown=node:node agents-Aipyq/package.json ./agents-Aipyq/package.json
COPY --chown=node:node agents-Aipyq/tsconfig*.json ./agents-Aipyq/
COPY --chown=node:node agents-Aipyq/rollup.config.js ./agents-Aipyq/
COPY --chown=node:node agents-Aipyq/husky-setup.js ./agents-Aipyq/husky-setup.js
COPY --chown=node:node agents-Aipyq/src ./agents-Aipyq/src

ENV HUSKY=0
ENV CI=true

# 若已在源码中包含 agents-Aipyq/dist，可直接复制到镜像中以跳过构建
COPY --chown=node:node agents-Aipyq/dist ./agents-Aipyq/dist

RUN \
    cd agents-Aipyq && \
    # 如果 dist 不存在或为空，则安装依赖并构建
    if [ ! -d "dist" ] || [ -z "$(ls -A dist 2>/dev/null)" ]; then \
      echo "Building agents-Aipyq (dist not found)..."; \
      npm install --no-audit --omit=dev && \
      DISABLE_SOURCEMAP=true NODE_OPTIONS="--max-old-space-size=8192" npm run build; \
    else \
      echo "Using existing dist directory, installing dependencies only..."; \
      npm install --no-audit --omit=dev; \
    fi

# Now install all dependencies including the local agents-Aipyq package
RUN npm ci --no-audit

COPY --chown=node:node . .

# Build packages separately with increased memory limit
ENV NODE_OPTIONS="--max-old-space-size=8192"

RUN \
    # Build data-provider first
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:data-provider || (echo "Failed to build data-provider" && exit 1) && \
    # Build data-schemas
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:data-schemas || (echo "Failed to build data-schemas" && exit 1) && \
    # Build api package with extra memory
    NODE_OPTIONS="--max-old-space-size=8192" npm run build:api || (echo "Failed to build api" && exit 1) && \
    # Verify api dist exists
    test -f packages/api/dist/index.js || (echo "packages/api/dist/index.js not found" && exit 1) && \
    # Build client-package
    NODE_OPTIONS="--max-old-space-size=4096" npm run build:client-package || (echo "Failed to build client-package" && exit 1) && \
    # Build client
    cd client && NODE_OPTIONS="--max-old-space-size=4096" npm run build || (echo "Failed to build client" && exit 1) && \
    cd .. && \
    # Prune and clean
    npm prune --production && \
    # 某些构建产物需要 mongodb 运行时依赖（可能未列为 prod dep），显式安装
    npm install mongodb --omit=dev && \
    npm cache clean --force && \
    # 兼容大小写导入：@Aipyq/* -> @aipyq/*
    ln -s /app/node_modules/@aipyq /app/node_modules/@Aipyq || true

# Node API setup
EXPOSE 3080
ENV HOST=0.0.0.0
CMD ["npm", "run", "backend"]

# Optional: for client with nginx routing
# FROM nginx:stable-alpine AS nginx-client
# WORKDIR /usr/share/nginx/html
# COPY --from=node /app/client/dist /usr/share/nginx/html
# COPY client/nginx.conf /etc/nginx/conf.d/default.conf
# ENTRYPOINT ["nginx", "-g", "daemon off;"]
