import { describe, expect, test } from "bun:test";
import { gapBetween, insetDistances, isOnScale, type Rect } from "./measure.js";

const rect = (x: number, y: number, w: number, h: number): Rect => ({
  left: x,
  top: y,
  right: x + w,
  bottom: y + h,
  width: w,
  height: h,
});

describe("insetDistances — child measured against parent edges", () => {
  test("symmetric padding", () => {
    const parent = rect(100, 100, 400, 200);
    const child = rect(124, 116, 352, 168);
    expect(insetDistances(child, parent)).toEqual({
      top: 16,
      right: 24,
      bottom: 16,
      left: 24,
    });
  });

  test("child flush with parent = zero insets", () => {
    const parent = rect(0, 0, 100, 100);
    expect(insetDistances(rect(0, 0, 100, 100), parent)).toEqual({
      top: 0,
      right: 0,
      bottom: 0,
      left: 0,
    });
  });

  test("child overflowing parent gives negative insets", () => {
    const parent = rect(100, 100, 100, 100);
    const child = rect(90, 100, 100, 100);
    expect(insetDistances(child, parent).left).toBe(-10);
  });
});

describe("gapBetween — edge-to-edge distance between two elements", () => {
  test("vertical stack: gap is bottom-of-A to top-of-B", () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(0, 66, 100, 50);
    expect(gapBetween(a, b)).toEqual({ axis: "y", gap: 16 });
  });

  test("order independent", () => {
    const a = rect(0, 0, 100, 50);
    const b = rect(0, 66, 100, 50);
    expect(gapBetween(b, a)).toEqual({ axis: "y", gap: 16 });
  });

  test("horizontal neighbors measure on x", () => {
    const a = rect(0, 0, 50, 100);
    const b = rect(74, 0, 50, 100);
    expect(gapBetween(a, b)).toEqual({ axis: "x", gap: 24 });
  });

  test("overlapping rects → gap 0 on the dominant axis", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(50, 50, 100, 100);
    expect(gapBetween(a, b).gap).toBe(0);
  });

  test("diagonal separation picks the axis with the larger gap", () => {
    const a = rect(0, 0, 100, 100);
    const b = rect(110, 140, 100, 100); // x-gap 10, y-gap 40
    expect(gapBetween(a, b)).toEqual({ axis: "y", gap: 40 });
  });
});

describe("isOnScale — spacing-scale check", () => {
  test("multiples of step pass", () => {
    expect(isOnScale(16, 4)).toBe(true);
    expect(isOnScale(0, 4)).toBe(true);
    expect(isOnScale(24, 4)).toBe(true);
  });

  test("off-scale values fail", () => {
    expect(isOnScale(18, 4)).toBe(false);
    expect(isOnScale(15, 4)).toBe(false);
  });

  test("subpixel rendering noise tolerated (±0.5px)", () => {
    expect(isOnScale(16.3, 4)).toBe(true);
    expect(isOnScale(15.7, 4)).toBe(true);
    expect(isOnScale(17.2, 4)).toBe(false);
  });
});
