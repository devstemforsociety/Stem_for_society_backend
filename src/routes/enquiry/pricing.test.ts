import { describe, expect, it } from "vitest";
import {
  INDIVIDUAL_PRICE_PAISE,
  INSTITUTION_PRICE_PAISE,
  priceForEnquiryInPaise,
} from "./pricing";

/**
 * These guard SFS-02: the price a customer is charged must come from the
 * server, never from the request. A regression here is money lost, so the
 * rules are pinned rather than described.
 */
describe("priceForEnquiryInPaise", () => {
  it("charges the individual rate for individual registrations", () => {
    expect(priceForEnquiryInPaise("individual", "career-counselling-full")).toBe(
      INDIVIDUAL_PRICE_PAISE,
    );
  });

  it("charges the institution rate for institution registrations", () => {
    expect(priceForEnquiryInPaise("institution", "workshop")).toBe(
      INSTITUTION_PRICE_PAISE,
    );
  });

  it("treats institution single-theme as enquiry-only", () => {
    expect(priceForEnquiryInPaise("institution", "single-theme")).toBe(0);
  });

  it("still charges an individual asking for single-theme", () => {
    // The exemption is specific to institutions; it must not become a way for
    // an individual to reach a zero price.
    expect(priceForEnquiryInPaise("individual", "single-theme")).toBe(
      INDIVIDUAL_PRICE_PAISE,
    );
  });

  it("falls back to the full rate when no service is supplied", () => {
    expect(priceForEnquiryInPaise("individual", undefined)).toBe(
      INDIVIDUAL_PRICE_PAISE,
    );
    expect(priceForEnquiryInPaise("individual", null)).toBe(
      INDIVIDUAL_PRICE_PAISE,
    );
    expect(priceForEnquiryInPaise("institution", "")).toBe(
      INSTITUTION_PRICE_PAISE,
    );
  });

  it("never returns a price an unknown service could lower", () => {
    // Any unrecognised value must land on the full rate, not zero and not
    // something cheaper.
    for (const service of ["", "unknown", "free", "0", "SINGLE-THEME"]) {
      expect(priceForEnquiryInPaise("individual", service)).toBe(
        INDIVIDUAL_PRICE_PAISE,
      );
    }
  });

  it("prices are positive whole numbers of paise", () => {
    expect(Number.isInteger(INDIVIDUAL_PRICE_PAISE)).toBe(true);
    expect(Number.isInteger(INSTITUTION_PRICE_PAISE)).toBe(true);
    expect(INDIVIDUAL_PRICE_PAISE).toBeGreaterThan(0);
    expect(INSTITUTION_PRICE_PAISE).toBeGreaterThan(INDIVIDUAL_PRICE_PAISE);
  });
});
