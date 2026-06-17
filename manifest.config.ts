import { defineManifest } from '@crxjs/vite-plugin';
import pkg from './package.json';

export default defineManifest({
  manifest_version: 3,
  name: 'Polymarket 持仓助手',
  version: pkg.version,
  description: pkg.description,
  action: {
    default_title: 'Polymarket 持仓助手',
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module',
  },
  side_panel: {
    default_path: 'src/sidepanel/index.html',
  },
  permissions: ['storage', 'sidePanel', 'notifications', 'alarms'],
  // 注:wss 不属于 MV3 host_permissions 的合法 scheme 白名单;service worker
  // 发起的 WebSocket 连接不受 host_permissions / 页面 CSP 约束,故无需在此声明。
  host_permissions: [
    'https://clob.polymarket.com/*',
    'https://data-api.polymarket.com/*',
    'https://gamma-api.polymarket.com/*',
  ],
});
