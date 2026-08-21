import { imageUpload } from "../../utils/upload";
import { Router, urlencoded } from "express";
import {
  createTraining,
  deleteTraining,
  generateCertificates,
  getTraining,
  getTrainings,
  updateTraining,
} from "./controller";
import { requireAuthToken } from "../../middleware";
import multer from "multer";

const trainingRouter = Router();

trainingRouter.get("/", requireAuthToken("PARTNER"), getTrainings);
trainingRouter.get("/:trainingId", requireAuthToken("PARTNER"), getTraining);
// Auth first: multer buffers the upload into memory, so running it before
// the token check let anonymous callers spend server memory per request.
trainingRouter.post(
  "/",
  requireAuthToken("PARTNER"),
  urlencoded({ extended: true }),
  imageUpload.single("cover"),
  createTraining,
);
trainingRouter.post(
  "/:trainingId/generate",
  requireAuthToken("PARTNER"),
  generateCertificates,
);
trainingRouter.patch(
  "/:trainingId",
  requireAuthToken("PARTNER"),
  imageUpload.single("cover"),
  updateTraining,
);
trainingRouter.delete(
  "/:trainingId",
  requireAuthToken("PARTNER"),
  deleteTraining,
);

export default trainingRouter;
