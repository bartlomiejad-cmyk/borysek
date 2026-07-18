import { describe, it, expect } from "vitest";
import {
  stripKodVariantSuffix,
  detectVariantGroupsPhase1,
  type VariantRowInput,
} from "./variant-detect";

describe("stripKodVariantSuffix", () => {
  it("strips size + trailing free-text with spaces", () => {
    const { base, suffix } = stripKodVariantSuffix("201 OB_41_bez podnoska");
    expect(base).toBe("201 OB");
    expect(suffix?.startsWith("_41")).toBe(true);
  });

  it("strips a plain trailing size suffix (control)", () => {
    expect(stripKodVariantSuffix("117 S3 HRO_40")).toEqual({
      base: "117 S3 HRO",
      suffix: "_40",
    });
  });
});

describe("detectVariantGroupsPhase1", () => {
  it("groups the 201OB regression rows into a single group", () => {
    const rows: VariantRowInput[] = [
      { id: "a", nazwa: "Obuwie zawodowe o cholewkach skórzanych 201OB r. 41", kod: "201 OB_41_bez podnoska" },
      { id: "b", nazwa: "Obuwie zawodowe o cholewkach skórzanych 201OB r. 44", kod: "201 OB_44_bez podnoska" },
      { id: "c", nazwa: "Obuwie zawodowe o cholewkach skórzanych 201OB r. 45", kod: "201 OB_45_bez podnoska" },
    ];
    const { groups } = detectVariantGroupsPhase1(rows);
    expect(groups).toHaveLength(1);
    expect(groups[0].variantIndices.sort()).toEqual([0, 1, 2]);
    expect(groups[0].missingParent).toBe(true);
  });

  it("returns zero groups for unrelated products", () => {
    const rows: VariantRowInput[] = [
      { id: "a", nazwa: "Rękawice ochronne nitrylowe", kod: "RN-001" },
      { id: "b", nazwa: "Kask budowlany biały", kod: "KB-100" },
    ];
    const { groups } = detectVariantGroupsPhase1(rows);
    expect(groups).toHaveLength(0);
  });
});