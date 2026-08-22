import { priceForEnquiryInPaise } from "./pricing";
import { debugLog } from "../../utils/logger";
import { Request, RequestHandler, Response } from "express";
import {
  IndividualOrInstitutionnSchema,
  institutionPlanSchema,
  caRegistrationSchema,
} from "./validation";
import { createValidationError, slugify } from "../../utils/validation";
import { db } from "../../db/connection";
import {
  addressTable,
  campusAmbassadorTable,
  enquiryTransactionTable,
  institutionPlanTable,
  institutionTransactionTable,
  IndividualInstitutiontable,
  IndividualInstitutionTransactionTable,
} from "../../db/schema";
import { nanoid } from "nanoid";
import { razorpay } from "../../razporpay";
import { supabase, SUPABASE_PROJECT_URL } from "../../supabase";

// Helper function to format date to string
const formatDateToString = (date: Date | string | null | undefined): string | null => {
  if (!date) return null;
  if (typeof date === 'string') return date;
  if (date instanceof Date) {
    return date.toISOString().split('T')[0]; // Returns YYYY-MM-DD format
  }
  return null;
};

export const individualOrInstitutionRegistration: RequestHandler = async (req:Request, res:Response) => {
  try{
    debugLog("🚀 ~ individualOrInstitutionRegistration ~ req.body:", req.body);
    const dataParsed = IndividualOrInstitutionnSchema.safeParse(req.body);
    if(!dataParsed.success){
      res.status(200).json({errors: createValidationError(dataParsed)});
      debugLog("🚀 ~ individualOrInstitutionRegistration ~ dataParsed:", dataParsed);
      return;
    }
      await db.transaction(async (tx) => {
      const { data } = dataParsed;
      
      // Price is decided here, never by the caller. Mirrors the published
      // pricing: institution single-theme is enquiry-only, everything else is
      // a flat rate per audience.
      const FinalAmount = priceForEnquiryInPaise(
        data.type,
        data.serviceInterest,
      );

      if (FinalAmount <= 0) {
        res.status(400).json({
          success: false,
          error: "This service is not available for online payment.",
        });
        return;
      }
        const [InstitutionOrIndividual] = await tx
        .insert(IndividualInstitutiontable)
        .values({
          name: data.name,
          mobile  :  data.mobile,
          email  :  data.email,
          type  :  data.type.toLowerCase() as "individual" | "institution",
          organizationName  :  data.OrganizationName,
          designation  :  data.designation,
          requirements  :  data.requirements,
          concerns  :  data.concerns,
          serviceInterest  :  data.serviceInterest,
          selectedDate: data.selectedDate,
          selectedTime: data.selectedTime || null,
        })
        .returning();
debugLog("🚀 ~ individualOrInstitutionRegistration ~ InstitutionOrIndividual:", InstitutionOrIndividual);
      // create transaction
      const referenceName = data.type === "individual" ? "IND_" : "INST_";
      const referenceId = referenceName + nanoid();
      const order = await razorpay.orders.create({
        amount: FinalAmount,
        currency: "INR",
        customer_details: {
          name:
            InstitutionOrIndividual.name,
          email:InstitutionOrIndividual.email,
          contact: InstitutionOrIndividual.mobile,
          billing_address: {
            country: "India",
          },
          shipping_address: {
            country: "India",
          },
        },
        partial_payment: false,
        notes: {
          reason: `Payment by ${InstitutionOrIndividual.name })}`,
          original_amount: String(FinalAmount/100),
          service_type: data.type,
          selected_item: data.serviceInterest || "",
        },
        receipt: referenceId,
      });

      const [transaction] = await tx
        .insert(enquiryTransactionTable)
        .values({ 
          amount: String(FinalAmount/100), // Store the final amount to be paid
          status: "pending",
          txnNo: referenceId,
          orderId: order.id,
        })
        .returning();

      // create entry -> transaction map
      await tx.insert(IndividualInstitutionTransactionTable).values({
        Id: InstitutionOrIndividual.id,
        transactionId: transaction.id,
      });

      res.json({
        success: true,
        data: {
          amount: String(FinalAmount/100), // Return the discounted amount
          orderId: order.id,
        },
      });
      return;
    });
  } catch (error) {
    debugLog("🚀 ~ enrollIndInst ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering !",
    });
  }
  }



