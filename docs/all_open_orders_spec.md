# Spec: 全局「所有挂单」面板 + 从 BatchBar 移除撤单

> 分支 `feat/all-open-orders`。两部分：(A) 新增顶层「所有挂单」面板，聚合全账户买/卖挂单、逐单撤销、全部撤销(真·全账户)；(B) 从 BatchBar 移除「撤所有挂单」，使其回归纯批量卖出。
> 已审约束沿用：失败响应不得当成功；无差别撤单需二次确认；无常驻轮询（沿用项目「去轮询」约定，仅在挂载/操作后拉取）。

---

## 设计决定（已与用户敲定，勿改）
1. **颜色**：买单 BUY = 蓝 `var(--c-blue)`；卖单 SELL = 琥珀 `var(--c-target)`。**刻意避开**红涨绿跌的盈亏色（`--c-up`/`--c-down`），防误读。
2. **市场标题**：用 `snapshot.positions` 构建 `asset_id → {title, outcome}` 映射；查得到显示标题+outcome，查不到（纯买单、无持仓的市场）降级显示 `outcome + 短id`（id 取 `asset_id` 前 6 + … + 后 4）。
3. **全部撤销**：走**真·全账户** `client.cancelAll()`（单次 API），**必须二次确认**。与 per-position 旧撤单互不替代。
4. **保留不动**：`PositionOps` 内的逐持仓 `OpenOrders` 组件、后台原 `CANCEL_ALL`（per-asset，仍被它使用）、store 的 `getOpenOrders(asset)` / `cancelOrder` / `cancelAll(asset)`。

---

## Part A — 新增「所有挂单」面板

### A1. 消息层 `src/shared/messages.ts`
新增请求类型并加入联合：
```ts
// 全账户撤单(破坏性):走 client.cancelAll(),与 per-asset 的 CANCEL_ALL 区分。
export interface CancelAllGlobalRequest {
  type: 'CANCEL_ALL_GLOBAL';
}
```
- 加入 `RuntimeMessage` 联合（现有联合在第 142 行起，`| CancelAllRequest` 之后追加 `| CancelAllGlobalRequest`）。
- 复用现有 `GetOpenOrdersRequest`（`asset?` 可选，不传即全账户）、`GetOpenOrdersOkResponse`、`TradingOkResponse`、`ErrorResponse`，**不要新增**这些。

### A2. 后台 `src/background/index.ts`
在 `CANCEL_ALL` case（约 438-451 行）之后、`default` 之前新增：
```ts
case 'CANCEL_ALL_GLOBAL': {
  void (async () => {
    try {
      const client = await getTradingClient();
      // 真·全账户撤单(破坏性):一次调用撤掉所有 open orders,含无持仓的纯买单。
      sendResponse({ ok: true, data: await client.cancelAll() });
    } catch (error) {
      sendResponse({ error: errorMessage(error) });
    }
  })();
  return true;
}
```
- `GET_OPEN_ORDERS` 不带 asset 的分支已存在（第 419 行 `message.asset ? { asset_id: message.asset } : undefined`），**无需改**。

### A3. Store `src/sidepanel/store.ts`
**状态**（接口里，挨着 `openOrders` / `orderErrors` 加；类型声明区与初始值区都要加）：
- 接口（约 82-83 行 `openOrders` / `orderErrors` 旁）：
  ```ts
  allOpenOrders: OpenOrder[];
  allOrdersError: string | null;
  ```
- 方法签名（约 117-119 行 `getOpenOrders`/`cancelOrder`/`cancelAll` 旁）：
  ```ts
  getAllOpenOrders: () => Promise<OpenOrder[]>;
  cancelAllGlobal: () => Promise<void>;
  ```
- 初始值（约 285-286 行 `openOrders: {}` / `orderErrors: {}` 旁）：
  ```ts
  allOpenOrders: [],
  allOrdersError: null,
  ```

**实现**（挨着现有 `getOpenOrders`/`cancelOrder`/`cancelAll`，约 817-849 行之后）：
```ts
getAllOpenOrders: async () => {
  const response = await sendRuntimeMessage<GetOpenOrdersOkResponse | ErrorResponse>({ type: 'GET_OPEN_ORDERS' });
  if ('error' in response) {
    set({ allOrdersError: response.error });
    throw new Error(response.error);
  }
  set({ allOpenOrders: response.data, allOrdersError: null });
  return response.data;
},

cancelAllGlobal: async () => {
  const response = await sendRuntimeMessage<TradingOkResponse | ErrorResponse>({ type: 'CANCEL_ALL_GLOBAL' });
  if ('error' in response) {
    set({ allOrdersError: response.error });
    throw new Error(response.error);
  }
  await get().getAllOpenOrders();
},
```
- 注意：单条撤销在新面板里复用现有 `cancelOrder`，但它第二参 asset 仅用于刷新 per-asset 列表 / 写 error key。新面板撤完单后应改为刷新全局：所以**面板内不要调用 `cancelOrder(asset, id)`**，而是直接发 `{ type: 'CANCEL_ORDER', orderID }` 再 `getAllOpenOrders()`——见 A4 的 `handleCancel`。（保持 store 既有 `cancelOrder` 不变。）

