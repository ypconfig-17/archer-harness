import { describe, expect, it } from "vitest";
import {
  isReferenceConfig,
  tokenNames,
} from "../../apps/desktop/renderer/src/ui/ai-ui/playground/reference/protocol";
import { archerReferenceTokens } from "../../apps/desktop/renderer/src/ui/ai-ui/playground/reference/tokens";

describe("官方对照样板的主题边界", () => {
  it("只接收已知外观、状态与主题字段，不允许覆盖组件尺寸", () => {
    const config = {
      type: "archer-reference-config",
      appearance: "dark",
      state: "running",
      tokens: { primary: "#6655aa" },
    };
    expect(isReferenceConfig(config)).toBe(true);
    expect(isReferenceConfig({ ...config, tokens: { radius: "30px" } })).toBe(
      false,
    );
    expect(isReferenceConfig({ ...config, state: "invented" })).toBe(false);
    expect(isReferenceConfig({ ...config, appearance: "invented" })).toBe(
      false,
    );
    expect(isReferenceConfig(null)).toBe(false);
  });

  it("品牌色用于主操作，普通悬停、边框与输入仍使用中性色", () => {
    const tokens = archerReferenceTokens((name) => `source:${name}`);
    expect(tokens.primary).toBe("source:accent");
    expect(tokens.accent).toBe("source:surface-hover");
    expect(tokens.input).toBe("source:border-soft");
    expect(tokens["primary-foreground"]).toBe("source:on-accent");
    expect(tokens["font-mono"]).toBe("source:font-family-code");
    expect(Object.keys(tokens).sort()).toEqual([...tokenNames].sort());
  });
});
