/** 只搜索静态分类与设置项名称，不索引输入值、密钥或服务器内容。 */
const KEYWORDS: Record<string, string> = {
  general: '工作区 默认目录 模型 文件访问 权限 读取 编辑 启动 语言 自动保存',
  appearance: '浅色 深色 系统 主题 字体 字号 代码高亮 行号',
  shortcuts: '快捷键 键盘 shortcut',
  models: '模型 供应商 服务商 Provider API Key 密钥 连接 地址',
  context: '上下文 压缩 摘要 策略 预算 Token Profile',
  providers: '能力 来源 工具 技能 契约 Provider',
  sessions: '对话 历史 记录 搜索 删除',
  projects: '工作区 文件夹 项目 目录',
  about: '版本 服务 连接 关于',
};

export function settingsMatches(section: { key: string; label: string; description: string }, query: string): boolean {
  const text = `${section.label} ${section.description} ${KEYWORDS[section.key] ?? ''}`.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(word => text.includes(word));
}