### A4. 组件 `src/sidepanel/components/AllOpenOrders.tsx`（新建）+ `AllOpenOrders.css`（新建）

**Props**：
```ts
interface AllOpenOrdersProps {
  positions: Position[]; // 来自 snapshot.positions,用于 asset→title 映射
}
```
（`Position` 从 `@/lib/types` 导入。）

**Store 选择子**：`allOpenOrders`、`allOrdersError`、`getAllOpenOrders`、`cancelAllGlobal`、`authStatus`。单条撤销直接用 `sendRuntimeMessage`——**不可** import 私有，组件应改为调用一个 store 暴露的方法。**为简洁**：在 store 再加一个 `cancelOrderGlobal: (orderID: string) => Promise<void>`（发 `CANCEL_ORDER` 然后 `getAllOpenOrders()`），并在 A3 一并实现/声明/初始化。组件只用 store 方法，不直接发消息。

> 修订 A3：新增第三个方法
> ```ts
> cancelOrderGlobal: async (orderID: string) => {
>   const response = await sendRuntimeMessage<TradingOkResponse | ErrorResponse>({ type: 'CANCEL_ORDER', orderID });
>   if ('error' in response) { set({ allOrdersError: response.error }); throw new Error(response.error); }
>   await get().getAllOpenOrders();
> },
> ```
> 接口签名 `cancelOrderGlobal: (orderID: string) => Promise<void>;` 一并加。

**行为**：
- `useEffect`：`authStatus.authenticated` 为真时 `void getAllOpenOrders()`。依赖 `[authStatus.authenticated, getAllOpenOrders]`。**无轮询**。
- 渲染条件：`if (allOpenOrders.length === 0 && !allOrdersError) return null;`（与 OpenOrders 一致，无单时整块不显示）。
- 顶栏：标题 `t('allOpenOrders.title') · {allOpenOrders.length}`、「↻ 刷新」按钮（点→`getAllOpenOrders()`）、「全部撤销」危险按钮（点→进入二次确认态，不直接撤）。
- 错误：`allOrdersError` 用 `<p className="pq-form-error">` 显示。
- **分组**：按 `order.side` 分 `BUY` / `SELL` 两组（side 是字符串，做大小写无关比较：`order.side.toUpperCase() === 'BUY'`）。每组标题带「单数 · ≈金额」小计，金额 = Σ `remaining × price`。空组不渲染该组。
- 组内排序：按 `created_at` 降序（新→旧）。
- 每条订单卡：
  - 主行：`{remainingSize} @ {price.toFixed(3)} ≈ ${(remaining*price).toFixed(2)}`
  - 市场行：`title · outcome`（查得到）或 `{shortId} · {outcome}`（查不到 title）。`shortId = asset_id.slice(0,6)+'…'+asset_id.slice(-4)`。
  - meta：`order.order_type · order.status`；若 `original_size>0` 显示成交进度 `Math.round(matched/original*100)%`。
  - 右侧单条「撤销」按钮 → `cancelOrderGlobal(order.id)`，撤销中禁用全部按钮。
- **二次确认态**（局部 `useState<boolean> confirming`）：点「全部撤销」置 true，渲染一个红框确认条（`t('allOpenOrders.confirmCancelAll', { count })`，count=总单数）+「取消」/「确认全部撤销」。确认→`cancelAllGlobal()`，期间 busy；完成或失败后退出确认态。**不弹独立 modal**，就地在面板顶部插入确认条即可（与预览状态B一致）。
- busy 管理：单个 `busy` 状态（`'all' | string(orderID) | null`）。任一操作进行时禁用所有按钮（参考 OpenOrders.tsx 的 `busyOrder` 写法）。

**辅助函数**（可从 OpenOrders.tsx 复制）：`formatPrice`、`remainingSize`（`original_size - size_matched`，clamp≥0）。

**asset→title 映射**：
```ts
const titleMap = useMemo(() => {
  const m = new Map<string, { title: string; outcome: string }>();
  for (const p of positions) m.set(p.asset, { title: p.title, outcome: p.outcome });
  return m;
}, [positions]);
```

**CSS**：新建 `AllOpenOrders.css`，视觉对齐已交付的预览 `mockups/all-open-orders.html`（该文件在 main 工作区，不在本分支；可参考其中 class 名与配色：`.pq-allorders`、买单蓝左条/卖单琥珀左条、`.tag--buy`/`.tag--sell`、确认条 `.confirm`）。复用现有 token 变量（`--c-surface/-cell/-border/-text/-muted2/-blue/-target/-up/-down`、`--font-mono`、`--pq-radius-*`）。可大量借鉴 `OpenOrders.css` 的卡片样式。

