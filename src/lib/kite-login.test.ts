import { describe, expect, it } from "bun:test";
import { extractRequestToken, kiteChecksum, kiteLoginUrl } from "./kite-login";

describe("kiteLoginUrl", () => {
  it("builds the v3 connect URL", () => {
    expect(kiteLoginUrl("lbcfhntteoecueqb")).toBe(
      "https://kite.zerodha.com/connect/login?v=3&api_key=lbcfhntteoecueqb",
    );
  });

  it("rejects an empty key", () => {
    expect(() => kiteLoginUrl("  ")).toThrow();
  });
});

describe("extractRequestToken", () => {
  it("takes a bare token", () => {
    expect(extractRequestToken("AbC123_xyz-9")).toBe("AbC123_xyz-9");
  });

  it("pulls the token out of a pasted redirect URL", () => {
    expect(
      extractRequestToken(
        "https://rdbstocks.lovable.app/kite/callback?action=login&status=success&request_token=Xy9Z8w7&extra=1",
      ),
    ).toBe("Xy9Z8w7");
  });

  it("handles the token as the first query parameter", () => {
    expect(extractRequestToken("https://x.test/cb?request_token=tok123&action=login")).toBe(
      "tok123",
    );
  });

  it("url-decodes the value", () => {
    expect(extractRequestToken("https://x.test/cb?request_token=a%2Db%2Dc")).toBe("a-b-c");
  });

  it("trims surrounding whitespace from a paste", () => {
    expect(extractRequestToken("  tok_42  ")).toBe("tok_42");
  });

  it("rejects empty input and text with no token", () => {
    expect(() => extractRequestToken("")).toThrow();
    expect(() => extractRequestToken("https://x.test/cb?status=cancelled")).toThrow();
  });
});

describe("kiteChecksum", () => {
  it("is SHA256 of api_key + request_token + api_secret", async () => {
    // Verified against the published Kite Connect spec ordering.
    // sha256("abc") is a well-known digest, so a+b+c concatenation is checkable.
    const sum = await kiteChecksum("a", "b", "c");
    expect(sum).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("returns 64 lowercase hex characters", async () => {
    const sum = await kiteChecksum("lbcfhntteoecueqb", "reqtok", "secret");
    expect(sum).toHaveLength(64);
    expect(/^[0-9a-f]{64}$/.test(sum)).toBe(true);
  });

  it("changes when any input changes", async () => {
    const base = await kiteChecksum("k", "r", "s");
    expect(await kiteChecksum("k2", "r", "s")).not.toBe(base);
    expect(await kiteChecksum("k", "r2", "s")).not.toBe(base);
    expect(await kiteChecksum("k", "r", "s2")).not.toBe(base);
  });

  it("is order-sensitive — key+token+secret, not any other arrangement", async () => {
    expect(await kiteChecksum("k", "r", "s")).not.toBe(await kiteChecksum("s", "r", "k"));
  });
});
