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
trainingRouter.post(
  "/",
  urlencoded({ extended: true }),
  imageUpload.single("cover"),
  requireAuthToken("PARTNER"),
  createTraining,
);
trainingRouter.post(
  "/:trainingId/generate",
  requireAuthToken("PARTNER"),
  generateCertificates,
);
trainingRouter.patch(
  "/:trainingId",
  imageUpload.single("cover"),
  requireAuthToken("PARTNER"),
  updateTraining,
);
trainingRouter.delete(
  "/:trainingId",
  requireAuthToken("PARTNER"),
  deleteTraining,
);

export default trainingRouter;
