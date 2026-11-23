/** 按服务与项目绝对目录 保存本机默认选择；每次发送仍显式提交命令授权。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CommandMode } from '@archer/contracts';
const serviceKey = window.archerDesktop?.serviceKey || window.location.origin;
interface ProjectPreferences {
  commandModes: Record<string, CommandMode>;
  setCommandMode(workspace: string, mode: CommandMode): void;
}
export const useProjectPreferences = create<ProjectPreferences>()(persist(set => ({
  commandModes: {},
  setCommandMode: (workspace, mode) => set(state => ({ commandModes: { ...state.commandModes, [workspace]: mode } })),
}), {
  name: `archer-project-preferences:${serviceKey}`,
  merge: (persisted, current) => {
    const saved = (persisted as Partial<ProjectPreferences> | undefined)?.commandModes;
    const commandModes = Object.fromEntries(Object.entries(saved ?? {}).filter(([, mode]) => mode === 'ask' || mode === 'auto' || mode === 'full')) as Record<string, CommandMode>;
    return { ...current, commandModes };
  },
}));
