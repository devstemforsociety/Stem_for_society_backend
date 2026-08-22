import { Router, urlencoded } from "express";
import {
  individualOrInstitutionRegistration,
  campusAmbassadorRegistration,
  createInsitutitionRegistration,
} from "./controller";

const enquiryRouter = Router();

enquiryRouter.post("/ind_inst", urlencoded({ extended: true }), individualOrInstitutionRegistration);
enquiryRouter.post("/ca", campusAmbassadorRegistration);
enquiryRouter.post("/plans", createInsitutitionRegistration);

export default enquiryRouter;
