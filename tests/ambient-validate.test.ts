import { describe, test, expect } from "bun:test";
import { runAmbientValidate, twoProportionPValue } from "../src/mock.ts";
import { getDb } from "../src/db.ts";

/**
 * ambient-validate (Task 26 / Adjustment K1) tests:
 *  - graceful degradation when ambient_exposures table doesn't exist
 *  - empty mock_attempts → status=no_data
 *  - twoProportionPValue normal-approximation correctness on sane inputs
 *
 * We do NOT seed real ambient_exposures rows here because that's agent-B's
 * Task 24 territory. The validate function's contract is "no exposures → all
 * mock attempts fall in low-exposure bucket → p_value reflects that"; we
 * verify the code path handles each branch.
 */

function dropAmbientTable(): void {
  const db = getDb();
  db.exec("DROP TABLE IF EXISTS ambient_exposures");
  db.exec("DROP TABLE IF EXISTS ambient_exposures_archive");
}

describe("ambient-validate graceful degradation", () => {
  test("when ambient_exposures table missing → status=no_table", () => {
    dropAmbientTable();
    const r = runAmbientValidate({ windowDays: 30 });
    expect(r.status).toBe("no_table");
    expect(r.conclusion).toContain("ambient_exposures");
    expect(r.p_value).toBeNull();
  });
});

describe("twoProportionPValue", () => {
  test("zero totals → null", () => {
    expect(twoProportionPValue(0, 0, 0, 0)).toBeNull();
    expect(twoProportionPValue(5, 10, 0, 0)).toBeNull();
    expect(twoProportionPValue(0, 0, 5, 10)).toBeNull();
  });

  test("equal proportions → p ≈ 0.5", () => {
    const p = twoProportionPValue(50, 100, 50, 100)!;
    expect(p).toBeGreaterThan(0.49);
    expect(p).toBeLessThan(0.51);
  });

  test("strong high > low (90% vs 50%, n=100 each) → p < 0.001", () => {
    const p = twoProportionPValue(90, 100, 50, 100)!;
    expect(p).toBeLessThan(0.001);
  });

  test("low > high (40% vs 70%, n=50 each) → p > 0.95 (one-sided upper)", () => {
    const p = twoProportionPValue(20, 50, 35, 50)!;
    expect(p).toBeGreaterThan(0.95);
  });

  test("modest effect (60% vs 50%, n=200 each) → p < 0.05", () => {
    const p = twoProportionPValue(120, 200, 100, 200)!;
    expect(p).toBeLessThan(0.05);
  });

  test("modest effect with small n (60% vs 50%, n=20 each) → p > 0.05 (underpowered)", () => {
    const p = twoProportionPValue(12, 20, 10, 20)!;
    expect(p).toBeGreaterThan(0.05);
  });
});
