import {
  DEFAULT_APPEARANCE,
  DEFAULT_BASE_THEME,
  DEFAULT_COLOR_THEME,
  DEFAULT_CUSTOM_ACCENT,
  isBaseTheme,
  isColorTheme,
  normalizeHex,
  type Appearance,
  type BaseTheme,
  type ColorTheme,
} from '../ui/theme/theme';
import {
  DEFAULT_CONTEXT_PROFILE_ID,
  ReasoningLevelSchema,
  cloneContextProfile,
  isBuiltinContextProfile,
  validateContextProfile,
  type ContextProfile,
  type ReasoningLevel,
} from '@archer/contracts';
/** 浏览器只保存外观和选择偏好，不保存凭据或会话事实。 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
export type WorkspaceAccess = 'read' | 'edit';
export type FontSize = 'small' | 'medium' | 'large';
export type StartupPage = 'last' | 'new';
export type SettingsSection = 'general' | 'context' | 'sessions' | 'projects' | 'models' | 'providers' | 'appearance' | 'shortcuts' | 'about';
interface Preferences {
  /** 自定义 Profile 与内置模板分开保存；内置模板只读，修改时先复制。 */
  customContextProfiles: ContextProfile[];
  activeContextProfileId: string;
  tokenBudget: number | null;
  saveContextProfile(profile: ContextProfile): void;
  selectContextProfile(id: string): void;
  deleteContextProfile(id: string): void;
  setTokenBudget(tokenBudget: number | null): void;
  appearance: Appearance;
  baseTheme: BaseTheme;
  colorTheme: ColorTheme;
  customAccent: string;
  fontSize: FontSize;
  model: string;
  reasoningByModel: Record<string, ReasoningLevel>;
  workspaceAccess: WorkspaceAccess;
  startup: StartupPage;
  codeHighlight: boolean;
  lineNumbers: boolean;
  settings: boolean;
  settingsSection: SettingsSection;
  setAppearance(appearance: Appearance): void;
  setBaseTheme(baseTheme: BaseTheme): void;
  setColorTheme(colorTheme: ColorTheme): void;
  setCustomAccent(customAccent: string): void;
  resetAppearance(): void;
  setFontSize(fontSize: FontSize): void;
  setModel(model: string): void;
  setReasoning(model: string, level: ReasoningLevel): void;
  setWorkspaceAccess(access: WorkspaceAccess): void;
  setStartup(startup: StartupPage): void;
  setCodeHighlight(enabled: boolean): void;
  setLineNumbers(enabled: boolean): void;
  openSettings(settings: boolean, section?: SettingsSection): void;
}

/** 复制一份自定义副本；保存后才会成为默认配置。 */
export function copyContextProfile(source: ContextProfile): ContextProfile {
  const copy = cloneContextProfile(source);
  copy.id = `custom-${crypto.randomUUID().slice(0, 8)}`;
  copy.name = `${source.name} 副本`.slice(0, 80);
  copy.revision = 1;
  return copy;
}

