# fata 新对话交接

> 生成：2026-08-07
> 当前分支：`main`，HEAD：`4ad8b3a`

## 一句话

fata.uk 是一个“零服务器”的深夜文字连接产品：用户写下“今晚为什么醒着”，浏览器做安全和信号检查，Cloudflare Worker 生成 BGE-M3 嵌入、加密入池并匹配另一个醒着的人，之后双方用各自邮箱通信。产品不保存聊天内容。

## 当前状态

- 已上线：Cloudflare Pages + Worker + KV，fata.uk 可访问。
- 线上首页已切换为 2 a.m. 定位：`fata — 2 a.m. words meet another awake person`。
- Worker 已部署版本：`0083d0e4-26c5-46f1-881d-6140132e359b`（2026-08-07，Worker 硬化后）。
- Git：本地与远端 `main` 同步，工作树干净。
- 匹配池：93 条 seed、8 条 matched、0 条真实用户 pending（2026-08-02 审计口径）。
- 真实用户仍为 0；冷启动和真人匹配验证尚未开始。

## 产品定位（v1 已确认）

- 核心人群：深夜醒着的海外英文用户，包括失眠、夜班、独居、时差、创作者。
- Persona：Night Worker、Night Writer、New Time Zone 三个都收，后续用数据淘汰。
- 匹配策略：一次一个 match，可主动进入下一轮；相近时区且醒着时段重叠至少 3 小时。
- 对外定位：`connection / letter app`，不叫 dating。
- 关系目标：陪伴/朋友优先，浪漫关系由双方自然发展。
- 通信载体：长期保持邮箱通信。
- 详细依据：`codex/AUDIENCE.md`。

## 架构

```text
浏览器启发式 + 安全检测
  → PoW + session token
  → Worker /api/submit
  → SiliconFlow BGE-M3 embedding
  → AES-GCM 加密 → Cloudflare KV + GitHub Issues 元数据池
  → 多通道评分 + MMR 重排
  → DeepSeek 共振描述
  → Resend 匹配通知
  → 用户自己邮箱通信
```

## 完成度

- P0 关键链路修复：100%（5/5，E2E 15/15）
- P1 架构与运维健康：100%（5/5）
- P2 增长与质量基建：约 62.5%（5/8）
- 人群与定位：研究与上线文案已完成，匹配特征和真人验证待办
- 本地验证基线：invariant 70/70；中文 F1 94.1%；英文 F1 84.2%；Spearman ρ 0.902；E2E 15/15

## 已完成

- P0：匹配后关闭 Issue、创建 Match Issue、双邮件通知、PoW 难度统一、撤回走 `/api/withdraw`、E2E 覆盖真实 `/api/submit`。
- P1：私有 Worker 备份、旧架构残留清理、退订检查、beacon 漏斗修正、168 条历史敏感 Issue 脱敏。
- P2 基建：`tools/verify-local.js`、GitHub Actions CI、首次回测、冷启动清单、成本台账。
- 人群与定位：多轮研究、8 项决策采访、2 a.m. 文案上线。

## 待办（按优先级）

1. `[x]` 醒着原因标签 + 3 小时时区窗口接入 Worker 匹配特征（E2E 15/15）。
2. `[x]` Worker 自动匹配通知邮件改成 2 a.m. 信笺文案。
3. `[x]` 跑真实 E2E：`node tools/e2e-test.js`。
4. `[~]` CI 纳入 E2E：`.github/workflows/e2e.yml` 手动触发脚手架已建，待受保护 secrets/私有仓库。
5. `[ ]` 第一批真实用户验证和真人匹配回测。
6. `[ ]` 冷启动分发：Reddit、X、Product Hunt、Hacker News、播客/创作者合作。
7. `[ ]` 根据真实反馈决定 Model2Vec、PWA、高级信纸等路线图项。

## 2026-08-07 追加

- 统一密钥入口：`source tools/load-secrets.sh`（基础层 `~/.codex/secrets.env`）。
- 成本台账：`node tools/cost-ledger.js --month YYYY-MM --entry "服务|金额|备注"`。
- 延迟项路线图：`codex/ROADMAP-2026-08-07.md`。

## 关键文件

- `codex/TASKS.md`：任务看板
- `codex/PROJECT.md`：项目现状
- `codex/AUDIENCE.md`：目标人群定义与决策
- `codex/ARCHITECTURE.md`：架构与端点
- `codex/RUNBOOK.md`：部署、回滚、secrets
- `codex/DECISIONS.md` / `codex/RISKS.md`：生产改动后必须更新
- `index.html`：唯一前端页面
- `config/worker.js`：Worker 生产代码（gitignored）
- `config/wrangler.toml`：Worker 路由、KV、Cron（gitignored）
- `tools/match-core.js`：匹配算法唯一真相来源
- `tools/verify-local.js`：本地验证入口

## 常用命令

```bash
# 本地完整验证
node tools/verify-local.js

# 算法专项
node tools/invariant-tests.js
node tools/algo-test.js --lang zh
node tools/algo-test.js --lang en

# 私有 Worker 备份（生产改动前必跑）
./codex/backup-worker.sh

# 前端 Pages 部署（从仓库根目录运行）
./deploy.sh

# Worker 部署（必须从仓库根目录进入 config）
cd config && CLOUDFLARE_API_TOKEN="$CLOUDFLARE_API_TOKEN" npx wrangler deploy

# E2E / 审计
node tools/e2e-test.js
node tools/audit.js
```

## 环境注意事项

- `CLOUDFLARE_API_TOKEN` 只在仓库根目录的 shell 环境中可见；从 `config/` 直接启动 wrangler 会报 token 缺失。
- `config/worker.js`、`config/wrangler.toml`、`config/algorithm-config.json` 被 `.gitignore` 排除，不进公开仓库。
- `codex/private-worker/` 和 `codex/snapshots/` 是私有备份，不能提交公开仓库。
- 以下内部文件已加入 `.gitignore`：`config/param-candidates.json`、`fata_fix_recommendations.md`、`fata_security_review.md`、`分发-*.md`。
- 生产 Worker 改动前必须先运行 `./codex/backup-worker.sh`，改动后更新 `codex/DECISIONS.md` 和 `codex/RISKS.md`。
- 不提交 secrets；secrets 使用 `wrangler secret put`，值不写入代码。

## 重要事实与风险

- 真实用户为 0，不要声称真人验证已通过。
- 英文算法 F1 80%，回测中有误匹配用例，属于后续优化空间。
- Worker 通知邮件仍是旧文案，属于待办第 2 项。
- 线上 `fata.uk` 已生效 2 a.m. 首页文案；`/api/bootstrap` 返回 PoW challenge（difficulty=16）。
