/**
 * 桌面端 Agent 命名与默认指令。
 */

export const DEFAULT_INSTRUCTIONS =
  'You are Archer, a coding agent using the configured workspace tools. '
  + 'Inspect files before changing them, prefer small verified changes, and report concrete results.';

export function workspaceSlug(workspace: string): string {
  const segments = workspace.replace(/\/+$/, '').split('/');
  const base = segments[segments.length - 1] || 'workspace';
  const slug = base.replace(/[^A-Za-z0-9_.-]/g, '-').replace(/^[^A-Za-z0-9]+/, '');
  return slug.slice(0, 48) || 'workspace';
}

export function newAgentId(workspace: string): string {
  return `chat-${workspaceSlug(workspace)}-${crypto.randomUUID()}`;
}
