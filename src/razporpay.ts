import Razorpay from "razorpay";

/**
 * Razorpay client.
 *
 * This module used to throw at import time when PAYMENT_MODE or the keys were
 * missing. Because it is imported by the payments, enquiry, partner and admin
 * controllers, that turned a payment misconfiguration into a dead API - every
 * page, including the ones that never touch payments, went down with it.
 *
 * Now a misconfiguration is logged loudly and confined to the payment calls
 * themselves, which already run inside try/catch and return a handled error.
 */

const PAYMENT_MODE = process.env.PAYMENT_MODE;
const isTestMode = PAYMENT_MODE === "test";

const RAZORPAY_KEYID = isTestMode
  ? process.env.RZPY_TEST_KEYID
  : process.env.RZPY_LIVE_KEYID;

export const RAZORPAY_KEYSEC = isTestMode
  ? process.env.RZPY_TEST_KEYSEC
  : process.env.RZPY_LIVE_KEYSEC;

export const RZPY_WH_SECRET = process.env.RZPY_WH_SECRET;

/** True when a key id, key secret and webhook secret are all present. */
export const isPaymentConfigured = Boolean(
  PAYMENT_MODE && RAZORPAY_KEYID && RAZORPAY_KEYSEC && RZPY_WH_SECRET,
);

if (!isPaymentConfigured) {
  const missing = [
    !PAYMENT_MODE && "PAYMENT_MODE",
    !RAZORPAY_KEYID && (isTestMode ? "RZPY_TEST_KEYID" : "RZPY_LIVE_KEYID"),
    !RAZORPAY_KEYSEC && (isTestMode ? "RZPY_TEST_KEYSEC" : "RZPY_LIVE_KEYSEC"),
    !RZPY_WH_SECRET && "RZPY_WH_SECRET",
  ].filter(Boolean);

  console.error(
    `[razorpay] Payment is NOT configured - missing: ${missing.join(", ")}. ` +
      "Payment endpoints will fail; the rest of the API is unaffected.",
  );
} else {
  // The key id is public (it ships in the frontend bundle), so logging it is
  // safe - and it is the fastest way to spot a frontend/backend key mismatch.
  console.log(
    `[razorpay] mode=${PAYMENT_MODE} key_id=${RAZORPAY_KEYID}. The frontend's VITE_RZPY_KEYID must be exactly this value.`,
  );
}

export { RAZORPAY_KEYID };

export const razorpay = new Razorpay({
  // Placeholders keep the constructor (and therefore every import of this
  // module) from throwing. Calls made with them fail as ordinary handled
  // errors inside the controllers.
  key_id: RAZORPAY_KEYID || "unconfigured",
  key_secret: RAZORPAY_KEYSEC || "unconfigured",
});
