import { describe, expect, it } from "vitest";
import { getExpirationStatus } from "./expiration";

const now = new Date("2026-09-17T12:00:00Z");

describe("getExpirationStatus", () => {
  it("returns a neutral status when no date is known (UNKNOWN)", () => {
    const status = getExpirationStatus(null, now);
    expect(status).toEqual({ daysUntilExpiration: null, isExpired: false, isExpiringSoon: false });
  });

  it("flags a date in the past as expired", () => {
    const status = getExpirationStatus(new Date("2026-09-10T00:00:00Z"), now);
    expect(status.isExpired).toBe(true);
    expect(status.daysUntilExpiration).toBeLessThan(0);
  });

  it("flags a date within the next 2 days as expiring soon", () => {
    const status = getExpirationStatus(new Date("2026-09-18T00:00:00Z"), now);
    expect(status.isExpiringSoon).toBe(true);
    expect(status.isExpired).toBe(false);
  });

  it("does not flag a date far in the future as expiring soon", () => {
    const status = getExpirationStatus(new Date("2026-10-01T00:00:00Z"), now);
    expect(status.isExpiringSoon).toBe(false);
    expect(status.isExpired).toBe(false);
  });

  it("treats today as expiring soon, not expired", () => {
    const status = getExpirationStatus(new Date("2026-09-17T00:00:00Z"), now);
    expect(status.isExpired).toBe(false);
    expect(status.isExpiringSoon).toBe(true);
  });
});
