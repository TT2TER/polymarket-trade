# 止损与离场系统 重构计划(A 方案:统一架构)

> 目标:解决"盈利仓被插针误割"等问题,同时**消除止损与 OCO 的重复**。
> 范围:Polymarket 体育市场(消息驱动、波动剧烈、盘口薄)。
> 明确**不解决**(物理上无解,靠仓位管理/对冲):单点结果归零(全场比分判死)、结算二元跳变。

---

## 0. 设计总纲

止损不是一个动作,而是两个独立决策:**触发判定**(何时认定该走)+ **执行**(怎么出不被宰)。
插针同时攻击两者:制造假触发 + 逼你在真空成交。现状"单档报价 + 单 tick + 从峰值算"三个最不抗针的选择全占了。

A 方案的核心:**按"主动 vs 反应"分工,固定价位的活儿归 OCO,止损只留动态部分,抗插针原语两者共享、只实现一次。**

---

## 1. 总体架构(3 层)

| 层 | 职责 | 文件 |
|---|---|---|
| **共享底层(新)** | 稳健参考价(中位数)、dwell 确认闸门、半自动执行 | `src/lib/exit/shared.ts`(新) |
| **OCO / 条件单** | 你**预先决定的固定价位**:止盈 / 硬离场。静态、主动。接入共享抗插针。 | `conditional*`(增强) |
| **StopLoss** | **自动、抗插针的动态保护**:激活式跟踪 + 保本地板 + 波动自适应 + 低价规则 + 速度自适应 dwell。反应式。 | `stoploss/*`(重写) |

数据流(每个行情 tick,面板合帧回调):
```
bestBid ─▶ [共享] 中位数参考价 ref
                 │
   ┌─────────────┴──────────────┐
   ▼                            ▼
 OCO 评估(固定价位)        StopLoss 评估(动态退出线)
   │ stopExit 接共享 dwell      │ 算阈值/锚点/退出线
   ▼                            ▼
   └──── [共享] dwell 确认 ──────┘
                 │
                 ▼
        [共享] 执行(全自动 或 半自动确认)→ 后台 placeSell
```

**删除的东西**(相比上一版):独立的"灾难线"和"保本快线"两条轨——它们合并进 StopLoss 的**单条退出线 + 速度自适应 dwell**;硬性固定地板交给 OCO stopExit。

---

## 2. 核心原理(逐组件:原理 + 公式 + 例子)

> 贯穿例子设定:足球盘「A 队胜」,**成本 cost = 0.20**(另有 0.05、0.25 两个专项例子见 §3)。

### 2.1 稳健参考价(共享)

**原理:** `bestBid` 只看最薄的最上一档,一两百股撤单就能瞬间跳水。取**近 K tick 中位数**,单根尖刺进不了中位数。

**公式:** `ref = median(recentBids[最近 refK])`,默认 `refK=5`。

**例子:** 最近 5 个 bestBid = `[0.76, 0.77, 0.62, 0.76, 0.77]`(0.62 是针)。
- 现状 `getBestBid=0.62` → 误触发。
- 改后 `median=0.76` → 针根本进不了参考价。✅

### 2.2 自适应阈值 threshold(p, σ)

**原理:** 阈值判相对跌幅。低价时相对噪声更大(阈值要更大);高波动期正常抖动更剧烈(阈值要更大)。

**公式:**
```
thr = clamp( baseThreshold · priceFactor(p) · volFactor(σ),  thMin,  thMax(p) )
priceFactor(p) = 1 + priceCoef·(1 − p)          // priceCoef=2.0   价位缩放
thMax(p)       = thMaxBase + thMaxSlope·(1 − p)  // 0.10 + 0.30·(1−p)   上限随低价放大(修 Q1)
volFactor(σ)   = clamp(σ_ambient / σ_ref, volMin, volMax)  // [0.8, 3.0]  波动自适应
σ_ambient      = EWMA(|Δref/ref|), 半衰期 ≈ 90s   // 用"环境波动"非瞬时
```

**关键陷阱:** σ 必须用**近 ~90s 环境波动**,不能用瞬时——否则进球那一下波动飙升会"自我放宽阈值、漏掉真事件"。波动带只防"高波动无方向的来回抽插",抓真趋势交给 §2.5 确认闸门。

