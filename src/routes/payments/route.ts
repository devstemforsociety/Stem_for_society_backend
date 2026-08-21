import { Router } from "express";
import { requireAuthToken } from "../../middleware";
import { createPayment, getPaymentStatus, verifyPayment, verifyClientPayment, verifyClientEnquiryPayment /*, debugWebhook */ } from "./controller";

const paymentRouter = Router();

paymentRouter.post("/create", requireAuthToken("STUDENT"), createPayment);
paymentRouter.post("/verify", verifyPayment); // Webhook endpoint - raw body handled at app level
paymentRouter.post("/verify-client", requireAuthToken("STUDENT"), verifyClientPayment); // NEW client endpoint
// Enquiry payments are made by visitors who are not signed in; the Razorpay
// signature checked inside the handler is what authorises the call.
paymentRouter.post("/verify-enquiry", verifyClientEnquiryPayment);
paymentRouter.get("/status/:orderId", requireAuthToken("STUDENT"), getPaymentStatus);
// paymentRouter.get("/debug-webhook", debugWebhook); // Debug endpoint

export default paymentRouter;