export const usePreferences = create<Preferences>()(persist(set => ({
  customContextProfiles: [],
  activeContextProfileId: DEFAULT_CONTEXT_PROFILE_ID,
  tokenBudget: null,
  saveContextProfile: profile => {
    if (isBuiltinContextProfile(profile.id)) throw new Error('内置模板只读，请先复制为自定义 Profile');
    const issues = validateContextProfile(profile);
    if (issues.length > 0) throw new Error(issues[0]!.message);
    set(state => {
      const existing = state.customContextProfiles.find(item => item.id === profile.id);
      const saved = { ...cloneContextProfile(profile), revision: existing ? existing.revision + 1 : 1 };
      return {
        customContextProfiles: existing
          ? state.customContextProfiles.map(item => item.id === saved.id ? saved : item)
          : [...state.customContextProfiles, saved],
        activeContextProfileId: saved.id,
      };
    });
  },
  selectContextProfile: id => set(state => {
    const known = id === DEFAULT_CONTEXT_PROFILE_ID || isBuiltinContextProfile(id)
      || state.customContextProfiles.some(profile => profile.id === id);
    if (!known) throw new Error('未知的上下文 Profile');
    return { activeContextProfileId: id };
  }),
  deleteContextProfile: id => set(state => ({
    customContextProfiles: state.customContextProfiles.filter(profile => profile.id !== id),
    activeContextProfileId: state.activeContextProfileId === id ? DEFAULT_CONTEXT_PROFILE_ID : state.activeContextProfileId,
  })),
  setTokenBudget: tokenBudget => {
    if (tokenBudget !== null && (!Number.isSafeInteger(tokenBudget) || tokenBudget <= 0)) throw new Error('任务预算必须为正整数');
    set({ tokenBudget });
  },
  appearance: DEFAULT_APPEARANCE,
  baseTheme: DEFAULT_BASE_THEME,
  colorTheme: DEFAULT_COLOR_THEME,
  customAccent: DEFAULT_CUSTOM_ACCENT,
  fontSize: 'medium',
  model: '',
  reasoningByModel: {},
  workspaceAccess: 'edit',
  startup: 'last',
  codeHighlight: true,
  lineNumbers: false,
  settings: false,
  settingsSection: 'general',
  setAppearance: appearance => set({ appearance }),
  setBaseTheme: baseTheme => set({ baseTheme }),
  setColorTheme: colorTheme => set({ colorTheme }),
  setCustomAccent: customAccent => {
    const hex = normalizeHex(customAccent);
    if (!hex) throw new Error('请输入有效的十六进制颜色');
    set({ customAccent: hex, colorTheme: 'custom' });
  },
  resetAppearance: () => set({
    appearance: DEFAULT_APPEARANCE,
    baseTheme: DEFAULT_BASE_THEME,
    colorTheme: DEFAULT_COLOR_THEME,
    customAccent: DEFAULT_CUSTOM_ACCENT,
  }),
  setFontSize: fontSize => set({ fontSize }),
  setModel: model => set({ model }),
  setReasoning: (model, level) => set(state => ({
    reasoningByModel: { ...state.reasoningByModel, [model]: level },
  })),
  setWorkspaceAccess: workspaceAccess => set({ workspaceAccess }),
  setStartup: startup => set({ startup }),
  setCodeHighlight: codeHighlight => set({ codeHighlight }),
  setLineNumbers: lineNumbers => set({ lineNumbers }),
  openSettings: (settings, section) => set({ settings, settingsSection: section ?? 'general' }),
}), {
  name: 'archer-preferences',
  partialize: ({ customContextProfiles, activeContextProfileId, tokenBudget, appearance, baseTheme, colorTheme, customAccent, fontSize, model, reasoningByModel, workspaceAccess, startup, codeHighlight, lineNumbers }) => ({
    customContextProfiles, activeContextProfileId, tokenBudget, appearance, baseTheme, colorTheme, customAccent, fontSize, model, reasoningByModel, workspaceAccess, startup, codeHighlight, lineNumbers,
  }),
  // 持久化配置只读取当前字段；无效或引用内置标识的自定义项直接丢弃，不静默改动语义。
  merge: (persisted, current) => {
    const saved = persisted as Partial<Preferences> | undefined;
    const seen = new Set<string>();
    const customContextProfiles: ContextProfile[] = [];
    for (const profile of Array.isArray(saved?.customContextProfiles) ? saved.customContextProfiles : []) {
      if (typeof profile?.id !== 'string' || isBuiltinContextProfile(profile.id) || seen.has(profile.id)) continue;
      if (validateContextProfile(profile).length > 0) continue;
      seen.add(profile.id);
      customContextProfiles.push(profile as ContextProfile);
    }
    const active = typeof saved?.activeContextProfileId === 'string'
      && (isBuiltinContextProfile(saved.activeContextProfileId) || customContextProfiles.some(profile => profile.id === saved.activeContextProfileId))
      ? saved.activeContextProfileId : DEFAULT_CONTEXT_PROFILE_ID;
    return { ...current,
      customContextProfiles,
      activeContextProfileId: active,
      tokenBudget: Number.isSafeInteger(saved?.tokenBudget) && saved!.tokenBudget! > 0 ? saved!.tokenBudget! : null,
      appearance: saved?.appearance === 'light' || saved?.appearance === 'dark' || saved?.appearance === 'system'
        ? saved.appearance
        : DEFAULT_APPEARANCE,
      baseTheme: isBaseTheme(saved?.baseTheme) ? saved.baseTheme : DEFAULT_BASE_THEME,
      colorTheme: isColorTheme(saved?.colorTheme) ? saved.colorTheme : DEFAULT_COLOR_THEME,
      customAccent: typeof saved?.customAccent === 'string'
        ? normalizeHex(saved.customAccent) ?? DEFAULT_CUSTOM_ACCENT
        : DEFAULT_CUSTOM_ACCENT,
      fontSize: saved?.fontSize === 'small' || saved?.fontSize === 'large' ? saved.fontSize : 'medium',
      model: typeof saved?.model === 'string' ? saved.model : '',
      reasoningByModel: Object.fromEntries(Object.entries(saved?.reasoningByModel ?? {}).filter(([, level]) => ReasoningLevelSchema.safeParse(level).success)),
      workspaceAccess: saved?.workspaceAccess === 'read' ? 'read' : 'edit',
      startup: saved?.startup === 'new' ? 'new' : 'last',
      codeHighlight: saved?.codeHighlight !== false,
      lineNumbers: saved?.lineNumbers === true,
    };
  },
}));