**例子(p=0.78):**
| 情形 | σ 比值 | 计算 | thr |
|---|---|---|---|
| 平静 | 1.0 | 0.05×1.44×1.0 | **7.2%** |
| 临门高潮乱波 | 2.2 | 0.05×1.44×2.2 | **~11%**(未触上限) |

### 2.3 锚点:激活式跟踪 + 保本地板

**原理:** 现状"从峰值跌 X%"会把盈利仓高位回踩打掉。改成"**浮盈够厚才启用跟踪,且跟踪线永不低于成本**"。

**激活条件(两个都要满足,修 Q1 低价早激活):**
```
profit = (ref − cost) / cost
activated 当 profit ≥ max(activateProfitPct, kσ·σ_ambient)   // 余量盖过噪声; activateProfitPct=0.12, kσ=3
        且 (ref − cost) ≥ minAbsCushion                       // 绝对余量; =0.04
```

**例子:** cost 0.20,涨到 peak=0.78 → profit 290% → 激活。thr=7.2% → 跟踪线见 §2.4。

### 2.4 退出线(统一:取代灾难线/保本快线)

**原理:** 把"锁盈跟踪线 / 保本地板 / 最大亏损地板"合成**一条退出线**,按"是否已激活"切换;再用**速度自适应 dwell** 让深/快破位自动加速出场——这就替代了独立的灾难线。

**退出线公式:**
```
if activated:
    peak     = max(peak, ref)
    exitLine = max( peak·(1 − thr),  cost )          // 跟踪线, 但保本地板=成本(breakevenFloor)
else:
    exitLine = cost·(1 − maxLossPct)                 // 未激活/从未盈利仓的下行地板; maxLossPct=0.25
breach = ref < exitLine
```

**速度自适应 dwell:**
```
severity = f( 破位深度 (exitLine−ref)/exitLine,  下跌速度 |Δref|/Δt )
dwellEff = clamp( dwellMs·(1 − dwellVelocityScale·severity),  minDwellMs,  dwellMs )
// 浅破→4s(滤针);深/快破→趋近 minDwellMs≈600ms(灾难线效果, 无需单独一条轨)
```

**例子:**
- cost 0.20、peak 0.78、thr 7.2% → `exitLine = max(0.78×0.928, 0.20) = 0.724`(锁住大部分浮盈)。
- 行情阴跌,跟踪线随 peak 下移但**触到 0.20 不再降** → 盈利仓最坏保本,绝不转亏。✅
- 红牌秒崩到 0.30:深+快破 → dwellEff→~0.6s → 近即时出(灾难效果)。✅

### 2.5 确认闸门(dwell + 成交确认,共享)

**原理:** 真事件**持续**,插针**秒回弹**。要求破线**持续 dwellEff** 才确认;再叠加"这段时间有**真实成交**打在该价位"(真事件必伴成交,纯针常只撤挂)。

```
if breach && breachStart==0: breachStart = now
if !breach:                  breachStart = 0
confirmed = breach
         && now − breachStart ≥ dwellEff
         && (!requireTradeConfirm || 窗口内有成交 ≤ exitLine)   // Phase 2
```

**例子:** 针把 ref 短暂压到 0.70(<0.724)但 0.8s 回弹 → breachStart 刚置上又清零 → 到不了 dwell → 不触发。✅

### 2.6 低价退化规则

**原理:** 极低价处百分比退化(0.05→0.04 = 一个 tick = 20%)。**未涨起来前不用百分比跟踪,只用绝对地板。**

```
if peak < lowPriceFloor:           // =0.10; 仍是长尾, 从未实质上涨
    关闭百分比跟踪(不激活)
    exitLine = max( cost − cataAbsDrop,  cost·cataAbsMult )   // 绝对地板; cataAbsDrop=0.03, cataAbsMult=0.5
```

**例子:** cost 0.05,在 0.04~0.08 抖动,peak<0.10 → exitLine=max(0.02, 0.025)=**0.025** → 噪声永远打不到,不被斩;若 moon 到 0.30→peak>0.10→激活正常跟踪。✅

