/** 映射语义而非组件 CSS；结构尺寸和 Rhea 样式声明在两边完全相同。 */
export function archerReferenceTokens(
  read: (name: string) => string,
): Record<string, string> {
  return {
    background: read("canvas"),
    foreground: read("text"),
    card: read("surface-raised"),
    "card-foreground": read("text"),
    popover: read("surface-floating"),
    "popover-foreground": read("text"),
    primary: read("accent"),
    "primary-foreground": read("on-accent"),
    secondary: read("surface-subtle"),
    "secondary-foreground": read("text"),
    muted: read("surface-subtle"),
    "muted-foreground": read("muted"),
    accent: read("surface-hover"),
    "accent-foreground": read("text"),
    destructive: read("danger"),
    border: read("border-soft"),
    input: read("border-soft"),
    ring: read("state-focus"),
    "font-sans": read("font-family-ui"),
    "font-heading": read("font-family-ui"),
    "font-mono": read("font-family-code"),
  };
}
