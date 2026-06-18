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

最近更新:2026-06-17 — 完成需求确认,开始 P0。

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
