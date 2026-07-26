// Minimal typings for Bun's built-in test runner (`bun test`).
// Kept as a local shim so no dependency needs to be added to package.json.
declare module "bun:test" {
  interface Matchers {
    toBe(expected: unknown): void;
    toEqual(expected: unknown): void;
    toBeCloseTo(expected: number, numDigits?: number): void;
    toBeNull(): void;
    toBeGreaterThan(n: number): void;
    toBeGreaterThanOrEqual(n: number): void;
    toBeLessThan(n: number): void;
    toBeLessThanOrEqual(n: number): void;
    toHaveLength(n: number): void;
    toContain(item: unknown): void;
    toBeTruthy(): void;
    toBeFalsy(): void;
    not: Matchers;
  }
  export function describe(name: string, fn: () => void): void;
  export function it(name: string, fn: () => void | Promise<void>): void;
  export const test: typeof it;
  export function expect(actual: unknown): Matchers;
}
