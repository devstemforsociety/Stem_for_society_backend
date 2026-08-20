import { v2 as cloudinary } from "cloudinary";

/**
 * Cloudinary is only reached by the partner asset endpoints
 * (`generateUploadSignature` and `deleteAsset`).
 *
 * This module used to throw at import time when the credentials were missing.
 * Because it sits in the training controller's import graph, that turned an
 * optional integration into a hard boot failure for the entire API. Now the
 * absence of credentials only disables the two endpoints that need them.
 */

const CLOUDINARY_CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME;
const CLOUDINARY_API_KEY = process.env.CLOUDINARY_API_KEY;
const CLOUDINARY_API_SECRET = process.env.CLOUDINARY_API_SECRET;

export const isCloudinaryConfigured = Boolean(
  CLOUDINARY_CLOUD_NAME && CLOUDINARY_API_KEY && CLOUDINARY_API_SECRET,
);

if (isCloudinaryConfigured) {
  cloudinary.config({
    cloud_name: CLOUDINARY_CLOUD_NAME,
    api_key: CLOUDINARY_API_KEY,
    api_secret: CLOUDINARY_API_SECRET,
  });
} else {
  console.warn(
    "[cloudinary] Credentials not set - partner asset upload/delete endpoints are disabled. The rest of the API is unaffected.",
  );
}

export default cloudinary;
export { CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_SECRET, CLOUDINARY_API_KEY };
