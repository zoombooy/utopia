# ---- 前端构建 ----
FROM node:20-slim AS web
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
WORKDIR /src
RUN npm config set proxy "$HTTP_PROXY" \
    && npm config set https-proxy "$HTTPS_PROXY" \
    && npm config set strict-ssl false \
    && npm install --global pnpm@10.2.1 --registry=https://registry.npmmirror.com
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ ./
RUN pnpm build

# ---- 后端构建 ----
# 发行版必须和运行阶段钉死在同一个：rust:1-slim 会跟着上游滚（现已是 trixie/glibc 2.41），
# 编出的二进制便要求 GLIBC_2.38，而 bookworm 只有 2.36——镜像构建照样成功，
# 容器一启动就 "version `GLIBC_2.38' not found"。
FROM rust:1-slim-bookworm AS build
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY http_proxy=$http_proxy https_proxy=$https_proxy
WORKDIR /src
RUN apt-get update && apt-get install -y --no-install-recommends pkg-config && rm -rf /var/lib/apt/lists/*
COPY Cargo.toml Cargo.lock ./
COPY crates/ crates/
COPY migrations/ migrations/
# docs_corpus.rs 用 include_str! 把产品内文档编进二进制，所以它是后端的源码依赖，
# 不只是前端资源——漏掉这行，cargo build 直接报 couldn't read。
COPY web/src/docs/ web/src/docs/
RUN cargo build --release -p utopia-server

# ---- 运行 ----
FROM debian:bookworm-slim
ARG HTTP_PROXY
ARG HTTPS_PROXY
ARG http_proxy
ARG https_proxy
ENV HTTP_PROXY=$HTTP_PROXY HTTPS_PROXY=$HTTPS_PROXY http_proxy=$http_proxy https_proxy=$https_proxy
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates poppler-utils poppler-data && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/target/release/utopia-server /usr/local/bin/utopia-server
COPY --from=web /src/dist /app/web-dist
ENV UTOPIA_WEB_DIST=/app/web-dist
EXPOSE 1516
CMD ["utopia-server"]
