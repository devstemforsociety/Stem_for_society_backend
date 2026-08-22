import { Router } from "express";
import { requireAuthToken } from "../../middleware";
import {
  getCAApplications,
  getInstitutionRegistrations,
  getIndividualTrainings,
  getInstitutionPlanBookings,
} from "./controller";

const adminApplicationsRouter = Router();

adminApplicationsRouter.get(
  "/individual",
  requireAuthToken("ADMIN"),
  getIndividualTrainings,
);
adminApplicationsRouter.get(
  "/ca",
  requireAuthToken("ADMIN"),
  getCAApplications,
);
adminApplicationsRouter.get(
  "/institution-plans",
  requireAuthToken("ADMIN"),
  getInstitutionRegistrations,
);
adminApplicationsRouter.get(
  "/institution-plan-bookings",
  requireAuthToken("ADMIN"),
  getInstitutionPlanBookings,
);

export default adminApplicationsRouter;