### A5. 挂载 `src/sidepanel/App.tsx`
- import：`import { AllOpenOrders } from './components/AllOpenOrders';`
- 渲染位置：在 `<BatchBar .../>`（第 170 行）**之前**插入：
  ```tsx
  <AllOpenOrders positions={snapshot?.positions ?? []} />
  ```
  （即持仓列表上方、批量栏上方；仅在 `hasAddress` 的分支内，已处于该分支。）

### A6. i18n `src/shared/i18n.ts`
在 `openOrders.*` 块（321-325 行）后新增：
```ts
'allOpenOrders.title': { zh: '所有挂单', en: 'All open orders' },
'allOpenOrders.buys': { zh: '买单 BUY', en: 'Buys' },
'allOpenOrders.sells': { zh: '卖单 SELL', en: 'Sells' },
'allOpenOrders.refresh': { zh: '↻ 刷新', en: '↻ Refresh' },
'allOpenOrders.cancelAll': { zh: '全部撤销', en: 'Cancel all' },
'allOpenOrders.confirmCancelAll': { zh: '撤销全账户全部 {count} 笔挂单?此操作不可撤回。', en: 'Cancel all {count} open orders account-wide? This cannot be undone.' },
'allOpenOrders.confirmYes': { zh: '确认全部撤销', en: 'Confirm cancel all' },
'allOpenOrders.cancel': { zh: '取消', en: 'Cancel' },
'allOpenOrders.canceling': { zh: '撤销中…', en: 'Canceling…' },
'allOpenOrders.fillPct': { zh: '{pct}% 成交', en: '{pct}% filled' },
'allOpenOrders.groupSummary': { zh: '{count} 单 · ≈ ${amount}', en: '{count} · ≈ ${amount}' },
```

---

## Part B — 从 BatchBar 移除「撤所有挂单」

文件 `src/sidepanel/components/BatchBar.tsx`：
1. `type BatchKind = 'closeLosing' | 'tpWinning' | 'cancelAll';` → 去掉 `'cancelAll'`，变 `'closeLosing' | 'tpWinning'`。
2. 删除 store 依赖 `const cancelAll = useMonitorStore((state) => state.cancelAll);`（第 56 行）。
3. 删除 `startCancelAll()` 函数（138-147 行）。
4. 删除第三个按钮 `batch.cancelAll`（226-228 行整段 `<button ... pq-batch__btn--cancel ...>`）。
5. `confirmBatch()` 内删除 `kind === 'cancelAll'` 分支（168-176 行的 `if (kind === 'cancelAll') { for (...) cancelAll(...) } else { ... }`），改为只保留原 `else` 体（卖出腿循环）。注意上方 `if (kind !== 'cancelAll' && totalEst > ...)`（158 行）与按钮 disabled 里的 `kind !== 'cancelAll'`（277 行）→ 既然不再有 cancelAll，简化为直接判断 `totalEst > cap` / `capExceeded || executableLegs.length === 0`。
6. 确认弹窗里 `kind === 'cancelAll' ? <cancelAllConfirm> : <legs...>`（238-269 行）→ 去掉三元，直接渲染 legs 分支。
7. CSS `BatchBar.css`：删除 `.pq-batch__btn--cancel` 规则（若有）。

i18n `src/shared/i18n.ts`：删除 `'batch.cancelAll'`（81 行）与 `'batch.cancelAllConfirm'`（85 行）两键。确认全局无其它引用（grep `batch.cancelAll`）。

---

## 验收标准（spec 完成判据）
- [ ] `npx tsc -p tsconfig.app.json --noEmit` 通过（无类型错误）。
- [ ] `npm run build`（或现有 lint）通过。
- [ ] grep 全仓 `batch.cancelAll`、`startCancelAll`、`pq-batch__btn--cancel` 均无残留引用。
- [ ] grep `CANCEL_ALL_GLOBAL` 在 messages/background/store 三处一致。
- [ ] BatchBar 仅剩 2 个动作按钮；其确认弹窗仅卖出腿路径。
- [ ] 新面板：未认证或无挂单时不渲染；买/卖分组、逐单撤销、全部撤销二次确认齐备；无 setInterval/轮询。
- [ ] 颜色用 `--c-blue`(买)/`--c-target`(卖)，未用 `--c-up`/`--c-down` 表示买卖方向。

## 边界 / 注意
- `OpenOrder.side` 是 `string`，不是枚举——大小写无关比较。
- `price`/`original_size`/`size_matched` 都是字符串，`Number()` 后用，非有限值要兜底。
- 撤单/全撤后必须重新 `getAllOpenOrders()` 刷新，不可乐观本地删。
- 失败响应（`'error' in response`）必须抛出并展示，不可静默当成功。
- 不要改动 `PositionOps` / `OpenOrders.tsx` / 后台 `CANCEL_ALL` / store 既有 `cancelAll(asset)`。
