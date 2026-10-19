import { expect, test } from "bun:test";
import tokens from "../docs/design-system/themes.json";
import { themeCSS } from "../src/lib/design-tokens";
const luminance = (hex: string) => {
  const channels = hex
    .slice(1)
    .match(/../g)!
    .map((value) => parseInt(value, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    );
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
};
const contrast = (a: string, b: string) => {
  const [high, low] = [luminance(a), luminance(b)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
};
test("both Orange modes preserve readable foreground pairs and focus on all declared surfaces", () => {
  for (const values of Object.values(tokens.schemes[0].modes)) {
    const colors = values as Record<string, string>;
    expect(colors["action.primary"]).toBe("#ff7518");
    for (const surface of [
      "surface.canvas",
      "surface.panel",
      "surface.subtle",
      "surface.hover",
      "selection.background",
    ]) {
      for (const text of ["text.primary", "text.secondary", "text.accent"])
        expect(contrast(colors[text], colors[surface])).toBeGreaterThanOrEqual(
          4.5,
        );
      for (const indicator of [
        "border.control",
        "focus.ring",
        "graph.lane.1",
        "graph.lane.2",
        "graph.lane.3",
        "graph.lane.4",
      ])
        expect(
          contrast(colors[indicator], colors[surface]),
        ).toBeGreaterThanOrEqual(3);
    }
    for (const fill of [
      "action.primary",
      "action.primary.hover",
      "action.primary.active",
    ])
      expect(
        contrast(colors["action.onPrimary"], colors[fill]),
      ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(colors["selection.text"], colors["selection.background"]),
    ).toBeGreaterThanOrEqual(4.5);
    for (const role of [
      "git.add",
      "git.delete",
      "status.success",
      "status.warning",
      "status.error",
      "status.info",
    ])
      expect(
        contrast(colors[role + ".text"], colors[role + ".background"]),
      ).toBeGreaterThanOrEqual(4.5);
  }
});
test("token CSS resolves both modes and shared density/font variables before app startup", () => {
  const css = themeCSS();
  expect(css).toContain("--size-historyRow:32px");
  expect(css).toContain('--font-mono:"Cascadia Code"');
  expect(css).toContain(".dark{");
  expect(css).toContain("color-scheme:dark");
  expect(css.match(/--action-primary:#ff7518;/g)?.length).toBe(2);
});
