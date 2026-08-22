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
    /**
     * Multer defaults non-file fields to 1 MB. A blog written in the rich text
     * editor easily passes that, and the overflow surfaced as an unexplained
     * 500 after the author had filled in every step.
     */
    fieldSize: 10 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_IMAGE_TYPES.has(file.mimetype)) {
      // Named so the error handler can answer 400 with this text rather than
      // letting it fall through as an unexplained server fault. HEIC is the
      // default on iPhones, so this path is hit by real users.
      const rejection = new Error(
        "Only JPEG, PNG, WebP or GIF images can be uploaded.",
      );
      rejection.name = "UnsupportedImageType";
      callback(rejection);
      return;
    }
    callback(null, true);
  },
});
