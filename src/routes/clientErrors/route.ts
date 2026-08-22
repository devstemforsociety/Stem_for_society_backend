import { Router } from "express";
import { recordClientError } from "./controller";

const clientErrorsRouter = Router();

// Unauthenticated on purpose: the failures most worth seeing are the ones that
// stop somebody signing in.
clientErrorsRouter.post("/", recordClientError);

export default clientErrorsRouter;
