# Polymarket 持仓助手 — 项目进展 (progress.md)

> 浏览器扩展,服务于 Polymarket。核心目标:**同时监看多个持仓**,并能**更简单地卖出与止损**。主要交易世界杯相关市场。

---

## 0. 状态总览

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0 | 项目脚手架 (Vite+CRXJS+React+TS, MV3) | ✅ 完成 (构建通过 + Codex 审查无阻塞) |
| P1 | 只读监控 MVP (持仓/盘口/盈亏/概率展示) | ✅ 完成 (Codex 实现 + Claude 实跑验证 + Codex 独立审查 + 修复) |
| P2 | 认证模块 (私钥导入+加密存储+API key 派生) | ✅ 完成 (含独立审查发现的加固);CLOB 认证 SW 运行时待 Chrome 实测 |
| P3 | 交易操作 (4种卖出+撤单+护栏) | ✅ 代码完成+双向交叉验证+独立审查发现已修复;实盘 dry-run/小额 待 Chrome |
| P4 | 止损监控 (瞬时下跌检测+自动抛 n%) | ✅ 代码完成+双向交叉验证+独立审查(5项)已修;dry-run 触发验证待 Chrome |
| P1.5 | WebSocket 实时行情(替换轮询) | ✅ 完成 (Claude 审查+端点校验+构建);UI 实时更新待 Chrome 确认 |
| P5 | Safari 移植 | ⏸ 暂缓(自用,最低优先级) |
| P6 | 打磨 (中英双语切换 + 反馈调整) | ✅ 完成 |

最近更新:2026-06-18。

---

## 0.1 交接状态(2026-06-18,新会话从这里看起)

**整体**:P0–P6 + P1.5 全部代码完成,经「Codex 实现 / Claude 实跑验收 / Codex 独立审查 / Claude 修复」闭环;构建通过,三个离线自测(crypto/orders/stoploss)通过。已多轮提交到 `main`(最新含 README、主题、双语、模式徽章等)。

**已由用户在 Chrome 实测通过**:
- 加载、设置、地址、手动刷新、私钥导入/解锁、**"CLOB auth ready" 运行时**(clob-client 在 SW 可跑)、错密码明确报错、语言切换、主题(深/浅/跟随系统)、折叠交互、模式徽章红绿。

**尚未实测(等用户有真实持仓后再沟通验证)**:
- 持仓卡片真实数据展示、四种卖出(先 dry-run 再小额实盘)、撤单、自动止损触发。
- 即 README/TESTING.md 中的 **B 类(需小额持仓)与 C 类(关 dry-run 小额实盘)** 测试待办。

**进行中(用户侧)**:用户正用 **Claude design** 设计更好的 UI 界面;后续可能据其产出调整界面(组件结构/className 尽量保持,以便换肤)。

**下一步建议**:① 等用户给出 Claude design 的 UI 方案后,据此重构/美化界面(注意保持 store 与组件 props 契约,逻辑勿动);② 等用户有真实持仓后,陪同走 B/C 类功能验证;③ 可选:扩展内链上赎回、后台错误文案本地化、Safari 移植(P5)。

---

## 1. 已确认需求

### 监看(只读)
- 每个持仓:**持有份额 size、均价 avgPrice**、实时盈亏。
- **回本价** = 均价 `p`(忽略手续费,Polymarket 现货交易费为 0)。
- **翻倍价** = `2p`;**翻 n 倍价** = `n·p`。超过 $1.00 标记为"不可达"。
- **各方概率**:每个 outcome 的最新成交价 ≈ 隐含概率。世界杯多为**多结果市场**(夺冠/各队),按 event 聚合展示。
- **LOB 盘口**:买卖各档价格与深度。

### 操作(交易)
- **价格优先卖**:post-only 被动限价单,默认挂在当前最优卖价,不穿价、不立即成交,排队等成交。追求价格。
- **成交优先卖**:可成交限价单,默认定价在当前最优**买**价(让出价差换即时成交),FAK(fill-and-kill)只吃顶档、不向下扫穿。追求即时成交。
- **n 倍价挂单**:在 `n·avg` 价位挂限价卖单。
- **卖出回收 n×成本现金(部分减仓)**:卖出 `q = n×成本/现价 = n·avg·size/p` 份,使到手现金 = n×成本,**其余 `size−q` 份继续持仓**(白嫖)。可行条件 `p ≥ n·avg`(即 q≤size);否则 q 封顶为全仓并提示"卖全仓也不足 n×成本"。n=1 即"取回本金,剩余白嫖"。
- **撤单**:撤销自己挂出的单。

### 交易护栏(用户确认全部加上)
- 下单前**二次确认弹窗**:显示方向/价格/数量/预计金额,手动确认才发。
- **Dry-run 模拟开关**:开启时只构造并展示订单、不真正提交(跑通后再开实盘)。
- **单笔最大金额上限**(可配),超限拦截。
- 前置条件:`authStatus.authenticated === true` 才允许下单。

### 止损
- **瞬时下跌检测 + 自动抛 n%**,每个持仓可单独配置参数,提供随仓位变动的默认值(见 §4)。
- 监控仅需在**浏览器开着时**生效。用户进一步确认:**仅面板开着时盯**(不迁后台/offscreen,监控就在面板里复用 WsSource 价格流)。
- 触发执行:**自动卖出但遵守全局 Dry-run**(dry-run 开→只模拟+桌面通知"本应卖出";dry-run 关且该仓已武装→真卖,以"成交优先 FAK@买一"出 n%)。每仓需显式武装(opt-in),后台执行前校验该仓确为已武装。止损单用独立上限 `stopLossMaxUsd`(默认更高),不受手动单 `maxOrderUsd` 限制。