### 2.7 OCO 接入共享抗插针

**原理:** OCO 的 `stopExit` 腿现在是**单 tick 固定价**,**同样会被插针打掉**——不能只修止损不修它。给它接共享中位数参考 + 可选 dwell。

```
stopExit 触发 = ref(中位数) ≤ stopExitPrice  持续 ≥ stopExitDwellMs   // 新增 dwell, 默认 2000ms
takeProfit    = ref ≥ takeProfitPrice                               // 卖向强势, 默认无需 dwell
```
**分工:** OCO = 你主动设的固定价位(止盈 0.80 / 硬离场 0.40);StopLoss = 自动动态保护。两者不再重复。

### 2.8 半自动确认(共享执行层)

**原理:** 全自动反应快但无人把关;半自动让你一键确认,但人是瓶颈。**只挂"软"触发,最深的 maxLossPct 地板保持全自动。**

```
触发(软) → chrome 通知 + 一键"确认平仓" + confirmTtlMs 倒计时(默认 10s)
超时行为 onTimeout = 'execute'(fail-safe, 默认) | 'cancel'(fail-open)
```
OCO 与 StopLoss 都可独立开 `semiAutoMode`。

### 2.9 执行(stop-limit 地板 + 分批)

**原理:** 触发只是"决定走",成交看盘口。体育盘阶跃后有几秒真空,**stop-limit + 滑点地板**避免砸进真空底;**大单分批**避免自己砸穿薄盘。

```
limitPrice = max( ref·(1 − slippage),  板上可接受最低 )   // slippage=地板, 绝不无限扫
若 卖量 > 顶部 depthN 档深度 × depthFrac: 分批扫            // Phase 3; depthN=5, depthFrac=0.5
```
**例子:** 触发线 0.724,但进球后真空只有 0.50 买盘 → 不在 0.724 成交,而在地板内吃到 ~0.50。**触发价是决策点,成交价是市场给的**——真实损失锁死,止损只保证"出得来 + 不被宰到地板下"。

---

## 3. 贯穿例子:完整事件时间线

### 例 1:cost 0.20 主线
| t | 事件 | ref(中位数) | thr / exitLine | 行为 |
|---|---|---|---|---|
| T0 | 1:0 涨到 0.78 | 0.78 | 7.2% / 0.724 | 激活,锁盈线 0.724 |
| T1 | 插针 bestBid→0.62(1 tick) | **0.76** | 0.724 | ref 未破,**不动** ✅ |
| T2 | 临门高潮来回乱波 | 0.73~0.78 | σ↑→11% / 0.694 | 给呼吸空间,**不被抽插扫掉** ✅ |
| T3a | 真进球 1:1 跌 0.50 持续 | 0.50 | dwellEff~1s | 破线确认→**~0.50 出**,锁 +150% ✅ |
| T3b | (支线)红牌秒崩 0.30 | 0.30 | dwellEff~0.6s | 深+快破→**近即时出**(灾难效果) ✅ |

### 例 2:cost 0.20 从未盈利
买 0.20 一直没涨(peak≈0.21,profit 5%<12% 且绝对 0.01<0.04 → **未激活**)→ 跌到 0.15。
`exitLine = 0.20×(1−0.25) = 0.15` → ref≤0.15 破线→确认→**~0.15 出,最大亏损封顶 25%**。✅(取代旧"灾难线")

### 例 3:cost 0.05 长尾
peak 在 0.05~0.08 < lowPriceFloor 0.10 → 关百分比跟踪,`exitLine=max(0.02,0.025)=0.025` → 在 0.04~0.08 抖动**不被斩**;moon 到 0.30→激活正常跟踪。✅

### 例 4:cost 0.20 涨 0.25 后剧烈震荡(Q1)
涨 0.25→profit 25%>max(12%, kσσ) 且绝对 0.05≥0.04 → 激活,peak 0.25。
thr:priceFactor(0.22)=2.56,thMax(0.22)=0.334,高波动 → thr≈0.256。
`exitLine = max(0.25×(1−0.256), 0.20) = max(0.186, 0.20) = 0.20`(保本地板绑定)。
→ 在 0.20~0.25 之间波动 **不触发**(ref 须真跌破 0.20),只有真破保本才走。✅(thMax 随价位放大正是关键)