export const createInsitutitionRegistration: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const instituteDataParsed = institutionPlanSchema.safeParse(req.body);
    console.log(instituteDataParsed.data);
    if (!instituteDataParsed.success) {
      res
        .status(400)
        .json({ errors: createValidationError(instituteDataParsed) });
      return;
    }
    await db.transaction(async (tx) => {
      const { data } = instituteDataParsed;
      const planPricing = Number(data.plan === "Basics" ? 20000 : 40000);
      
      // create address
      const [address] = await tx
        .insert(addressTable)
        .values({
          addressLine1: data.addressLine1,
          addressLine2: data.addressLine2,
          city: data.city,
          state: data.state,
          pincode: data.pincode,
        })
        .returning();

      /**
       * One row per booking.
       *
       * This upserted on schoolName, so a school booking a second time
       * overwrote its own first booking - contact details and the agreed
       * meeting slot included - while the earlier payment row survived and
       * pointed at a booking that no longer described it. Two different schools
       * sharing a name collided the same way. Each submission is now its own
       * record; see the note on institutionPlanTable.
       */
      const [institution] = await tx
        .insert(institutionPlanTable)
        .values({
          addressId: address.id,
          schoolName: data.schoolName,
          contactEmail: data.contactEmail,
          contactMobile: data.contactMobile,
          contactName: data.contactName,
          studentsCount: data.studentsCount,
          selectedDate: (data.selectedDate),
          selectedTime: data.selectedTime || null,
        })
        .returning();

      // create transaction
      const referenceId = "INST_" + data.plan.toUpperCase() + "-" + nanoid();
      const order = await razorpay.orders.create({
        amount: planPricing * 100,
        currency: "INR",
        customer_details: {
          name: institution.contactName + "-" + institution.schoolName,
          email: institution.contactEmail,
          contact: institution.contactMobile,
          billing_address: {
            country: "India",
          },
          shipping_address: {
            country: "India",
          },
        },
        partial_payment: false,
        notes: {
          reason: `Payment by ${institution.contactName + "-" + institution.schoolName} for ${data.plan}`,
        },
        receipt: referenceId,
      });

      const [transaction] = await tx
        .insert(enquiryTransactionTable)
        .values({
          amount: String(planPricing),
          status: "pending",
          txnNo: referenceId,
          orderId: order.id,
        })
        .returning();

      // create entry -> transaction map
      await tx.insert(institutionTransactionTable).values({
        institutionId: institution.id,
        plan: data.plan,
        transactionId: transaction.id,
      });

      // send rzpyOrderId
      res.json({
        success: true,
        data: {
          amount: String(planPricing),
          orderId: order.id,
        },
      });
      return;
    });
  } catch (error) {
    debugLog("🚀 ~ createInsitutitionRegistration ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering for plan!",
    });
  }
};

export const campusAmbassadorRegistration: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const campusAmbDataParsed = caRegistrationSchema.safeParse(req.body);
    if (!campusAmbDataParsed.success) {
      res
        .status(400)
        .json({ errors: createValidationError(campusAmbDataParsed) });
      return;
    }

    await db
      .insert(campusAmbassadorTable)
      .values({
        firstName: campusAmbDataParsed.data.firstName,
        lastName: campusAmbDataParsed.data.lastName,
        mobile: campusAmbDataParsed.data.mobile,
        collegeCity: campusAmbDataParsed.data.collegeCity,
        collegeName: campusAmbDataParsed.data.collegeName,
        yearInCollege: campusAmbDataParsed.data.yearInCollege,
        email: campusAmbDataParsed.data.email,
        department: campusAmbDataParsed.data.department,
        eduType: campusAmbDataParsed.data.eduType,
        dob: campusAmbDataParsed.data.dob?.toISOString().split('T')[0] || null, // Convert Date to YYYY-MM-DD string
        linkedin: campusAmbDataParsed.data.linkedin
      })
      .returning();

    res.json({
      success: true,
      message: "Registration was successful! You will be contacted shortly",
    });
  } catch (error) {
    debugLog("🚀 ~ campusAmbassadorRegistration ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering for campus ambassador!",
    });
  }
};