---

## 2. 关键技术决策

- **账户**:邮箱/Magic 登录。资金在 Polymarket 托管代理钱包。
- **下单可行性**:邮箱用户可一次性**导出私钥**(Polymarket 设置 → Private Key → Start Export,或 `reveal.magic.link/polymarket`)。该私钥作为 signer,配 `signature_type=1` + `funder`=代理钱包地址,用官方 `@polymarket/clob-client` 在扩展内签名下单。
- **私钥存储**:**仅本地**。Web Crypto 派生密钥 + AES-GCM 加密,存 `chrome.storage.local`,**绝不** `storage.sync`、**绝不**外传。用户设解锁密码。安全前提:**该账户只放计划交易的资金**。
- **技术栈**:Vite + CRXJS + React + TypeScript,Manifest V3。状态管理 Zustand。交易 `@polymarket/clob-client` + `ethers`。
- **UI 载体**:Chrome Side Panel(适合多持仓常驻监控)。
- **浏览器**:先做 Chrome;Safari 后续用 Xcode `safari-web-extension-converter` 移植(自用,暂缓)。

### 数据来源 (均为公开,只读无需认证)
| 用途 | 接口 |
|---|---|
| 持仓(size/avgPrice) | `data-api.polymarket.com/positions?user=<proxyAddress>` |
| 市场元数据/事件聚合 | `gamma-api.polymarket.com` |
| 盘口 LOB / 价格 | `clob.polymarket.com/book`、`/price`、`/midpoint` |
| 实时推送 | CLOB WebSocket(market channel: book/price;user channel: 自己的订单/成交) |
| 下单/撤单(需认证) | `clob.polymarket.com` + L2 API key + EIP-712 签名 |

---

## 3. 系统架构

```
┌─────────── 扩展 (MV3) ───────────┐
│ Side Panel (React)               │
│   多持仓卡片 / 盘口 / 操作按钮    │
│        ▲ 消息 (chrome.runtime)   │
│        ▼                         │
│ Background Service Worker        │
│   ├─ 数据层 (轮询 + WebSocket)    │
│   ├─ 盈亏计算引擎                 │
│   ├─ 止损监控器                   │
│   └─ 交易引擎 (clob-client 签名)  │
│ 加密存储 (AES-GCM 私钥)          │
└──────────────────────────────────┘
```

目录结构(规划):
```
src/
  background/   # service worker:数据层、监控、交易引擎、消息路由
  sidepanel/    # React UI
  lib/
    api/        # data-api / gamma / clob REST + ws 封装
    calc/       # 回本/翻倍/盈亏 计算
    trading/    # clob-client 封装、下单语义
    crypto/     # 私钥加解密
    types/      # 共享类型
  shared/       # 消息协议、常量
```

---

## 4. 止损公式(默认值,价位/仓位自适应)

每个持仓维护价格滚动窗口,实时计算。

**触发条件(瞬时下跌)**
- 窗口 `W` 默认 30s(可调 5–300s)。
- 跌幅 `d = (P_max(窗口内) − P_now) / P_max`。
- 当 `d ≥ T` 触发。

**触发阈值 T(随当前价自适应)**
```
T = clamp(0.05 + 0.10·(1 − P_now), 0.04, 0.15)
```
低价仓波动相对更大 → 阈值自动放大,减少误触发。
- P=0.90 → T≈6%;P=0.50 → T=10%;P=0.20 → T=13%。

**卖出比例 n(随跌幅强度与仓位现值自适应)**
```
severity   = clamp(d / T, 1, 2.5)
sizeFactor = clamp(V / V_ref, 0.7, 1.5)   # V = P_now·shares, V_ref = $300
n          = clamp(0.4 · severity · sizeFactor, 0.25, 1.0)
```
触发后卖出 `shares·n`,以"成交优先"方式立即出货;触发后 **60s 冷却**,价格企稳后重新武装。

> 全部参数每仓可覆盖;以上为自动默认。具体系数 P4 实测再调。

---

## 4.5 P1 实现要点与已知项

**已确认的真实 API 字段**(写进 `src/lib/types.ts`):
- `data-api /positions` 单条即含 `asset`(=token_id)、`size`、`avgPrice`、`curPrice`、`cashPnl`、`percentPnl`、`title`、`outcome`、`eventId/eventSlug`、`redeemable`、`negativeRisk`。
- `clob /book` = `{asset_id, bids:[{price,size}], asks:[...]}`(价格顺序不保证,代码显式数值排序);批量 `POST /books` body=`[{token_id}]`。

**架构**:`DataSource` 抽象(`directSource.ts` REST 轮询实现)→ Zustand store → Side Panel 组件。P4 加 WebSocket 时实现新的 DataSource 即可替换,UI/store 不动。

**P1 关键修复(Codex 独立审查发现)**:
- 最优买/卖价提取过滤非有限/≤0 价格(否则 0 价被排到最优);轮询世代号防慢响应覆盖;stop 后丢弃 in-flight 结果;持仓集合变化才补拉 books(防请求叠加);config 层 clamp 轮询间隔、去重 multipliers;已结算/可赎回仓位单独标注(不显示满额亏损盘口)。

