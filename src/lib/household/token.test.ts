import { describe, expect, it } from "vitest";
import { generateInviteToken, hashInviteToken } from "./token";

describe("generateInviteToken", () => {
  it("erzeugt einen 256-Bit-Token als 64 Hex-Zeichen", () => {
    const token = generateInviteToken();
    expect(token).toMatch(/^[0-9a-f]{64}$/);
  });

  it("erzeugt bei jedem Aufruf einen anderen Token (keine Kollision im Praxisfall)", () => {
    const tokens = new Set(Array.from({ length: 50 }, () => generateInviteToken()));
    expect(tokens.size).toBe(50);
  });
});

describe("hashInviteToken", () => {
  it("ist deterministisch (gleicher Token -> gleicher Hash)", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it("erzeugt einen SHA-256-Hash als 64 Hex-Zeichen", () => {
    expect(hashInviteToken("test")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("unterschiedliche Tokens ergeben unterschiedliche Hashes", () => {
    expect(hashInviteToken(generateInviteToken())).not.toBe(hashInviteToken(generateInviteToken()));
  });

  it("der Hash enthält den Roh-Token nicht als Teilstring (keine triviale Rückgewinnung)", () => {
    const token = generateInviteToken();
    expect(hashInviteToken(token)).not.toContain(token);
  });
});
