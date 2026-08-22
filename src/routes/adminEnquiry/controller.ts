import { debugLog } from "../../utils/logger";
import { Request, RequestHandler, Response } from "express";
import { db } from "../../db/connection";
import { INVALID_SESSION_MSG } from "../../utils/constants";

/** Individual enquiries submitted through /enquiry/ind_inst. */
export const getIndividualTrainings: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const adminAuth = req.auth["ADMIN"];
    if (!adminAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const individualEnquiries =
      await db.query.IndividualInstitutiontable.findMany({
        where(fields, operators) {
          return operators.eq(fields.type, "individual");
        },
        with: {
          transactions: {
            with: {
              transaction: true,
            },
            limit: 1,
            orderBy(fields, operators) {
              return operators.desc(fields.updatedAt);
            },
          },
        },
        orderBy(fields, operators) {
          return operators.desc(fields.createdAt);
        },
      });
    res.json({ data: individualEnquiries });
  } catch (error) {
    debugLog("🚀 ~ getIndividualTrainings ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching individual enquiry details",
    });
  }
};

/**
 * Paid institution plans (Basics / Premium) taken through /enquiry/plans.
 *
 * Distinct from getInstitutionRegistrations, which lists institution *enquiries*
 * from IndividualInstitutiontable. Nothing read institutionPlanTable at all, so
 * these purchases were invisible to admins.
 */
export const getInstitutionPlanBookings: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const adminAuth = req.auth["ADMIN"];
    if (!adminAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const planBookings = await db.query.institutionPlanTable.findMany({
      with: {
        address: true,
        transactions: {
          with: {
            transaction: true,
          },
          orderBy(fields, operators) {
            return operators.desc(fields.updatedAt);
          },
        },
      },
    });

    res.json({ data: planBookings });
  } catch (error) {
    debugLog("🚀 ~ getInstitutionPlanBookings ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching institution plan bookings",
    });
  }
};

export const getCAApplications: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["ADMIN"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const caApplications = await db.query.campusAmbassadorTable.findMany({
      orderBy(fields, operators) {
        return operators.desc(fields.createdAt);
      },
    });

    res.json({ data: caApplications });
  } catch (error) {
    debugLog("🚀 ~ getCAApplications ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching campus ambassador application details",
    });
  }
};

export const getInstitutionRegistrations: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const partnerAuth = req.auth["ADMIN"];
    if (!partnerAuth) {
      res.status(401).json({
        error: INVALID_SESSION_MSG,
      });
      return;
    }
    const insitutionRegistrations =
      await db.query.IndividualInstitutiontable.findMany({
        where(fields,operators){
          return operators.eq(fields.type, "institution");
        },
        with: {
          transactions: {
            with: {
              transaction: true,
            },
            orderBy(fields, operators) {
              return operators.desc(fields.updatedAt);
            }
          },
        },
        orderBy(fields, operators) {
          return operators.desc(fields.createdAt);
        },
      });
    res.json({ data: insitutionRegistrations });
  } catch (error) {
    debugLog("🚀 ~ getInstitutionRegistrations ~ error:", error);
    res.status(500).json({
      error: "Server error in fetching institution registration details",
    });
  }
};
