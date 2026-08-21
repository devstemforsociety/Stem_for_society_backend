import { imageUpload } from "../../utils/upload";
import { Router, urlencoded } from "express";
import { approveBlog, createBlog, getBlog, getBlogs } from "./controller";
import multer from "multer";
import { requireAnyAuthToken, requireAuthToken } from "../../middleware";

const blogsRouter = Router();

blogsRouter.get("/", requireAuthToken("ADMIN", false), getBlogs);
blogsRouter.get("/:blogSlug", requireAuthToken("ADMIN", false), getBlog);
// Submitting a blog must be attributable to an account. Without this guard,
// anyone on the internet could put HTML into the moderation queue, where an
// admin then opens it (SFS-01).
blogsRouter.post(
  "/",
  requireAnyAuthToken,
  urlencoded({ extended: true }),
  imageUpload.single("coverImage"),
  createBlog,
);
blogsRouter.post("/:blogSlug/approve", requireAuthToken("ADMIN"), approveBlog);

export default blogsRouter;
