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

/**
 * Types accepted for a partner's logo and digital signature.
 *
 * Deliberately the same set partnerProfileSchema already described (images
 * plus PDF), so nothing that uploads successfully today starts failing - the
 * point of this uploader is the limits, not a narrower allowlist.
 */
const ALLOWED_PROFILE_TYPES = new Set([
  ...ALLOWED_IMAGE_TYPES,
  "application/pdf",
]);

/**
 * Logo / digital-signature uploads.
 *
 * These routes ran on a bare `multer({ storage: memoryStorage() })`: no size
 * ceiling, no count ceiling and no type filter, which is exactly the hole
 * imageUpload above exists to close. The schema's own file rules never ran
 * either, because the handler validates `req.body` while multer puts files on
 * `req.files`, so nothing was checking these at all.
 */
export const profileUpload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: MAX_FILE_BYTES,
    files: 2,
    fields: 40,
    fieldSize: 1 * 1024 * 1024,
  },
  fileFilter: (_req, file, callback) => {
    if (!ALLOWED_PROFILE_TYPES.has(file.mimetype)) {
      const rejection = new Error(
        "Only JPEG, PNG, WebP, GIF or PDF files can be uploaded.",
      );
      rejection.name = "UnsupportedImageType";
      callback(rejection);
      return;
    }
    callback(null, true);
  },
});

/**
 * The Content-Type to store an upload under.
 *
 * The browser's declared mimetype was passed straight to Supabase, and these
 * objects are served from a public bucket - so a partner could upload
 * `text/html` and have it served as a live page on the storage domain. Only a
 * known-safe type is ever stored; anything unrecognised is served as an opaque
 * download instead of being rendered.
 */
export function safeContentType(mimetype: string | undefined): string {
  return mimetype && ALLOWED_PROFILE_TYPES.has(mimetype)
    ? mimetype
    : "application/octet-stream";
}