---

## 4. 数据模型

### 4.1 共享原语(`src/lib/exit/shared.ts`)
```ts
robustRef(books, recentBids, refK): number          // 中位数参考价
class DwellGate { breachStart; feed(breach, now, dwellEff): confirmed }
emaAbsRet(prev, ref, lastRef, halfLifeMs): number   // σ_ambient
class SemiAutoExecutor { request(details); confirm(); onTimeout }
```

### 4.2 StopLoss detector state(`detector.ts`)
```ts
interface StopLossDetectorState {
  recentBids: number[];     // 参考价
  peak: number;             // 跟踪峰值
  activated: boolean;       // 是否启用跟踪
  breachStart: number;      // dwell
  emaAbsRet: number;        // σ_ambient
  lastRefPrice: number;
  cooldownUntil: number;    // 沿用
  waitingForRearm: boolean; // 沿用
}
```

### 4.3 StopLossConfig(`stopLossConfig.ts`,per-position)
```ts
interface StopLossConfig {
  armed: boolean;
  refK: number;                                   // 5
  thresholdMode: 'fixed' | 'adaptive';            // 'adaptive'
  baseThreshold: number;                          // 0.05
  anchor: 'peak' | 'cost' | 'activated-trailing'; // 'activated-trailing'
  activateProfitPct: number;                      // 0.12
  minAbsCushion: number;                          // 0.04
  breakevenFloor: boolean;                        // true
  maxLossPct: number;                             // 0.25 (未激活下行地板)
  sellFraction: number;                           // 0.60 触发时卖出比例
  dwellMs: number;                                // 4000
  requireTradeConfirm: boolean;                   // true (Ph2)
  lowPriceFloor: number;                          // 0.10
  slippage: number | null;                        // 地板
  scaledExit: boolean;                            // true (Ph3)
  semiAutoMode: boolean;                           // false
}
```

### 4.4 ConditionalConfig(OCO)新增字段
```ts
  stopExitDwellMs: number | null;  // stopExit 抗插针确认, 默认 2000
  refK: number | null;             // 共享中位数窗口
  semiAutoMode: boolean;           // 半自动
```

### 4.5 模块级常数(代码内,一般不暴露 UI)
`priceCoef=2.0, thMin=0.04, thMaxBase=0.10, thMaxSlope=0.30, volMin=0.8, volMax=3.0, kσ=3,
dwellVelocityScale(severity→dwell 系数), minDwellMs=600, cataAbsDrop=0.03, cataAbsMult=0.5,
volEwmaHalfLifeMs=90000, sigmaRef=0.02, confirmTtlMs=10000, onTimeout='execute', depthN=5, depthFrac=0.5`

---

## 5. 完整超参数表(分层)

🔴 日常常调 ｜ 🟡 高级默认 ｜ ⚪ 内部常数