**已知待办**:
- UI 文案目前为英文,项目其余为中文 → 列入 P6 统一本地化(或按用户偏好决定)。
- `data-api /positions` 仅校验为数组,未做字段级校验(低风险,可后补)。
- 浏览器内交互验证待用户加载 `dist/` 未打包扩展确认(逻辑已用真实 API 离线验证)。

## 4.6 P2 设计(私钥/认证 — 已确认决策)

**用户确认**:① 解锁节奏 = **会话级解锁**(导入时设密码;每次浏览器会话输一次密码把私钥解密进内存;关闭浏览器/超时自动锁)。② UI = 中英双语可切换,统一切换放 P6,新 UI 预留 `t()`。

**密钥生命周期与签名位置**:
- 私钥来源:用户从 Polymarket 设置导出(`reveal.magic.link/polymarket`)。导入扩展时用 Web Crypto **PBKDF2(高迭代)派生 AES-GCM 密钥**,以解锁密码加密私钥,密文存 `chrome.storage.local`(永不外传、永不 sync)。
- 解锁:输入密码 → 解密得到私钥 → 缓存到 **`chrome.storage.session`**(MV3 内存级、不落盘、随浏览器关闭清除,`setAccessLevel` 限受信上下文)→ 供后台 SW 签名。这样满足"会话内解一次",且 P4 自动止损在 SW 中也能签名(面板关着也行)。
  - ⚠ 安全权衡:`chrome.storage.session` 持有明文私钥(内存,不落盘)是会话级解锁的必然代价;前提是"该账户只放计划交易资金"。
- 签名位置:**后台 Service Worker**(交易引擎),非面板,以支持 P4 无面板止损。

**认证实现**(`@polymarket/clob-client` + `ethers`):
- `signature_type = 1`(Magic 代理钱包);`funder` = 用户的代理钱包地址(= P1 已填的监控地址)。
- 用私钥 signer 派生 L2 API key(createOrDeriveApiKey),API key 凭据也存 `chrome.storage.session`(会话内)。
- (具体 clob-client TS 方法名以实测/源码为准。)

## 4.7 P2 实现状态与验证

**实现(Codex)**:`src/lib/crypto/{keyStore,vault}.ts`、`src/lib/trading/clobClient.ts`、`src/background/index.ts`(IMPORT_KEY/UNLOCK/LOCK/FORGET_KEY/GET_AUTH_STATUS + SW 重启 session 恢复)、`src/shared/messages.ts`、`src/sidepanel/store.ts`、`src/sidepanel/components/AuthBar.tsx`、`scripts/check-crypto.mjs`。

**⚠ 关键事件**:Codex 子代理沙箱无 npm 网络,曾用"假替身包"让构建假性通过。Claude 已删除假包、`npm install` 装回**真实** `@polymarket/clob-client@5.8.1`(带 viem/axios)+ `ethers@5.x`,**真依赖下 `npm run build` 通过(697 模块,SW 包 ~328KB)**。

**Claude 验收**:加密自检三项通过;手工审查 keyStore(PBKDF2-200k/SHA-256、随机 salt+IV、AES-GCM-256、错误密码抛错)、vault(密文存 local、明文私钥仅入 session 且 setAccessLevel TRUSTED_CONTEXTS)、clobClient(ethers Wallet signer、signatureType=1、funder=代理钱包地址)、AuthBar(三态、私钥不回显、二次确认)、store 集成——均正确。

**Codex 独立安全审查 + 已实施的加固**:
- 加密参数判定达标(PBKDF2-200k/SHA-256/随机 salt+IV/AES-256-GCM,错误密码可靠抛错),无泄漏(不打印/不 sync/不回显)。
- ✅ [高/运行时] `browser-or-node` 在 SW 中误判 → clob-client 注入 fetch 禁止的 Node 头。新增 `src/background/swEnv.ts`(最先导入,令 `window=globalThis`+空 `document`,使 `isBrowser` 为真)。**仍需 Chrome 实测确认 `createOrDeriveApiKey` 成功。**
- ✅ [中] `GET_AUTH_STATUS` 改为每次由 `readSession()` 实时派生 `unlocked`/`authenticated`,删除模块级 `_unlocked`(消除陈旧/绕过风险,也顺带解决 FORGET_KEY 部分失败不一致)。
- ✅ [中] 拆分 `unlocked`(钱包可签名)与 `authenticated`(CLOB 凭据已派生);UNLOCK 凭据派生失败时 `authenticated=false`,AuthBar 显示"CLOB auth failed,orders disabled",P3 下单要求 authenticated。
- ✅ [低] 后台 IMPORT_KEY 强制密码 ≥8 位(不再只在 UI 校验)。
- ✅ 纠正审查建议 #5:**signer(Magic EOA)地址 ≠ funder(代理钱包)**,不能用相等校验私钥;改为解锁后显示派生的 EOA 地址供用户核对(`signerAddress`)。
- 📌 [P3 注意] clob-client 订单 salt 用 `Math.random()`(非加密随机),为其自带逻辑;P3 时确认 Polymarket 服务端可接受,否则考虑 patch。

