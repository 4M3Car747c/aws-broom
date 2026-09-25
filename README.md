# AWS Broom

[中文](#中文) · [English](#english)

Free, open-source web tool that wipes a PoC / sandbox AWS account. Paste temporary credentials, pick regions and services, scan, review every resource, then delete only what you confirmed. Deletion is performed by [Gruntwork's cloud-nuke](https://github.com/gruntwork-io/cloud-nuke), embedded as a library.

- Docs: [Security notes](docs/security.md) · [IAM policy](docs/iam-policy.md) · [Design system](docs/design-system.md)
- Image: `ghcr.io/4m3car747c/aws-broom`
- License: MIT

---

## 中文

### 它做什么

1. **连接**：在浏览器里粘贴 Access Key / Secret / Session Token。服务端用 `sts:GetCallerIdentity` 校验，凭证只存在于进程内存。
2. **选区域和服务**：地图上勾选已启用的区域；服务按分组列出，IAM / KMS / CloudFront 等高风险组默认关闭。
3. **扫描**：只读列出所有匹配资源，实时流式展示。
4. **复核**：逐条确认要删除的资源，手动输入 12 位账号 ID。
5. **清理**：服务端重新扫描一次，只删除"重扫结果 ∩ 你确认的清单"。已消失的资源标为 `already_gone`。

历史记录只保存在浏览器的 IndexedDB 中。请只在你打算清空的账号上使用。

### 快速开始

```sh
docker run -d --name broom -p 127.0.0.1:8080:8080 \
  ghcr.io/4m3car747c/aws-broom:main
```

打开 http://127.0.0.1:8080 。环境变量与反向代理建议见 [docs/security.md](docs/security.md#自托管)。

### 本地开发

需要 Go 1.26+、Node 24、pnpm 10+。

```sh
make dev          # Go API :8080 + Vite :5173（代理 /api）
make test         # go test + 前端 typecheck
make web build    # 构建 SPA 并嵌入到单个二进制 bin/broom
go run ./tools/mockserve -static web/build/client   # 无需 AWS 账号的假后端
```

### 结构

| 目录 | 内容 |
|---|---|
| `cmd/broom` | 入口：`serve`（HTTP）、`worker`（每个任务一个子进程）、`healthcheck` |
| `internal/api` | HTTP API、会话 Cookie、CSRF/限速/压缩中间件、SSE |
| `internal/session` | 内存会话与凭证生命周期 |
| `internal/jobs` | 任务登记、worker 子进程监督、事件聚合 |
| `internal/engine` | 唯一引用 cloud-nuke 的包：扫描、按确认清单删除 |
| `internal/catalog` | cloud-nuke 资源类型到服务分组、风险等级的映射 |
| `internal/web` | 嵌入的 SPA 与 CSP |
| `web/` | React Router 8 SPA（shadcn / Base UI / Tailwind 4，中英双语） |
| `docs/iam` | 由 `tools/iampolicy` 从 cloud-nuke 源码生成的 IAM 策略 |

### 安全

详见 [docs/security.md](docs/security.md)。漏洞请通过 GitHub 私密漏洞报告提交。

---

## English

### What it does

1. **Connect**: paste an access key, secret and session token in the browser. The server validates them with `sts:GetCallerIdentity` and keeps them in process memory only.
2. **Pick regions and services**: enabled regions on a map; services in groups, with high-risk groups (IAM, KMS, CloudFront, …) off by default.
3. **Scan**: read-only listing of every matching resource, streamed live.
4. **Review**: confirm resources one by one and type the 12-digit account ID.
5. **Clean**: the server rescans and deletes only "rescan results ∩ your confirmed list". Resources that vanished are reported as `already_gone`.

History lives in the browser's IndexedDB. Use it only on accounts you intend to empty.

### Quick start

```sh
docker run -d --name broom -p 127.0.0.1:8080:8080 \
  ghcr.io/4m3car747c/aws-broom:main
```

Open http://127.0.0.1:8080. Environment variables and reverse-proxy advice are in [docs/security.md](docs/security.md#self-hosting).

### Development

Requires Go 1.26+, Node 24 and pnpm 10+.

```sh
make dev          # Go API on :8080 + Vite on :5173 (proxies /api)
make test         # go test + frontend typecheck
make web build    # build the SPA and embed it into the single binary bin/broom
go run ./tools/mockserve -static web/build/client   # fake backend, no AWS account needed
```

### Layout

| Path | Contents |
|---|---|
| `cmd/broom` | entry point: `serve` (HTTP), `worker` (one subprocess per job), `healthcheck` |
| `internal/api` | HTTP API, session cookie, CSRF / rate-limit / gzip middleware, SSE |
| `internal/session` | in-memory sessions and credential lifetime |
| `internal/jobs` | job registry, worker supervision, event aggregation |
| `internal/engine` | the only package importing cloud-nuke: scan, delete confirmed identifiers |
| `internal/catalog` | cloud-nuke resource types → service groups and risk levels |
| `internal/web` | embedded SPA and its Content Security Policy |
| `web/` | React Router 8 SPA (shadcn / Base UI / Tailwind 4, zh-CN + en) |
| `docs/iam` | IAM policies generated from the pinned cloud-nuke sources by `tools/iampolicy` |

### Security

See [docs/security.md](docs/security.md). Report vulnerabilities through GitHub's private vulnerability reporting.
