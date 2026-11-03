import { expect, test } from "bun:test";
import { relativeTime } from "@/lib/relative-time";

test("relative time handles past, future, and invalid dates", () => {
  const now = Date.UTC(2026, 10, 3, 12);
  expect(relativeTime(now / 1000 - 7200, now)).toContain("2");
  expect(relativeTime(now / 1000 - 7200, now)).toContain("ago");
  expect(relativeTime(now / 1000 + 7200, now)).toContain("in");
  expect(relativeTime(NaN, now)).toBe("Unknown date");
});