| 模块 | 参数 | 含义 | 默认 | 层级 |
|---|---|---|---|---|
| 参考价 | `refK` | 中位数窗口 tick 数 | 5 | 🟡 |
| 阈值 | `thresholdMode` | fixed/adaptive | adaptive | 🟡 |
|  | `baseThreshold` | 平静+中价基线阈值 | 0.05 | 🔴 |
|  | `priceCoef` | 价位缩放强度 | 2.0 | 🟡 |
|  | `thMin / thMaxBase / thMaxSlope` | 阈值上下限 | 0.04 / 0.10 / 0.30 | 🟡 |
|  | `volMin / volMax` | volFactor 夹值 | 0.8 / 3.0 | 🟡 |
|  | `volEwmaHalfLifeMs / sigmaRef` | 波动估计 | 90s / 0.02 | ⚪ |
| 锚点 | `anchor` | 止损风格 | activated-trailing | 🔴 |
|  | `activateProfitPct` | 启用跟踪所需浮盈 | 0.12 | 🔴 |
|  | `kσ` | 激活余量须 ≥ kσ×σ | 3 | 🟡 |
|  | `minAbsCushion` | 激活绝对浮盈 | 0.04 | 🟡 |
|  | `breakevenFloor` | 跟踪线以成本为地板 | true | 🔴 |
| 退出线 | `maxLossPct` | 未激活仓最大亏损地板 | 0.25 | 🔴 |
|  | `dwellMs` | 破线确认时长 | 4000 | 🔴 |
|  | `dwellVelocityScale / minDwellMs` | 速度自适应 dwell | —/600 | 🟡 |
|  | `requireTradeConfirm` | 是否要求成交确认 | true | 🟡 |
| 低价 | `lowPriceFloor` | 关百分比跟踪的价位 | 0.10 | 🔴 |
|  | `cataAbsDrop / cataAbsMult` | 低价绝对地板 | 0.03 / 0.5 | 🟡 |
| 执行 | `slippage` | 卖单限价地板 | 全局默认 | 🔴 |
|  | `scaledExit / depthN / depthFrac` | 大单分批 | true/5/0.5 | 🟡/⚪ |
| 半自动 | `semiAutoMode` | 触发需一键确认 | false | 🔴 |
|  | `confirmTtlMs / onTimeout` | 倒计时 / 超时行为 | 10s / execute | 🟡 |
| OCO | `stopExitDwellMs` | stopExit 抗插针 | 2000 | 🟡 |
| 沿用 | `windowMs / cooldownMs / stopLossMaxUsd` | 窗口/冷却/资金上限 | 30s/60s/— | 🟡 |

**总计 ≈ 26 个;🔴 日常真正常调 ~9 个**(`baseThreshold, anchor, activateProfitPct, breakevenFloor, maxLossPct, dwellMs, lowPriceFloor, slippage, semiAutoMode`)。全部 per-position 可配,未配吃默认 → 老仓位零配置即获新行为。

---

## 6. 代码改动清单

| 文件 | 改动 |
|---|---|
| `src/lib/exit/shared.ts`(新) | 中位数参考价、DwellGate、σ_ambient EWMA、SemiAutoExecutor |
| `src/lib/stoploss/detector.ts` | 重写 `evaluate`:参考价/自适应阈值/激活跟踪+保本地板/统一退出线/速度 dwell/低价规则;扩展 state |
| `src/lib/stoploss/monitor.ts` | 传入 `avgPrice`(cost)与成交流;参考价改用共享原语 |
| `src/shared/stopLossConfig.ts` | 新字段 + normalize clamp + 默认值 |
| `src/lib/conditional/conditionalMonitor.ts` | stopExit 接共享中位数 + dwell;takeProfit 接中位数 |
| `src/shared/conditionalConfig.ts` | 新增 `stopExitDwellMs / refK / semiAutoMode` |
| `src/sidepanel/store.ts` | 接 cost/成交到 monitor;接 SemiAutoExecutor;触发回调 |
| `src/background/index.ts` | `STOP_LOSS_SELL`/`CONDITIONAL_SELL`:slippage 明确为地板;分批(Ph3)。安全结构(nonce/冷却/上限/in-flight)不动 |
| `src/sidepanel/components/StopLossPanel.tsx` / `ConditionalPanel.tsx` | 新增 🔴 旋钮(基础)+ 🟡 折叠(高级);半自动确认 UI |

判定与下单的安全结构(nonce / 冷却 / 资金上限 / in-flight 锁)**全部保留**。

---

## 7. 分期与验收

- **Phase 1(堵本次坑,不依赖成交/全档):** 共享中位数参考 + dwell(定长)+ 激活跟踪+保本地板 + 价位缩放阈值 + maxLossPct 地板 + 低价规则 + OCO stopExit 接共享 dwell。
- **Phase 2:** 波动自适应阈值 + 成交确认 + 速度自适应 dwell + 半自动确认。
- **Phase 3:** 深度加权参考价 + 大单分批执行。

