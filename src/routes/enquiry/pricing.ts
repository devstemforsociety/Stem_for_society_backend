/**
 * Authoritative pricing for individual / institution registrations, in paise.
 *
 * The client used to send the amount it wanted to be charged, which meant a
 * modified request could buy a 3,000 rupee service for one rupee (SFS-02).
 * Prices live here and nowhere else.
 *
 * Kept in its own module, free of database and payment-gateway imports, so the
 * rules can be unit tested directly.
 */

/** ₹3,000 for an individual registration. */
export const INDIVIDUAL_PRICE_PAISE = 3_00_000;

/** ₹30,000 for an institution registration. */
export const INSTITUTION_PRICE_PAISE = 30_00_000;

/**
 * Returns 0 for combinations that are enquiry-only and take no payment. The
 * caller rejects those rather than creating an order.
 */
export function priceForEnquiryInPaise(
  type: "individual" | "institution",
  serviceInterest?: string | null,
): number {
  if (type === "institution") {
    // Single-theme is an enquiry, not a purchase.
    if (serviceInterest === "single-theme") return 0;
    return INSTITUTION_PRICE_PAISE;
  }

  return INDIVIDUAL_PRICE_PAISE;
}