**待 Chrome 实测项**(P3 前必须验证):
- 加载 `dist/` 后导入私钥→解锁,确认 AuthBar 显示 **"CLOB auth ready"**(即 `createOrDeriveApiKey` 在 SW 中成功,swEnv 垫片生效)。若失败,需先迭代 SW 环境处理再进 P3。

i18n:AuthBar 文案集中在 `TEXT` 常量,便于 P6 抽取。

## 5. 待校准/待确认(P3/P4 实盘时)

1. "成交优先"的精确定价(顶档买价 vs 价差内一档)与 FAK/FOK 行为,需实盘校准。
2. CLOB tick size、最小下单量、代理钱包下单 allowance/授权流程。
3. 止损公式系数经验调整。

---

## 6. 工作流(Claude + Codex 交叉验证)

- 实现:Claude 写 spec → 视情况自写或交 Codex(`codex:codex-rescue`)编码。
- 验收:每一步双重交叉验证 —— Claude 用 `verify` 跑实际行为 + Codex 独立审查代码,分歧汇总。
- 大问题找用户确认,小问题自行解决。

---

## 6.5 P4 实现状态

**实现(Codex)**:`src/lib/stoploss/detector.ts`(纯算法:滚动窗口/autoThreshold/autoSellFraction/evaluate+冷却+重新武装)、`monitor.ts`(面板内 processSnapshot 喂价触发)、`src/shared/stopLossConfig.ts`(每仓配置存储+clamp)、background `STOP_LOSS_SELL`、store(loadStopLossConfigs/arm/disarm/setParams/executeStopLoss + snapshot 喂价接线 + chrome.notifications)、`StopLossPanel.tsx`、`scripts/check-stoploss.mjs`。`AppConfig` 增 `stopLossMaxUsd`(默认 1000)。

**Claude 验收通过**:公式与 §4 一致;监控仅处理 armed/非 redeemable/size>0/有买价的仓位;触发回调→executeStopLoss 算 qty=sellFraction×size、发 STOP_LOSS_SELL、桌面通知;**后台 STOP_LOSS_SELL 执行前校验该仓 armed**、taker FAK@bestBid、**遵守 config.dryRun**、独立 `stopLossMaxUsd` 上限、复用含 H1 校验的 placeSell;停止监控/解除武装/持仓消失均清理 runtime;三个自测(stoploss/orders/crypto)+ 构建全过。

**待办**:⏳ Codex 独立 money-path 审查中。🔬 Chrome 验证:开 dry-run + 武装某仓 → 制造/等待瞬跌 → 应只通知"DRY RUN signed",不真卖;确认逻辑后再按需关 dry-run。

## 6.6 P6 打磨 + 用户反馈调整(2026-06-18)

**用户反馈修改(Claude 直接改)**:
- 持仓卡片新增 **持仓价值(Value = 现价×份额)**;移除 **Breakeven** 与 **对手方概率**(保留隐含概率)。
- 工具栏加 **手动刷新**(`DataSource.refresh()` 贯通 WsSource/DirectSource/store)。
- **Bug 修复**:解锁输错密码只显示空红框 → 根因 AES-GCM 解密失败的 DOMException message 为空;`keyStore.decryptPrivateKey` 捕获后替换为明确文案。

**P6 中英双语(Codex 实现,Claude 验收)**:
- `src/shared/i18n.ts`:集中字典(zh/en,`satisfies` 保证完备)+ `translate(lang,key,params)`(占位符 + zh 回退)。
- `AppConfig.lang` 默认 `'zh'`,归一化校验;`useT()` hook(store);SettingsBar 顶部 中/EN 即时切换。
- 8 个组件全量 i18n;译文自然、术语一致。业务逻辑/算法/消息协议未改,三自测(stoploss/orders/crypto)+ 构建全过。
- 已知小项:后台 SW 抛出的错误经 passthrough 仍为英文(含解锁错密码文案);UI 自有字符串已双语。

**测试**:`TESTING.md` 已编写(A 无需持仓 / B 小额持仓 dry-run / C 关 dry-run 小额实盘)。

### 第二轮反馈(2026-06-18,用户测完 A 类后)
- **已结算·可赎回持仓**:卡片新增「在 Polymarket 赎回 ↗」按钮(打开 portfolio)+ 说明。扩展内链上赎回(Magic 代理钱包经 CTF/NegRiskAdapter)是独立后续项,未做。
- **Polymarket 主题改造**:自托管 **Inter**(`@fontsource/inter` 400/500/600/700,main.tsx 导入);styles.css 定义 Polymarket 调色板 CSS 变量并全局换肤 —— **Poly Blue `#2E5CFF`** 主色、暗色面板(`--bg #0b0e16`/`--surface #141a24`)、Yes/No 绿红(`#27AE60`/`#EB5757`)、12px 卡片圆角、主按钮实心蓝。AuthBar.css 同步。
- **Bug 修复**:模拟交易开关文字不居中 → `.settings-form__checkbox` 改横向对齐(row + align-items center)。
- 所有 var() 引用均在 :root 定义;构建 + 三自测通过。视觉「完全一致」待用户加载 dist 肉眼确认后微调。