**验收(双重交叉,按 CLAUDE.md):**
1. **单测**:用 §3 四个例子做 fixture,逐 tick 断言(T1/T2 不触发、T3a 触发且成交≥cost、T3b 走速度 dwell、例2 封顶 25%、例3 噪声不斩、例4 保本不斩)。
2. **Claude `verify`**:dryRun 跑真实行情,确认插针不再误触发。
3. **Codex 独立审查**:不共享结论,重点查 dwell 状态机、激活/保本地板边界、退出线 regime 切换、低价退化、OCO/止损分工无重复、半自动 fail-safe。

---

## 8. 风险与回滚

- **更"迟钝"**:dwell 让真事件晚出 → 速度自适应 dwell + maxLossPct 地板兜底;体育盘等回补本就成交更好。
- **改动面更大**:动了 OCO(接共享原语)→ 抗插针只实现一次、长期无重复,值得。
- **参数错配**:全部 clamp + 默认;`thresholdMode='fixed'` + `anchor='peak'` 可一键近退回现状。
- **回滚**:按 Phase 逐步合并,每期独立 PR + dryRun 验证;共享原语先独立单测再接入。

---

## 9. UI 实现(决策:精简+全局 / 半自动=面板卡片+通知)

**原则:** 26 个参数不能每仓铺滑块。绝大多数是**全局默认**;每仓面板只留少量 + 强化"实时止损线读出"(可解释性 > 旋钮数)。

### 9.1 每仓面板(精简)
- 头部:标题 + 武装开关(沿用)。
- **模式下拉** `anchor`:`激活跟踪(锁盈+保本)` / `固定离场(成本下方)` / `峰值跟踪`。
- **两个上下文滑块(随模式变,只露相关旋钮):**
  - 激活跟踪 → `启用浮盈(activateProfitPct)` + `最大亏损(maxLossPct)`
  - 固定离场 → `离场跌%(从成本)`(=maxLossPct)
  - 峰值跟踪 → `跌%(从峰值)`(=threshold)
- **▸ 高级(用全局默认)** 折叠:每仓覆盖。字段默认显示全局值(灰),改即"覆盖(高亮)"并出 `↺ 跟随全局`。含 `refK / baseThreshold / dwellMs / 保本地板 / 低价线 / 成交确认 / 卖出% / 滑点% / 半自动`。
- **[更新]** + "面板开启时生效" 提示(沿用)。

### 9.2 ★ 实时止损线读出(核心升级)
- **止损线**(exitLine)、**现价**(ref 中位数)、**距离**=(ref−exitLine)/ref。
- **状态徽章:** 未激活 / 跟踪中 / 保本贴地 / 低价长尾 / 冷却中 / `确认中 N.Ns`(破线时 dwell 倒计时)。
- **配色:** >10% 绿、0~10% 黄、已破红闪。

### 9.3 全局设置页(完整参数)
`SettingsBar` 加折叠区「止损/离场默认」,按组放全部 🔴+🟡(参考价/阈值/锚点/确认/低价/执行/半自动)。每仓未覆盖即继承。新存储键 `stopLossDefaults`。

### 9.4 半自动确认卡片(新组件 `SemiAutoConfirm.tsx`)
触发软线时:store `onTrigger` 若 `semiAutoMode` → 不立即执行,生成 `pendingConfirm{asset,details,deadline}` → 顶部弹倒计时卡片(止损线/现价/拟卖量/[立即平仓][取消本次])+ `chrome.notifications.create`。
- `[立即平仓]` 或 超时(`onTimeout=execute`,fail-safe)→ `executeStopLoss`。
- `[取消本次]` 或 超时(cancel)→ 丢弃 + 重新武装。
- **最深的 `maxLossPct` 灾难地板始终全自动**(绕过半自动)。

### 9.5 OCO 面板平行
`ConditionalPanel` 复用"止损线读出"风格 + 同一张半自动卡片;`高级` 加 `stopExitDwell` 滑块。

### 9.6 UI 改动文件
`StopLossPanel.tsx`(重写)、新 `SemiAutoConfirm.tsx`(+css)、`SettingsBar.tsx`(止损默认区)、`ConditionalPanel.tsx`(平行)、`store.ts`(pendingConfirm + 半自动流 + 全局默认接线)、`i18n.ts`(新文案)、`shared/config.ts` 或新 `stopLossDefaults` 存储。
