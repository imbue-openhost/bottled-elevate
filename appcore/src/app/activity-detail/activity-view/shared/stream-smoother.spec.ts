import { smoothStream } from "./stream-smoother";

describe("smoothStream", () => {
  const oneHz = (n: number) => Array.from({ length: n }, (_, i) => i);

  it("should return values untouched for a zero window", () => {
    const values = [1, 5, 3];
    expect(smoothStream([0, 1, 2], values, 0)).toBe(values);
  });

  it("should keep a constant stream constant", () => {
    const values = new Array(60).fill(200);
    expect(smoothStream(oneHz(60), values, 30)).toEqual(values);
  });

  it("should average a step down to intermediate values around the edge", () => {
    const time = oneHz(60);
    const values = time.map(t => (t < 30 ? 0 : 100));

    const smoothed = smoothStream(time, values, 10);

    expect(smoothed[10]).toEqual(0); // Far from the step: untouched
    expect(smoothed[50]).toEqual(100);
    expect(smoothed[30]).toBeGreaterThan(0); // At the step: blended
    expect(smoothed[30]).toBeLessThan(100);
    // Centered window: symmetric blend around the step
    expect(smoothed[29] + smoothed[30]).toBeCloseTo(100, 5);
  });

  it("should window by time rather than sample count on non-uniform streams", () => {
    // 3 samples spread over 100s: a 10s window never spans two samples
    const time = [0, 50, 100];
    const values = [0, 100, 0];
    expect(smoothStream(time, values, 10)).toEqual(values);
  });

  it("should pass non-finite samples through and exclude them from neighbors averages", () => {
    const time = oneHz(5);
    const values = [10, null as unknown as number, 10, 10, 10];

    const smoothed = smoothStream(time, values, 4);

    expect(smoothed[1]).toBeNull();
    expect(smoothed[0]).toEqual(10);
    expect(smoothed[2]).toEqual(10);
  });
});
