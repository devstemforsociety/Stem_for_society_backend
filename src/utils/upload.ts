import multer from "multer";

/**
 * Shared upload configuration.
 *
 * Bare `multer()` buffers the whole file in memory with no size ceiling and no
 * type restriction, on routes that are largely public - a handful of large
 * concurrent uploads was enough to exhaust the container (SFS-08).
 */

const MAX_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
]);

/**
 * Accepts images only, capped in size and count. The declared MIME type is the
 * client's claim, so treat it as a first filter and validate the real file
 * signature before trusting the content downstream.
 */
export const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 4,
    fields: 40,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      callback(
        new Error("Only JPEG, PNG, WebP or GIF images can be uploaded."),
      );
      return;
    }
    callback(null, true);
  },
});
