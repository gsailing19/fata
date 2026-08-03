# fata 目标人群研究

> 状态：v1 已确认（2026-08-03 用户采访），等待真人数据验证。
> 最后更新：2026-08-03
> 本文是后续功能设计的“人群依据”；功能优先级、文案、匹配特征、冷启动都从这里推导。

## 一句话人群

海外英语世界里，深夜醒着、且感到“独自醒着”的人：
夜猫子、失眠者、夜班/轮班族、独居青年、时差与远距离人群、夜间创作者、社交焦虑但想被阅读的人。

他们不是“找对象的人”，而是“想被听到的人”。交友是结果，不是入口。

## 为什么是这个人群

1. 夜间孤独感是真实且被研究验证的需求：夜猫子更容易焦虑和孤独，孤独感是晚间型年轻人过度使用社交媒体的重要中介。
2. 失眠者会在网上寻找共同体：“以共同体替代睡眠”，匿名分享个人经历并因此获得归属感。
3. 主流交友产品正在退潮：滑动疲劳、女性疲惫、AI 代写反感，用户开始寻找更慢、更少、更深的连接。
4. 笔友/慢通信模式已被验证：Slowly 1000 万用户、疫情笔友项目 1.5 万人报名，说明异步文字通信不是小众实验。
5. 现有“深夜社交”竞品都是即时聊天/视频，没有人占据“深夜文字 + 邮件慢信 + 情绪匹配”的位置。

## 人群证据

### 宏观画像

