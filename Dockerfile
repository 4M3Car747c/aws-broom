# syntax=docker/dockerfile:1.7

# ---- 1. Build the SPA ----
FROM node:24-alpine AS web
RUN corepack enable
WORKDIR /web
COPY web/package.json web/pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY web/ .
RUN pnpm run build
# -> /web/build/client

# ---- 2. Build the Go binary with the SPA embedded ----
FROM golang:1.27-alpine AS build
# Release version shown in the UI ("About") and in `broom version`. CI passes
# the tag or "<branch>-<sha>"; a plain `docker build` (e.g. a PaaS building
# from the repository) leaves it empty and the build falls back to
# `git describe` over the checked-out .git directory.
ARG VERSION=
RUN apk add --no-cache git
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY . .
RUN rm -rf internal/web/dist && mkdir -p internal/web/dist
COPY --from=web /web/build/client/ internal/web/dist/
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    set -eu; \
    V="${VERSION}"; \
    if [ -z "$V" ] && [ -d .git ]; then \
      git config --global --add safe.directory /src; \
      V="$(git describe --tags --always --dirty 2>/dev/null || true)"; \
    fi; \
    [ -n "$V" ] || V=dev; \
    echo "building broom $V"; \
    CGO_ENABLED=0 go build -trimpath -buildvcs=false -ldflags="-s -w -X main.version=$V" -o /out/broom ./cmd/broom

# ---- 3. Minimal runtime ----
FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=build /out/broom /broom
ENV PORT=8080
EXPOSE 8080
# Distroless has no shell/curl; the binary answers its own health check.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["/broom", "healthcheck"]
ENTRYPOINT ["/broom"]
CMD ["serve"]
