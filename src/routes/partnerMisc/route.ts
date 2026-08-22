import { Router } from "express";
import { requireAuthToken } from "../../middleware";
import {
  getHomeStatistics,
  getProfileDetails,
  saveAccountDetails,
  savePartnerProfile,
} from "./controller";
import { profileUpload } from "../../utils/upload";

const partnerMiscRouter = Router();

partnerMiscRouter.get("/", requireAuthToken("PARTNER"), getHomeStatistics);
partnerMiscRouter.get("/me", requireAuthToken("PARTNER"), getProfileDetails);
partnerMiscRouter.post(
  "/account",
  requireAuthToken("PARTNER"),
  saveAccountDetails,
);
partnerMiscRouter.post(
  "/profile",
  requireAuthToken("PARTNER"),
  profileUpload.fields([
    {name :'logo', maxCount:1},
    {name: 'digitalSign',maxCount:1}
  ]),
  savePartnerProfile,
);

export default partnerMiscRouter;