### 第三轮反馈(2026-06-18,用户看主题截图后)
- **暗色色差校准**:原偏蓝(#0b0e16/#141a24)→ 改为贴近 Polymarket 的近黑中性(`--bg #0e0f13`/`--surface #17181d`/`--border #2a2c34`)。
- **主题模式 跟随系统/深色/浅色**:`AppConfig.theme: 'system'|'dark'|'light'`(默认 system)。App 用 `matchMedia('(prefers-color-scheme)')` 解析并监听,设 `documentElement[data-theme]`;styles.css 将 token 拆为 `:root[data-theme='dark']` 与 `[data-theme='light']` 两套(共享品牌色,派生 soft 色按主题 surface 实时混合)。SettingsBar 加 系统/深色/浅色 切换。
- **已结算持仓为何仍显示**:data-api 只要还持有结果代币就返回该持仓,结算后直到**赎回**才消失(失败仓价值≈0 仍在)。加 `hideSettled` 设置(默认显示)按 `redeemable` 过滤;并解释给用户。
- **交易访问解锁后默认折叠**:AuthBar 解锁态改为紧凑行(状态徽章 + 锁定 + 展开/收起),展开才显示 signer 地址/忘记密钥,给下方持仓让出空间。

## 7. 变更日志

- 2026-06-17:需求确认完成,确立架构与止损公式,启动 P0 脚手架。
- 2026-06-18:P0 完成。脚手架构建通过;Codex 独立审查无阻塞性问题;移除了 host_permissions 中非法的 `wss://` scheme。进入 P1。
  - Codex P1 提醒:① 先设计好 store/订阅层与多持仓数据模型再长 UI;② 后台异步消息处理器须 `return true` 且 settle 后再 `sendResponse`;③ 多持仓布局与共享状态结构先设计后实现。
- 2026-06-18:P1 完成。Codex 按 spec 实现(对真实 API 字段编码);Claude 实跑真实接口验证全链路计算正确;Codex 独立审查发现 7 处问题,已修复高价值项并复构建通过。进入 P2(私钥/认证,安全敏感,实现前与用户确认 UX)。
- 2026-06-18:P2 完成。用户确认会话级解锁 + 中英双语(切换放 P6)。Codex 实现;**Claude 发现 Codex 沙箱无网造假依赖、删除并装回真包,真依赖构建通过**;加密自检通过;Codex 独立安全审查 0 Critical/2 High/3 Med/2 Low,Claude 全部处理(swEnv 垫片、状态由 session 实时派生、unlocked/authenticated 拆分、密码长度、纠正 signer≠funder)。复构建+自检通过。
- 2026-06-18:用户实测确认 **"CLOB auth ready"**(swEnv 垫片生效,clob-client 在 SW 可运行,P3 地基确认)。
- 2026-06-18:用户新增需求 → P1.5 完成。① 行情改最高频率:用 CLOB market WebSocket 实时推送替换 5s 轮询(端点 `wss://ws-subscriptions-clob.polymarket.com/ws/market`,curl 已验证端点有效)。Codex 实现 WsSource;Claude 审查通过并把"持仓变化时增量订阅(未验证)"改为"重连全量重订阅"更稳妥;构建通过。**UI 实时跳动待 Chrome 确认。** ② 确认新卖出选项语义=回收 n×成本现金(见 §1)。③ 交易护栏全部确认。
  - P4 注意:WS 跑在面板上下文,面板关闭即断;后台持续止损需迁到 SW/offscreen(P4 处理)。
- 下一步:P3 交易操作(含护栏),Codex 实现 + 交叉验证。
- 2026-06-18:P3 实现完成(Codex)。`src/lib/trading/orders.ts`(prepareSellOrder/placeSell/computeNxCostQuantity/roundToTick)、background 的 PLACE_ORDER/GET_OPEN_ORDERS/CANCEL_ORDER/CANCEL_ALL、UI 的 OrderActions/ConfirmDialog/OpenOrders、SettingsBar 增 dryRun/maxOrderUsd。
  - Claude 验收:四模式→clob-client 映射正确(maker=GTC+postOnly@ask;taker=FAK@bid;limitN=GTC@roundToTick(n·avg),>0.999 拒;nxCost=FAK@bid 卖 q=n·avg·size/bid);`scripts/check-orders.mjs` 全过(我补跑;Codex 实际已建);订单只能经 ConfirmDialog 触发;maxOrderUsd 在 **UI+后台双重**校验;**dryRun 默认 true(storage 无值时,已核 config.ts)**;价格/数量在后台权威重算(UI 仅预览,tickSize 后台 getTickSize 为准)。
  - Codex 独立 money-path 审查:0 Critical / 2 High / 4 Med / 3 Low。Claude 已逐条处理:
    - ✅ H1 失败响应被当成功:`placeSell` 增 `assertOrderAccepted`(校验 success/errorMsg/error),拒单不再误报 "Submitted"。
    - ✅ H2 确认仅 UI 约定可绕过:改为**后台强制 prepare→confirm 一次性 nonce 握手**(`PREPARE_ORDER` 只构建+校验+发 nonce 不提交;`CONFIRM_ORDER` 凭一次性 nonce 才提交,限时 120s,确认时以最新 config 重校验上限)。
    - ✅ M2 limitN 最近取整可能低于目标:改 `ceilToTick`,上限用 `1 - tickSize`。
    - ✅ M3 maker 允许 price==bestBid 可能穿价:改严格 `>` + postOnly 兜底。
    - ✅ M4 size 精度:本地对齐 clob-client 的 2 位小数。
    - ✅ L1 回传原始响应:仅回传白名单字段。✅ L2 CANCEL_ALL 改为按 asset 限定(必填),无全账户无差别撤单。✅ L3 非法 size 不再返回 NaN。
    - 📌 M1(taker/nxCost 用 FAK@bestBid 不向下扫穿)= 用户既定"成交优先不扫穿"语义,保留并记录;最小下单量未本地强制,靠 H1 把服务端拒单清晰暴露(后续可读 gamma orderMinSize 预校验)。
  - 自测 `scripts/check-orders.mjs` 覆盖回收数量/取整/ceil/上限/dryRun-不提交,全过;`npm run build` 702 模块通过。
  - 🔬 待 Chrome 实测:① dry-run 跑通四种卖出 + 撤单(确认弹窗→signed 不提交);② 关 dryRun 用**小额**实盘验证一次(注意 orderMinSize 过小会被拒,H1 现在会清晰报错)。
- 2026-06-18:P4 实现完成(Codex)。用户决策:仅面板盯盘、自动卖出但遵守 dryRun。Claude 验收通过;Codex 独立 money-path 审查 0 Critical/2 High/2 Med/1 Low,Claude 全部处理:
  - ✅ H1 重放消息可绕过面板冷却:后台新增**每仓冷却**(`stopLossCooldownUntil`,仅真实提交施加,dry-run 不限便于测试)。
  - ✅ H2 后台信任调用方 qty:校验 `qty>0 且 qty≤positionSize`,拒绝超额;硬性资金上限仍为 `stopLossMaxUsd` + 后台冷却共同兜底。
  - ✅ M1 重新武装过早:触发后**重置滚动窗口**(跌幅从触发价重新度量,避免同一崩盘反复触发)。
  - ✅ M2 剪枝假设时间戳单调:`pushPrice` 丢弃乱序/回拨样本。
  - ✅ L1 面板 NaN qty:守卫改为 `Number.isFinite`。
  - 无私钥/凭据泄漏;config clamp 边界安全。`check-stoploss.mjs` 增 M1/M2 覆盖,三自测+构建全过。
- 主功能 P0–P4 + P1.5 代码完成并均经"Codex 实现/Claude 实跑验收/Codex 独立审查/Claude 修复"闭环。剩:用户 Chrome 实测(P3 下单 dry-run→小额、P4 dry-run 触发)+ P6 打磨(含中英双语切换)。
- 2026-06-19:UI 全面重设计(量化终端风:折叠密集流+点击展开操作区,深/浅主题,红涨绿跌)落地——Phase 0~5 全部完成并逐阶段 Codex 交叉审查;CSS 重构为 tokens.css + base.css + 每组件 co-located,删除 1000 行单体 styles.css。新增:汇总条(总值/未实现/24h P&L via user-pnl-api 低频拉)、进度条双锚点算法、每仓目标倍数 N(独立 storage,debounce,不重连 WS)、手风琴单展开懒挂载、已结算蓝卡、页脚;AuthBar/Settings/盘口/挂单/交易/止损全部重做为滑块驱动。
- 2026-06-19:**交易后端从 `@polymarket/clob-client`(V1)迁到 `@polymarket/clob-client-v2`**——根因是 Polymarket 2026-04-28 升级 CLOB V2(EIP-712 域 v1→v2、新交易所地址、订单结构变),V1 订单被判 `invalid order version`。迁移完成(构造器对象化、createOrder+postOrder 统一四模式、删 feeRateBps/nonce),tsc+build 通过,Codex 复核 APPROVED。
- 2026-06-19:止损执行改进——**触发卖单加每仓可调滑点**(FAK 限价=bestBid×(1−滑点)向下取整扫单,确保急跌成交而非被 Kill;滑点滑块进止损 Tab);滚动窗口下限 1s、跌幅上限 50%;成交优先/止损均走 FAK。
- 2026-06-19:⛔ **实盘下单受阻(已记录,暂不解决)**:测试账户(邮箱/Magic)是 Polymarket **存款钱包(deposit wallet, ERC-1271)**,V2 需 `signatureType 3 (POLY_1271)` + ERC-7739 包裹 + L1 鉴权绑定存款钱包;而 `@polymarket/clob-client-v2`(含最新版/预发布)的 createApiKey 仍把 key 绑到 EOA、未做 1271 包裹(上游 bug #64/#65)→ 下单必被拒。两条并列解法:①等上游修复后把签名类型切 3;②迁到官方统一 SDK `@polymarket/client`(ts-sdk,createSecureClient 原生支持存款钱包,fetch/ox 浏览器友好)。**当前决策:插件只做监控+计算,暂不做实盘交易**(dryRun 默认 true,交易 UI/代码保留)。详见记忆 clob-v2-migration。
- 2026-06-19:**对照设计稿的 UI 细节打磨 + 涨跌配色切换**(用户逐项反馈,Claude 直接改;commits `7c1cd04`/`d58da70`/`f2501e2`)。
  - **交易按钮内联取价**:四个动作按钮主标题内联关键数值——价格优先 `{最优卖价}¢`、成交优先 `{最优买价}¢`、N 倍挂单 `{n}倍卖出{x}份`(x=滑块份额)、回收成本 `卖出{x}股回收{n}倍`(x 用 `computeNxCostQuantity` 整仓算)。目标倍数读数改 `N× → 目标价`。无副标题(用户定:数值进主标题)。
  - **卖出数量可键盘输入**:右上角股数改 `<input type=number>`,与卖出滑块双向联动(反推百分比,钳制 0–整仓)。
  - **目标倍数滑块封顶**:`maxReachableN = min(20, ⌊(1/均价)·10⌋/10)`(保证 N×均价 ≤ $1);引入单一 `effectiveMultiplier` 钳制,读数/渐变/标签/下单 payload 全部一致。⚠ 修复:`max` 必须保持 100(全尺度),否则拇指与金色填充错位——硬停由 `onChange` 同步钳制回弹实现(`setTargetMultiplier` 同步改内存、仅落盘 debounce)。
  - **封盘倍率 chip**:回本翻倍价行加蓝色 `封盘 N×`(=1/均价)。
  - **进度条封盘锚定**(`progressBar.ts`):把 `[entry,target]→[15%,70%]` 斜率外推到右端,若该价 > $1 则切「封盘锚定」——右端固定 100¢(PRICE_MAX)、`entry→$1` 铺满 `[15%,100%]`、黄线按真实比例右移;与原 70%-pinned 模型在边界处恰好连续(数值验证过)。
  - **涨跌配色 A股/美股切换**:新增语义令牌 `--c-gain/--c-loss` + `--t-gain/loss-*`(`tokens.css`,引用 `--c-up/--c-down` 故跟随深浅主题),`:root[data-color-style='us']` 翻转;`AppConfig.colorStyle: 'cn'|'us'`(默认 cn)+ App 设 `data-color-style` + SettingsBar 分段控件。**仅** pnl 驱动的 CSS(汇总条/YES·NO 徽章/盈亏%·额/进度条 fill·knob)改用 gain/loss;固定语义色(模拟徽章红、止损/启用绿、盘口买红卖绿、卖出红、撤单绿)不动。撤单按钮按用户要求改绿。
  - **交叉验证**:Codex 独立审查(不共享结论)抓出滑块封顶后读数/标签/payload 仍用未钳制 N → 已统一到 `effectiveMultiplier`;配色作用域、CSS 特异性、深浅主题下翻转均确认正确。
  - ⚠ **以上 UI 改动仅过 `tsc` + 数值验证,未在 Chrome 扩展内实跑**;待真机确认滑块拇指/填充对齐、高倍数进度条黄线右移。`npm run build` 另有一处**无关、预存**报错(`StopLossPanel.tsx` 未使用的 `DEFAULT_SLIP_PCT`,属止损滑点 UI 半成品,未触碰)。
- 2026-06-19:✅ **实盘下单打通(推翻 §289 的"暂不解决")并发布 v1.0.0**。
  - 真因不是上游 bug:`createApiKey` 绑 EOA 是官方设计(ts-sdk#73),早期失败是**签名类型写死成 `POLY_PROXY(1)`**。诊断脚本 `scripts/test-deposit-wallet.mjs`(按官方 deposit-wallets 文档,逐签名类型探测余额)确认本账户为 ERC-1271 存款钱包,**仅 `POLY_1271(3)` 能读余额/下单**;owner EOD = 导出私钥派生地址(非 TSS,可签)。funder = 个人资料页「仅供 API 使用」地址。
  - 改动:`clobClient.ts` signer 改 **viem walletClient**(与已验证路径一致)、`SIGNATURE_TYPE=POLY_1271`、私钥规范化;删 `ethers` 依赖、加 `viem`;`config.ts` **dryRun 默认 false(实盘)**;新增诊断/验证脚本(不进 dist)。
  - 验收:Codex 交叉审查(扩展代码 clean,修了脚本里 2 个阻塞项);**用户浏览器实测小额卖单成功**(止损未实测)。typecheck+build 全过。
  - 发布:合并 main、tag `v1.0.0`、GitHub Release 附 `polymarket-trade-v1.0.0.zip`(https://github.com/TT2TER/polymarket-trade/releases/tag/v1.0.0)。README 重写为终端用户上手指南。
  - ⚠ 实盘下单需**关代理直连**(issue #70:机房/VPN 出口 IP 会被挂单后约 10s 撤销)。

---

## 8. P7 决策辅助功能(2026-06-19 规划,产品视角)

> 背景:v1.0.0 后做产品规划。**核心判断**:本插件护城河是「**卖出/离场决策**」,不是「看盘」(看盘官网更强)。未来主线 = decision support → automation,不堆展示字段。**定位:前期纯自用,功能成熟后再考虑社区推广**(故账户类型自动识别/多账户/分发打磨等「为别人服务」的工作全部推迟到推广时再启动)。
>
> **明确不做**:① 买入功能(去和官网最强的发现/研究正面竞争;破坏「只会减仓」安全不变量;UI 复杂度高;USDC allowance 又是 1271 坑区;买入 judgment-heavy 工具帮不上)。② 云端化(摧毁「私钥仅本地、关浏览器即清」的信任模型)。③ 堆更多行情指标。

分支:`feat/p7-decision-tools`(从干净 main 切出,main 末尾含用户提交的渲染优化+逐档闪烁 `4449310`)。

### 优先实现(1–4,纯自用刚需,本阶段)
1. **价格走势 sparkline** — 每仓入场后迷你折线辅助卖出时机。**已定**:内存级、固定短窗口(~120 点,关面板重建);采样价 = `getBestBid(book)||curPrice`(与卡片 `currentPrice` 一致),在 store subscribe 回调**一帧一次**采样(不让每行各自 set,保住既有合帧);叠均价参考线;gain/loss 着色。
2. **成交历史 + 已实现盈亏** — 逐笔卖出流水 + 聚合已实现盈亏 + CSV 导出。`Position.realizedPnl` 已是 data-api 给的聚合值可直接用;逐笔流水需自记。**已定**:接 **user WS 成交频道对账,只记真实成交**(因价格优先/N 倍挂单是被动单,提交≠成交;需新增认证 user channel 订阅 + 订单状态对账)。落 `chrome.storage.local`(持久、封顶)。新增「流水」视图。⚠ 工作量最大(认证 WS)。
3. **到价提醒(被动,不自动交易)** — 复用止损那套每仓配置+面板监控循环逐 tick 评估,触发 `chrome.notifications`。条件:价≥X/≤Y、盈亏%≥/≤X、市值≥X。**已定**:默认一次性(触发即解除),提供「重复提醒」开关。
4. **封盘倒计时 / 临近结算高亮** — 解析 `Position.endDate`(已存在,零新接口)算剩余时间,折叠行 chip(<24h 黄 / <2h 红)。⚠ 命名坑:已有蓝色「封盘 N×」是**价格倍率**(=1/均价),与此**时间倒计时**无关,命名用「结算/倒计时」避免混淆。四项中最轻。

实现顺序(由轻到重):#4 → #1 → #3 → #2。工作流遵循 CLAUDE.md(Claude 出 spec,Codex 编码,双向交叉验证)。

### 后续计划(5–7,组合层升维,看仓位规模触发)
5. **风险敞口总览** — 按 event/outcome 聚合净敞口与集中度(单 event >40% 标红)。**零新数据纯展示,三者中性价比最高,真要先做这个**。防「隐性过度集中」(如同时押巴西夺冠 YES + 决赛巴西 YES,相关性高)。
6. **条件单 / OCO** — 把自动化从「只防急跌」补成完整离场策略(止盈括号 + 缓跌离场)。复用 WS 价格流 + placeSell + 每仓配置;引入「待触发指令」新状态(需 UI/生命周期管理)。
7. **批量/组合操作** — 一键平所有亏损仓 / 对所有盈利仓挂 N 倍止盈 / 范围批量撤单。价值取决于持仓数量,优先级由实际仓位规模触发。⚠ 批量动很多真钱,需独立「批量上限」护栏 + 逐条确认。

### 搁置(到「考虑社区推广」时再启动)
- 账户类型自动识别(`test-deposit-wallet.mjs` 探测逻辑是现成地基)、多账户/多钱包切换、分发打磨/引导。

### 实现进展(全自动:每功能 Codex 交叉验证 + 单独 commit)
- 2026-06-19:**#4 封盘倒计时 + #1 价格走势 sparkline 完成**(首个功能单元)。
  - #1:`priceHistory.ts`(事件驱动采样/同引用复用/封顶 120/裁剪)+ store 合帧回调一帧采样 + `Sparkline.tsx`(SVG 折线+均价虚线,viewBox+preserveAspectRatio=none + CSS width:100% **随面板宽度增长**)接进 L2。
  - #4:**修正数据源**——data-api 的 `endDate` 是纯日期/结算目标(实测可停在过去而市场仍交易),不可用;改 `gammaApi.ts` 低频按 conditionId 批量取 `gameStartTime`(单场开赛即停盘)`||endDate`(完整 ISO),store `marketMeta` + subscribe 回调去重补拉;`PositionRow` 倒计时 chip 改用之(命名避开「封盘 N×」价格倍率,用「结算」)。
  - Codex 交叉验证(3 项已修):MED gamma HTTP 错误码不重试→改抛错触发重试;MED 缺监控代次守卫→加 `monitorGeneration` 丢弃旧会话在途结果 + 失败 5s 退避;LOW startMonitoring 未清 `priceHistory`→已清。
  - 离线 sanity:settlementCountdown 边界、samplePriceHistory 同引用/封顶/裁剪、gamma 时间规范化(空格+无冒号偏移、+05:30、纯日期)全过;typecheck+build 通过。⚠ Chrome 内肉眼确认待用户。
- 2026-06-20:**#3 到价提醒完成**(被动通知,绝不下单)。
  - `priceAlertConfig.ts`(每仓阈值:价≥/≤、盈亏%≥/≤、市值≥;normalize/clamp;chrome.storage.local)、`alertMonitor.ts`(latch 防抖:跨越才触发、回落重新武装、一次性 disabledOneShot;价格缺失帧保留 runtime;非有限指标跳过)、store(priceAlertConfigs + load/setPriceAlert/clearAlertCondition + handleAlertTrigger 通知;复用 notifyDesktop)、`AlertPanel.tsx`(5 输入+repeat+enable)+ PositionOps 'alert' tab + App 启动加载 + i18n。
  - Codex 交叉验证(3 项已修):HIGH 同帧多个一次性触发并发清阈值竞态→改 `clearAlertCondition` 函数式 set 原子合并 + 持久化 get() 最新全量;MED 价格缺失帧裁剪 runtime 破坏 latch→在位持仓恒保留 runtime;LOW pnl NaN→非有限指标跳过。
  - 离线 sanity:latch 一次性/重复/重新武装语义全过;typecheck+build 通过。⚠ Chrome 触发通知待用户实测。
