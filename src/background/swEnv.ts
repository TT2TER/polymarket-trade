/**
 * Service Worker 环境垫片 —— 必须在任何 clob-client / ethers 相关导入之前求值。
 *
 * 背景:`@polymarket/clob-client` 经 `browser-or-node` 判断运行环境,其 `isBrowser`
 * 依赖 `window.document` 是否存在。MV3 service worker 没有 `window`,会被判成 Node,
 * 进而注入浏览器 fetch 禁止的 Node 风格请求头(User-Agent / Connection / Accept-Encoding),
 * 导致鉴权请求被剥离头或 400 失败。
 *
 * 这里把 `window` 指向 `globalThis` 并补一个空 `document`,使 `isBrowser` 为真,
 * 走浏览器分支(fetch + 合法请求头)。ethers v5 对 window 的访问都包在 try/catch 中,
 * 不受影响。仅在 SW 上下文导入,不影响有真实 window 的 side panel。
 *
 * ⚠ 该垫片解决的是运行时行为,需加载到 Chrome 后实测 `createOrDeriveApiKey` 确认生效。
 */
const globalScope = globalThis as unknown as { window?: unknown; document?: unknown };

if (typeof globalScope.window === 'undefined') {
  globalScope.window = globalThis;
}

const win = globalScope.window as { document?: unknown };
if (typeof win.document === 'undefined') {
  win.document = {};
}

export {};
