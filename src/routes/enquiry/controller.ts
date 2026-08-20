import { Request, RequestHandler, Response } from "express";
import {
  IndividualOrInstitutionnSchema,
  institutionPlanSchema,
  psychologyTrainingSchema,
  caRegistrationSchema,
  careerCounsellingSchema,
} from "./validation";
import { createValidationError, slugify } from "../../utils/validation";
import { db } from "../../db/connection";
import {
  addressTable,
  campusAmbassadorTable,
  careerCounsellingTable,
  careerCounsellingTransactionTable,
  enquiryTransactionTable,
  institutionPlanTable,
  institutionTransactionTable,
  psychologyTrainingTable,
  psychologyTransactionTable,
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

/**
 * Authoritative pricing for individual / institution registrations, in paise.
 *
 * The client used to send the amount it wanted to be charged, which meant a
 * modified request could buy a 3,000 rupee service for one rupee (SFS-02).
 * Prices now live here and here only. Returns 0 for combinations that are
 * enquiry-only and take no payment.
 */
function priceForEnquiryInPaise(
  type: "individual" | "institution",
  serviceInterest?: string | null,
): number {
  if (type === "institution") {
    // Single-theme is an enquiry, not a purchase.
    if (serviceInterest === "single-theme") return 0;
    return 30_00_000; // ₹30,000
  }

  return 3_00_000; // ₹3,000
}

export const individualOrInstitutionRegistration: RequestHandler = async (req:Request, res:Response) => {
  try{
    console.log("🚀 ~ individualOrInstitutionRegistration ~ req.body:", req.body);
    const dataParsed = IndividualOrInstitutionnSchema.safeParse(req.body);
    if(!dataParsed.success){
      res.status(200).json({errors: createValidationError(dataParsed)});
      console.log("🚀 ~ individualOrInstitutionRegistration ~ dataParsed:", dataParsed);
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
console.log("🚀 ~ individualOrInstitutionRegistration ~ InstitutionOrIndividual:", InstitutionOrIndividual);
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
    console.log("🚀 ~ enrollIndInst ~ error:", error);
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

      // create entry
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
        .onConflictDoUpdate({
          target: institutionPlanTable.schoolName,
          set: {
            schoolName: data.schoolName,
            contactEmail: data.contactEmail,
            contactMobile: data.contactMobile,
            selectedDate: (data.selectedDate),
            selectedTime: data.selectedTime || null,
          },
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
    console.log("🚀 ~ createInsitutitionRegistration ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering for plan!",
    });
  }
};

export const enrollPsychologyCounselling: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const psychologyDataParsed = psychologyTrainingSchema.safeParse({
      ...req.body,
      idCard:
        req.file && req.file.buffer
          ? new File([new Uint8Array(req.file!.buffer)], req.file!.filename, {
              type: req.file!.mimetype,
            })
          : null,
    });
    if (!psychologyDataParsed.success) {
      res
        .status(400)
        .json({ errors: createValidationError(psychologyDataParsed) });
      return;
    }

    await db.transaction(async (tx) => {
      let idCardURL = null;
      if (psychologyDataParsed.data.idCard) {
        const { data: fileURL, error } = await supabase.storage
          .from("s4s-media")
          .upload(
            `public/photos/${slugify(psychologyDataParsed.data.mobile)}-id.jpg`,
            psychologyDataParsed.data.idCard,
            {
              upsert: true,
            },
          );

        if (error) {
          res.status(500).json({
            success: false,
            error: "Server error in uploading file!",
          });
          return;
        }
        idCardURL =
          SUPABASE_PROJECT_URL +
          "/storage/v1/object/public/" +
          fileURL.fullPath;
      }

      const { data } = psychologyDataParsed;
      
      // Calculate base pricing
      const basePricing = 2000;
      
      // Calculate final pricing with student discount
      const hasStudentDiscount = (psychologyDataParsed.data.idCard) ? true : false;
      const finalPricing = hasStudentDiscount ? Math.round(basePricing * 0.50) : basePricing;

      const [psychology] = await tx
        .insert(psychologyTrainingTable)
        .values({
          firstName: data.firstName,
          lastName: data.lastName,
          city: data.city,
          state: data.state,
          mobile: data.mobile,
          email: data.email,
          idCardURL: idCardURL,
          selectedDate: data.selectedDate,
          selectedTime: data.selectedTime || null,
        })
        .returning();

      // create transaction
      const referenceId = "PSYC" + nanoid();
      const order = await razorpay.orders.create({
        amount: finalPricing * 100, // Use discounted amount for Razorpay
        currency: "INR",
        customer_details: {
          name:
            psychology.firstName +
            " " +
            (psychology.lastName ?? ""),
          email: psychology.email,
          contact: psychology.mobile,
          billing_address: {
            country: "India",
          },
          shipping_address: {
            country: "India",
          },
        },
        partial_payment: false,
        notes: {
          reason: `Payment by ${psychology.firstName + " " + (psychology.lastName ?? "")}`,
          original_amount: String(basePricing),
          final_amount: String(finalPricing),
          student_discount: hasStudentDiscount ? "50%" : "0%",
          student_id: hasStudentDiscount ? req.body.studentId : "",
        },
        receipt: referenceId,
      });

      const [transaction] = await tx
        .insert(enquiryTransactionTable)
        .values({
          amount: String(finalPricing), // Store the final amount to be paid
          status: "pending",
          txnNo: referenceId,
          orderId: order.id,
        })
        .returning();

      // create entry -> transaction map
      await tx.insert(psychologyTransactionTable).values({
        psychologyId: psychology.id,
        transactionId: transaction.id,
      });

      res.json({
        success: true,
        data: {
          amount: String(finalPricing), // Return the discounted amount
          orderId: order.id,
          originalAmount: String(basePricing),
          discountApplied: hasStudentDiscount,
          discountPercentage: hasStudentDiscount ? 50 : 0,
        },
      });
      return;
    });
  } catch (error) {
    console.log("🚀 ~ enrollPsychologyCounselling ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering for psychology counselling!",
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
    console.log("🚀 ~ campusAmbassadorRegistration ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering for campus ambassador!",
    });
  }
};

export const enrollCareerCounselling: RequestHandler = async (
  req: Request,
  res: Response,
) => {
  try {
    const careerCounsellingParsed = careerCounsellingSchema.safeParse(req.body);
    if (!careerCounsellingParsed.success) {
      res
        .status(400)
        .json({ errors: createValidationError(careerCounsellingParsed) });
      return;
    }

    await db.transaction(async (tx) => {
      const { data } = careerCounsellingParsed;
      
      // Calculate base pricing
      const basePricing = data.service
        ? 2000
        : data.plan === "Basics"
          ? 30000
          : 50000;

      // Calculate final pricing with student discount
      const hasStudentDiscount = req.body.studentId && req.body.studentId.trim() !== '';
      const finalPricing = hasStudentDiscount ? Math.round(basePricing * 0.25) : basePricing;
      
      const [careerCounselling] = await tx
        .insert(careerCounsellingTable)
        .values({
          firstName: data.firstName,
          lastName: data.lastName, 
          mobile: data.mobile,
          email: data.email,
          service: data.service,
          plan: data.plan,
          selectedDate: data.selectedDate,
          selectedTime: data.selectedTime || null,
        })
        .returning();

      // create transaction
      const referenceId = "CAREER_" + nanoid();
      const order = await razorpay.orders.create({
        amount: finalPricing * 100, // Use discounted amount for Razorpay
        currency: "INR",
        customer_details: {
          name:
            careerCounselling.firstName,
          email: careerCounselling.email,
          contact: careerCounselling.mobile,
          billing_address: {
            country: "India",
          },
          shipping_address: {
            country: "India",
          },
        },
        partial_payment: false,
        notes: {
          reason: `Payment by ${careerCounselling.firstName })}`,
          original_amount: String(basePricing),
          final_amount: String(finalPricing),
          student_discount: hasStudentDiscount ? "75%" : "0%",
          student_id: hasStudentDiscount ? req.body.studentId : "",
          service_type: data.service ? "service" : "plan",
          selected_item: data.service || data.plan || "",
        },
        receipt: referenceId,
      });

      const [transaction] = await tx
        .insert(enquiryTransactionTable)
        .values({
          amount: String(finalPricing), // Store the final amount to be paid
          status: "pending",
          txnNo: referenceId,
          orderId: order.id,
        })
        .returning();

      // create entry -> transaction map
      await tx.insert(careerCounsellingTransactionTable).values({
        careerId: careerCounselling.id,
        transactionId: transaction.id,
      });

      res.json({
        success: true,
        data: {
          amount: String(finalPricing), // Return the discounted amount
          orderId: order.id,
          originalAmount: String(basePricing),
          discountApplied: hasStudentDiscount,
          discountPercentage: hasStudentDiscount ? 75 : 0,
        },
      });
      return;
    });
  } catch (error) {
    console.log("🚀 ~ enrollCareerCounselling ~ error:", error);
    res.status(500).json({
      success: false,
      error: "Server error in registering for career counselling!",
    });
  }
};
