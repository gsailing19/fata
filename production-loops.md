# fata 生产上线 Loop

> 以下每轮执行 `verify-guard` → 实现 → `verification-before-completion` → 审计。
> 每轮结束时报告：通过/未通过 → 通过则下一轮，未通过则修复后重试。

---

## Loop 1: 隐私安全基线
**为什么第一轮**：上线前最后一道防线——用户打开 fata.uk 后，邮箱加密、HMAC 签名、Worker 安全必须真正生效。

| # | 审计项 | 验证方式 |
|---|--------|---------|
| 1.1 | `encryptEmail()` 不在 GitHub Issues 中存明文邮箱 | 代码审计 + 端到端测试 |
| 1.2 | Worker `/api/github/*` 无 HMAC 签名时拒绝 403 | curl 测试 |
| 1.3 | Worker `/api/llm/*` 无 HMAC 签名时拒绝 403 | curl 测试 |
| 1.4 | Worker `/api/resend/*` 无 HMAC 签名时拒绝 403 | curl 测试 |
| 1.5 | Worker 不记录用户文字内容到日志 | 代码审计 |
| 1.6 | `.github/CONTRIBUTING.md` 或 README 包含架构说明（证明隐私） | 文件检查 |

## Loop 2: 前端功能完整性
**为什么第二轮**：用户从打开网页到收到匹配通知的完整流程必须能走通。

| # | 审计项 |
|---|--------|
| 2.1 | 模型加载状态 UI（进度条 + 降级提示）正常工作 |
| 2.2 | 邮箱输入 UI 不是 `prompt()`（用户体验最低标准） |
| 2.3 | 写作 → 信号评分 → 匹配 → 显示结果，完整链路可走通 |
| 2.4 | 深度匹配失败时自动降级到快速匹配 |
| 2.5 | 微信/QQ 浏览器检测并引导到系统浏览器 |
| 2.6 | iOS PWA 安装提示（已安装则豁免 7 天缓存） |

## Loop 3: 服务端韧性
**为什么第三轮**：Worker 挂了、LLM 超时了、Resend 故障了——用户不能看到白屏。

| # | 审计项 |
|---|--------|
| 3.1 | LLM API 超时后自动降级（15s timeout → 快速匹配） |
| 3.2 | DeepSeek API 不可用时返回 fallback 信号（不崩溃） |
| 3.3 | Resend 故障 → 标记 `matched-pending-notification` → 重试逻辑 |
| 3.4 | Worker 健康检查 `/api/health` 正常响应 |
| 3.5 | CSP 头完整（script-src / connect-src / worker-src） |
| 3.6 | CORS 仅允许 fata.uk（不允许任意 origin） |

## Loop 4: 内容安全
**为什么第四轮**：用户可能写任何内容。安全检测不能假阳性（误杀正常文字），不能假阴性（放过自残内容）。

| # | 审计项 |
|---|--------|
| 4.1 | `signal_density` prompt 返回 `risk_level` 字段 |
| 4.2 | `intent_parse` prompt 返回 `content_flag` 字段 |
| 4.3 | `risk_level === 'high'` 时展示援助资源（不投递匹配池） |
| 4.4 | `content_flag !== 'none'` 时拒绝入池（不展示原因给用户以免对抗） |
| 4.5 | GitHub Issue label `flagged` 正确应用于标记内容 |
| 4.6 | 正常文字不被误判为风险内容 |

## Loop 5: 性能基线
**为什么第五轮**：首次加载 24MB 模型不能让用户跑掉。

| # | 审计项 |
|---|--------|
| 5.1 | 首次加载有明确进度提示（xx%，预计 xx 秒） |
| 5.2 | 模型缓存后二次加载 < 3 秒 |
| 5.3 | Orama 搜索 < 100ms（5000 条以下） |
| 5.4 | 首页渲染 < 1 秒（不含模型加载） |
| 5.5 | 无 render-blocking 资源（CSS/JS 异步加载） |

## Loop 6: 部署完整性
**为什么最后**：代码改了之后要确保线上真的跑的是最新版本。

| # | 审计项 |
|---|--------|
| 6.1 | `fata.uk` 返回 200 且内容正确 |
| 6.2 | `worker.fata.uk/api/health` 返回 200 |
| 6.3 | Worker 版本 ID 与最后一次部署一致 |
| 6.4 | GitHub repo 公开文件列表与预期一致（9 个文件） |
| 6.5 | Resend 域名状态为 `verified` |
| 6.6 | Pages 自定义域名绑定 fata.uk + worker.fata.uk |

---
**执行命令**: `/loop fata 生产上线审计 — 从 Loop 1 开始，每轮完成后暂停等我审计确认。`
