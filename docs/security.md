# 安全说明 · Security notes

[中文](#中文) · [English](#english)

---

## 中文

### 定位与前提

AWS Broom 是一个免费、开源、**匿名使用**的工具，用途只有一个：把 PoC / 沙箱账号里的资源清空。请不要把它用在生产账号或任何你不打算清空的账号上。

你粘贴到页面的凭证会到达运行本服务的服务器进程内存中。**谁运营这台服务器，谁在技术上就能读到你的凭证。** 如果你不信任托管实例，请[自托管](#自托管)，或者至少只使用一小时有效的 STS 临时凭证（见 [IAM 策略](iam-policy.md)）。

### 凭证的处理方式

- **传输**：浏览器通过 HTTPS 把 Access Key / Secret / Session Token 一次性提交到 `POST /api/sessions`。服务端用 `sts:GetCallerIdentity` 校验后建立会话，把账号 ID 与 ARN 回显给你。
- **存放**：只在服务端进程内存中。不写数据库、不写磁盘、不写日志。日志里只有账号 ID、任务数量、以及登录失败时的来源 IP 与去掉请求 ID 的错误摘要。
- **会话**：会话 ID 是 32 字节随机数，通过 `HttpOnly`、`SameSite=Strict`、HTTPS 下 `Secure` 的 Cookie 下发，浏览器脚本读不到，响应体里也不回显。命令行客户端在请求上带 `X-Broom-Token: 1` 头即可在 JSON 里拿到 `sessionId`，之后用 `Authorization: Bearer` 调用接口。
- **传给 worker**：每次扫描 / 清理都在独立的 `broom worker` 子进程里运行。凭证只通过子进程的环境变量传递，不出现在命令行参数或任务参数中；子进程被设置为不读取 `~/.aws`（`HOME=/nonexistent`、`AWS_SDK_LOAD_CONFIG=0`）、不访问实例元数据服务（`AWS_EC2_METADATA_DISABLED=true`），服务端自身的 SDK 客户端同样禁用了 IMDS 回退，所以一把错的密钥绝不会退回到宿主机的角色。
- **生命周期**：以下任一情况会立即丢弃凭证并终止该会话正在运行的 worker：点击"退出登录"、空闲超过 60 分钟（`SESSION_IDLE_TTL`，有扫描 / 清理任务在运行时不计空闲）、会话满 12 小时（`SESSION_MAX_TTL`）、服务重启或关闭。"丢弃"指进程不再持有任何引用；Go 的字符串不可变，实际内存由 GC 回收，无法保证立即覆写。STS 临时凭证到期后 AWS 自动失效，页面顶部会显示剩余分钟数。
- **用完之后**：建议主动作废。AssumeRole 的临时凭证可以在角色上设置"撤销活动会话"；`get-session-token` 得到的凭证随其 IAM 用户的 Access Key 一起停用即失效。

### 删除护栏

1. **二次确认账号 ID**：清理前必须手动输入 12 位账号 ID，服务端校验它与会话账号一致。
2. **只删确认过的 ID**：清理请求只能引用本会话某次**已成功完成**的扫描结果，每个条目都必须在扫描结果中且被标记为可删除；服务端会重新扫描一次，只删除"重扫结果 ∩ 你确认的清单"。Review 之后新出现的资源永远不会被删；已经不存在的资源记为 `already_gone`。
3. **当前身份受保护**：登录所用的 IAM 用户始终被排除在 IAM 清理之外。
4. **高风险默认不选**：IAM、KMS / Secrets / 安全服务、CloudFront / Route 53 在页面上标为高风险且默认不勾选。
5. **cloud-nuke 内置保护**：带 `cloud-nuke-excluded=true` 标签的资源被跳过；开启了终止保护（`disableApiTermination`）的 EC2 实例被跳过；默认 VPC、默认子网、名为 `default` 的安全组不会被列出或删除。
6. **扫描不改动账号**：默认扫描只读；只有勾选"仅清理 N 小时前创建的资源"时，cloud-nuke 才会给没有创建时间的资源写 `cloud-nuke-first-seen` 标签。
7. **顺序与重试**：各区域并行、全局服务（S3、IAM 等）最后串行；被依赖占用的资源（`DependencyViolation`）记为警告而非失败，稍后"再次扫描"即可清掉剩余项。
8. **不可逆项的提示**：KMS 密钥只是计划 7 天后删除，可用 `aws kms cancel-key-deletion` 撤销；Review 页在勾选 KMS 时会提醒这一点。启用 Object Lock 的 S3 桶无法被清空，会以失败告终，需要你自行处理。

### 服务端防护

- 登录接口按来源 IP 限速（默认每分钟 10 次，`RATE_LIMIT_PER_MIN`），减缓凭证撞库。只有当直连对端是私有 / 回环地址（即同机或同网络的反向代理）时才采信 `X-Forwarded-For`，并取其**最右侧**一项，客户端自己伪造的前置项不起作用。
- 所有写接口必须带自定义头 `X-Broom-Client`，浏览器无法跨站自动附加；服务不开放 CORS，所以跨站请求既过不了 CSRF 检查也拿不到响应。
- 请求体上限 4 MB，JSON 字段严格校验，未知字段直接拒绝；区域、资源类型、账号 ID 都用白名单 / 正则校验。
- 响应头：`X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`、`Permissions-Policy`，HTTPS 下加 `Strict-Transport-Security`，`/api/` 下一律 `Cache-Control: no-store`。页面带严格的 `Content-Security-Policy`：脚本只允许同源与按哈希放行的内联引导脚本，连接只允许同源，禁止被嵌入 iframe。
- 任务与会话绑定：跨会话查询任务一律 404；每个会话最多 2 个并发任务，整个实例最多 8 个（`MAX_JOBS`，超出返回 503）；单个任务超时 2 小时（`JOB_TIMEOUT`）；任务结果在服务端保留 2 小时（`JOB_RETENTION`）后从内存清除。
- 取消任务或会话结束时，worker 先收到 `SIGTERM`，5 秒后仍未退出则 `SIGKILL`。
- 不采集遥测：cloud-nuke 自带的遥测被禁用（`DISABLE_TELEMETRY=true`），前端也没有任何统计脚本。

### 浏览器端

- 服务端会话只存在于 Cookie；向导中的选择存在 `sessionStorage`，关闭标签页即消失。
- "历史"页的数据保存在浏览器的 IndexedDB 中（最多 50 条），包含账号 ID、区域、资源类型、资源 ID 与删除结果，**不包含任何凭证**。可以在历史页逐条删除，或清除站点数据。
- 凭证输入框关闭了自动填充；提交成功后表单会被清空。

### 自托管

镜像：`ghcr.io/4M3Car747c/aws-broom`（基于 distroless，非 root 运行，无 shell）。

```sh
docker run -d --name broom -p 127.0.0.1:8080:8080 \
  -e SESSION_IDLE_TTL=30m \
  ghcr.io/4M3Car747c/aws-broom:main
```

| 环境变量 | 默认值 | 说明 |
|---|---|---|
| `PORT` | `8080` | 监听端口 |
| `SESSION_IDLE_TTL` | `60m` | 会话空闲多久后清零凭证 |
| `SESSION_MAX_TTL` | `12h` | 会话最长存活时间 |
| `JOB_TIMEOUT` | `2h` | 单个扫描 / 清理任务的硬超时 |
| `JOB_RETENTION` | `2h` | 已完成任务在内存中保留的时间 |
| `RATE_LIMIT_PER_MIN` | `10` | 每 IP 每分钟允许的登录尝试次数 |
| `MAX_JOBS` | `8` | 整个实例同时运行的扫描 / 清理任务上限 |

建议：

- 放在终止 TLS 的反向代理之后，并让代理设置 `X-Forwarded-Proto: https`（触发 `Secure` Cookie 与 HSTS）与 `X-Forwarded-For`（限速按真实来源 IP 计；代理需以私有地址连到本服务）。服务自带 gzip，代理无需再压缩。
- 只运行 **一个副本**：会话与任务都在内存中，多副本之间不共享。
- 用代理的基本认证、IP 白名单或 VPN 限制谁能打开页面；工具本身没有用户体系。
- 不要给容器任何 AWS 角色或实例元数据访问权限，它不需要。

### 已知限制

- 服务本身没有登录机制：知道网址的任何人都能用**自己的**凭证使用它。它无法阻止有人粘贴不属于自己的凭证，责任在凭证持有者。
- 会话在内存中：服务重启会让所有会话与正在运行的任务失效（凭证也随之消失）。
- 清理是不可逆的，工具只能保证"只删你确认过的东西"，不能保证你确认得对。

### 报告安全问题

请通过 GitHub 的私密漏洞报告（仓库 **Security → Report a vulnerability**）联系，不要在公开 issue 中披露细节。

---

## English

### Scope and assumptions

AWS Broom is a free, open-source tool that anyone can use **anonymously**, for one purpose: wiping the resources in a PoC or sandbox account. Do not point it at a production account or at any account you do not intend to empty.

The credentials you paste reach the memory of the server process that runs this service. **Whoever operates that server can technically read them.** If you do not trust the hosted instance, [self-host](#self-hosting) or, at minimum, use one-hour STS temporary credentials only (see [IAM policy](iam-policy.md)).

### How credentials are handled

- **In transit**: the browser submits the access key, secret and session token once, over HTTPS, to `POST /api/sessions`. The server validates them with `sts:GetCallerIdentity`, creates a session and echoes the account ID and ARN back to you.
- **At rest**: in the server process memory only. No database, no disk, no logs. Logs contain the account ID, job counts and, for failed sign-ins, the source IP and an error summary with the request ID stripped.
- **Session**: the session ID is 32 random bytes, delivered as an `HttpOnly`, `SameSite=Strict` cookie that is `Secure` over HTTPS, so page scripts cannot read it, and it is not echoed in the response body. Command-line clients send an `X-Broom-Token: 1` header to receive `sessionId` in the JSON and then call the API with `Authorization: Bearer`.
- **Handoff to the worker**: every scan or cleanup runs in a separate `broom worker` subprocess. Credentials are passed only through that process's environment, never in command-line arguments or in the job spec. The worker cannot read `~/.aws` (`HOME=/nonexistent`, `AWS_SDK_LOAD_CONFIG=0`) and cannot reach the instance metadata service (`AWS_EC2_METADATA_DISABLED=true`); the server's own SDK client has the IMDS fallback disabled too, so a wrong key can never fall back to the host's role.
- **Lifetime**: any of the following drops the credentials immediately and kills the session's running workers: signing out, 60 minutes idle (`SESSION_IDLE_TTL`; a session with a scan or cleanup in flight is never idle), 12 hours since sign-in (`SESSION_MAX_TTL`), a server restart or shutdown. "Drops" means the process holds no reference any more; Go strings are immutable and the memory is reclaimed by the garbage collector, so an immediate overwrite cannot be guaranteed. STS temporary credentials expire on their own; the header shows the minutes left.
- **Afterwards**: revoke proactively. AssumeRole sessions can be invalidated with the role's "revoke active sessions" feature; `get-session-token` credentials die with the IAM user's access key when you deactivate it.

### Deletion guardrails

1. **Account ID confirmation**: before cleanup you type the 12-digit account ID by hand and the server checks it against the session's account.
2. **Only confirmed identifiers**: a cleanup request may only reference a **successfully finished** scan of the same session, and every entry must appear in that scan's results and be marked deletable. The server rescans and deletes only "rescan results ∩ your confirmed list". Resources that appeared after the review are never touched; resources already gone are reported as `already_gone`.
3. **Your identity is protected**: the IAM user you signed in with is always excluded from IAM cleanup.
4. **High-risk groups are off by default**: IAM, KMS / Secrets / security services, and CloudFront / Route 53 are flagged high-risk and unselected in the UI.
5. **cloud-nuke's built-in protection**: resources tagged `cloud-nuke-excluded=true` are skipped; EC2 instances with termination protection (`disableApiTermination`) are skipped; the default VPC, default subnets and security groups named `default` are never listed or deleted.
6. **Scans do not modify the account**: a scan is read-only. Only when "only resources older than N hours" is enabled does cloud-nuke write a `cloud-nuke-first-seen` tag on resources without a creation timestamp.
7. **Order and retries**: regions run in parallel and global services (S3, IAM, …) run last and sequentially. Resources still held by a dependency (`DependencyViolation`) are reported as warnings, not failures; "scan again" a little later removes what is left.
8. **Irreversible cases are flagged**: KMS keys are only scheduled for deletion in 7 days and can be restored with `aws kms cancel-key-deletion`; the Review page reminds you of this when KMS is selected. S3 buckets with Object Lock cannot be emptied and end up as failures you have to handle yourself.

### Server-side hardening

- Sign-in is rate-limited per source IP (10 per minute by default, `RATE_LIMIT_PER_MIN`) to slow down credential stuffing. `X-Forwarded-For` is honoured only when the direct peer is a private or loopback address (a reverse proxy on the same host or network), and only its **rightmost** entry is used, so values a client prepends itself have no effect.
- Every mutating request must carry the custom `X-Broom-Client` header, which a browser cannot add cross-site; CORS is not enabled, so cross-site requests fail the CSRF check and cannot read responses either.
- Request bodies are capped at 4 MB, JSON is decoded strictly with unknown fields rejected, and regions, resource types and account IDs are validated against allow-lists or patterns.
- Response headers: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`, `Strict-Transport-Security` over HTTPS, and `Cache-Control: no-store` for everything under `/api/`. The page carries a strict `Content-Security-Policy`: scripts only from the same origin plus the hash-allow-listed inline bootstrap, connections only to the same origin, no framing.
- Jobs are bound to sessions: a job from another session is a 404; at most 2 jobs run per session and 8 per instance (`MAX_JOBS`, 503 beyond that); a job is killed after 2 hours (`JOB_TIMEOUT`); finished jobs are dropped from memory after 2 hours (`JOB_RETENTION`).
- On cancel or session end the worker gets `SIGTERM`, then `SIGKILL` if it is still alive 5 seconds later.
- No telemetry: cloud-nuke's own telemetry is disabled (`DISABLE_TELEMETRY=true`) and the frontend ships no analytics.

### In the browser

- The server session lives only in the cookie; wizard selections live in `sessionStorage` and vanish when the tab closes.
- The History page stores its data in the browser's IndexedDB (up to 50 entries): account ID, regions, resource types, resource identifiers and deletion results, **never credentials**. Delete entries on that page or clear site data.
- The credential fields have autofill disabled and the form is cleared after a successful sign-in.

### Self-hosting

Image: `ghcr.io/4M3Car747c/aws-broom` (distroless, runs as non-root, no shell).

```sh
docker run -d --name broom -p 127.0.0.1:8080:8080 \
  -e SESSION_IDLE_TTL=30m \
  ghcr.io/4M3Car747c/aws-broom:main
```

| Variable | Default | Meaning |
|---|---|---|
| `PORT` | `8080` | listen port |
| `SESSION_IDLE_TTL` | `60m` | idle time after which credentials are zeroed |
| `SESSION_MAX_TTL` | `12h` | hard session lifetime |
| `JOB_TIMEOUT` | `2h` | hard cap per scan / cleanup job |
| `JOB_RETENTION` | `2h` | how long finished jobs stay in memory |
| `RATE_LIMIT_PER_MIN` | `10` | sign-in attempts allowed per IP per minute |
| `MAX_JOBS` | `8` | scans / cleanups running at once across the whole instance |

Recommendations:

- Run it behind a TLS-terminating reverse proxy that sets `X-Forwarded-Proto: https` (enables the `Secure` cookie and HSTS) and `X-Forwarded-For` (rate limiting by real client IP; the proxy must reach the service from a private address). The server gzips its own responses, so the proxy need not.
- Run **exactly one replica**: sessions and jobs are in memory and not shared.
- Restrict who can open the page with the proxy's basic auth, an IP allow-list or a VPN; the tool has no user accounts of its own.
- Do not give the container an AWS role or instance-metadata access. It does not need one.

### Known limitations

- The service has no sign-in of its own: anyone with the URL can use it with **their own** credentials. It cannot stop someone from pasting credentials that are not theirs; responsibility lies with the credential holder.
- Sessions are in memory: a restart drops all sessions and running jobs (and the credentials with them).
- Deletion is irreversible. The tool guarantees that it deletes only what you confirmed, not that you confirmed the right things.

### Reporting a vulnerability

Use GitHub's private vulnerability reporting (repository **Security → Report a vulnerability**). Please do not disclose details in a public issue.