- 晚间型年轻人（eveningness）与更高焦虑、抑郁、孤独和更差睡眠相关；孤独感和焦虑是问题性手机使用及社交媒体成瘾的中介（[PLOS ONE 2025](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0331961)）。
- “夜间孤独感”被睡眠研究提出为失眠常被忽视的症状，指“深夜醒着时感到与外界隔绝”（[SLEEP 2025](https://academic.oup.com/sleep/article/48/Supplement_1/A117/8135227)）。
- 失眠者在 YouTube/Reddit 等平台互相阅读、披露和验证，“把私人症状变成共享的社会状态”（[Frontiers in Sociology 2025](https://www.frontiersin.org/journals/sociology/articles/10.3389/fsoc.2025.1492373)）。
- 18-24 岁年轻人中约一半经常或总是感到孤独；约三分之一独居者报告频繁孤独（[Wysa/Businesswire](https://www.businesswire.com/news/home/20251010134130/en/Wysa-Reveals-Loneliness-Has-Higher-Health-Risk-Than-Demographics)）。

### 细分人群

| 人群 | 证据 | 初始优先级 |
|------|------|------------|
| 夜猫子/晚间型年轻人 | 孤独、焦虑、睡前刷手机循环 | P0 |
| 夜班/轮班族 | r/Nightshift 约 8.6 万人；夜班减少工作日社区参与 | P0 |
| 独居青年 | 18-24 孤独率最高；独居人群频繁孤独 | P0 |
| 时差/远距离人群 | 时区打乱家庭支持网络，白天社群不匹配 | P1 |
| 夜间创作者/写作者 | 已存在 Midnight Letters、Sleepless Creatives 等社区 | P1 |
| 社交焦虑但想被阅读的人 | MeetSummer 等纯文字匿名产品已出现 | P1 |
| 新父母深夜醒着 | 夜奶/独醒场景真实，但更像陪伴支持；不纳入匹配，仅在内容/共鸣片段出现 | 不纳入 |

### 行为与动机

- Slowly 自 2017 年积累约 1000 万用户，用户多在 20-30 岁；延迟投递“自然鼓励更长、更用心的信息”（[AP/Rapid City Post](https://rapidcitypost.com/pen-pal-programs-have-evolved-but-old-fashioned-letter-writing-could-be-coming-back/)）。
- 主流 dating 疲劳严重：78% 用户经历过某种程度 burnout，女性约 80%；主要原因是没有有意义的连接、失望和重复对话（[Global Dating Insights](https://www.globaldatinginsights.com/news/gen-z-dating-app-burnout-drives-surge-in-matchmaker-interest/)）。
- “慢交友”成为明确趋势：用户想要少而深、不压迫、关系节奏更慢的体验（[Mashable](https://me.mashable.com/sex-dating-relationships/74168/why-burnt-out-millennials-are-turning-to-slow-dating-apps-in-2026)）。
- 无照片/文字优先能提升女性安全感：Bookmark 要求交换 10 条消息后才显示照片，25% 付费用户是女性（[Global Dating Insights](https://www.globaldatinginsights.com/featured/reading-based-dating-app-bookmark-plans-global-expansion/)）。
- 用户对 AI 代写资料反感：超半数年轻约会用户表示会因疑似 AI 生成资料而降低吸引力；fata 的 AI 必须只做“桥梁”，不能假扮人（[Mashable](https://me.mashable.com/sex-dating-relationships/72065/dating-app-rejects-ai-trend-as-singles-say-it-makes-dating-less-authentic)）。
- 垂直社区成功的关键是“归属感 + 创始人带领”，不是单纯 niche（[Global Dating Insights](https://www.globaldatinginsights.com/featured/founder-led-communities-are-redefining-the-future-of-niche-dating/)）。

## 目标人群定义（v1 已确认）

### 核心画像

- 年龄：20-38 岁。
- 语言与地域：英语为主，重点 US/UK/CA/AU/IE/NZ，兼容全球英语使用者。
- 活跃时段：本地时间 22:00-04:00。
- 情感需求：被听见、归属、安静的陪伴、不被打扰的深度。
- 行为特征：睡前刷手机/Reddit/YouTube；对主流 dating 疲惫；愿意写信但不喜欢即时聊天压力；重视匿名与隐私；不想被当病人。
- 反画像：不是白天社交场景、不是视频用户、不是照片优先用户、不需要“治疗失眠”承诺。

### 优先 Persona

1. The Night Worker：护士、仓库、客服、安全、远程跨国协作；社交时间与身边人错开，白天补觉，深夜想说话。
2. The Night Writer：创作者、学生、自由职业者、过度思考者；失眠或夜猫子状态是创作材料，想找到“读得懂的人”。
3. The New Time Zone：留学生、数字游民、移民、跨国工作者；家人朋友都在另一个白天，自己却醒着。

## 已确认决策（2026-08-03 采访）

- 人群核心：深夜醒着的人，包含失眠、夜班、独居、时差、创作者。
- Persona：Night Worker、Night Writer、New Time Zone 三个都收，用数据淘汰。
- 新父母：暂不纳入核心人群，只在内容/共鸣片段里出现。
- 匹配数量：一次一个，用户可主动进入下一轮。
- 时区窗口：相近时区，双方醒着时段至少重叠 3 小时。
- 对外定位：`connection / letter app`，不叫 dating。
- 关系目标：陪伴/朋友优先，浪漫关系由双方自然发展。
- 通信载体：长期保持邮箱通信，不改架构。

## 产品设计含义

- Onboarding：只问一个问题——“Why are you awake tonight?”，用选项代替注册资料。
- 身份：不建头像、不建公开 profile；可选“醒着的原因”标签，如 night shift、overthinking、new city、wrong time zone、creative hours。
- 匹配：少而深，一次一个 match，用户可主动进入下一轮；相近时区且醒着时段重叠至少 3 小时；文字共振优先于标签。
- 通信：邮件信笺，无已读回执，无聊天室；等待被设计成仪式。
- AI 角色：AI 是“桥梁”不是“替身”；共振描述明确由系统生成，不假装是对方写的话。
- 安全：18+、危机资源、撤回、退订、不公开搜索、默认不公开内容；邮件进入外部通信后 fata 不保存聊天内容，因此要让用户始终保留“不回复即可结束”的控制感。
- 社区：匿名共鸣片段、可分享的深夜卡片、创始人“深夜主持人”语气。
- 定位口径：对外统一使用 `connection / letter app`；陪伴/朋友优先，浪漫由双方自然发展。

## 冷启动渠道

- Reddit：r/insomnia、r/Nightshift、r/nightowls、r/LivingAlone、r/lonely、r/penpals；用 founder 故事和真实深夜文案进入，不做硬广。
- X：深夜时段参与 #insomnia、#nightowl、#2am、#writing 讨论。
- Product Hunt：定位“2 a.m. 文字会合点/慢社交”，不叫 dating app。
- Hacker News / Indie Hackers：零服务器、加密池、邮件通信的技术叙事。
- 播客/创作者：睡眠与失眠播客、夜班护士博主、夜间写作者社区。

## 验证指标

- 漏斗：page_view → 选择醒着原因 → 开始写作 → 提交 → 匹配成功 → 邮件打开。
- 人群验证：按醒着原因标签统计转化率、匹配率、回访率，淘汰无效子人群。
- 社区信号：共鸣卡分享数、Reddit/X 提及、自然访问来源。
- 安全信号：撤回率、退订率、危机资源点击。

## 暂时不做

- 照片、滑动、即时聊天、公开广场。
- 医疗/睡眠治疗承诺。
- 中国本土运营与分发。
- 未成年人入口（18+）。

## 后续待定

- 冷启动第一战场：Reddit + X、Product Hunt、还是播客/创作者合作。
- 共鸣片段的公开程度与审核策略。
- 真人数据验证后是否淘汰某个 Persona 或调整时区窗口。
