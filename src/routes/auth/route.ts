import { Router } from "express";
import { getUserInfo, registerUser, signIn , resetPassword, googleAuth } from "./controller";
import { requireAuthToken } from "../../middleware";

const authRouter = Router();

authRouter.post("/register", registerUser);
authRouter.post("/sign-in", signIn);
authRouter.post("/reset-password", resetPassword);
authRouter.post("/google", googleAuth);
authRouter.get("/me", requireAuthToken("STUDENT"), getUserInfo);

export default authRouter;
