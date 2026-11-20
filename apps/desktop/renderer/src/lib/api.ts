/** 桌面界面只通过 Client 使用主进程注入的服务地址，令牌由主进程附加。 */
import { ArcherClient } from '@archer/client';

export const client = new ArcherClient({
  baseUrl: window.archerDesktop?.apiUrl ?? '',
});
