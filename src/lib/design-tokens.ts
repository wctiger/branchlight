import tokens from "../styles/tokens.json" with { type: "json" };

export const foundations = tokens.foundations;
export const historyRowHeight = Number.parseInt(
  foundations["size.historyRow"],
  10,
);
const cssName = (name: string) => `--${name.replace(/\./g, "-")}`;
/** Resolve the checked-in token source at build/dev time, without a runtime fetch. */
export function themeCSS(): string {
  const declarations = (values: Record<string, string>) =>
    Object.entries(values)
      .map(([name, value]) => `${cssName(name)}:${value};`)
      .join("");
  const modes = tokens.schemes[0].modes;
  return `:root{${declarations(foundations)}${declarations(modes.light)}color-scheme:light}.dark{${declarations(modes.dark)}color-scheme:dark}`;
}
