/** 自动审批只匹配封闭的完整命令，不解释 Shell 语法，也不按黑名单推测安全。 */
export function commandText(payload: unknown): string {
  return typeof payload === 'string' ? payload.trim() : payload && typeof payload === 'object' && !Array.isArray(payload) && 'command' in payload && typeof payload.command === 'string' ? payload.command.trim() : '';
}

/** 不放行 PATH 查找的外部程序、参数扩展、重定向、组合命令或工作区脚本。 */
export function automaticallyApproved(payload: unknown, platform: string): boolean {
  if (platform !== 'darwin' && platform !== 'linux') return false;
  const command = commandText(payload);
  return /^(?:pwd(?: -[LP])?|\/bin\/pwd(?: -[LP])?|\/bin\/ls(?: -(?:l|a|la|al|lah|alh))?(?: \.)?|true|false|:)$/.test(command)
    || /^echo [a-zA-Z0-9 ._/-]+$/.test(command);
}
