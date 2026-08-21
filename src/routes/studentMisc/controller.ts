import { debugLog } from "../../utils/logger";
import { Request, RequestHandler, Response } from "express";
export const saveUserProfile: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
  } catch (error) {
    debugLog("🚀 ~ saveUserProfile ~ error:", error);
    res.status(500).json({
      error: "Server error in saving user profile",
    });
  }
};
