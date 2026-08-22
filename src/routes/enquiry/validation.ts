import { or } from "drizzle-orm";
import { z } from "zod";

const urlPattern = /^(https?:\/\/)?(www\.)?linkedin\.com\/(in|company)\/[a-z0-9_%\-]{3,100}\/?(\?.*)?$/i;

export const IndividualOrInstitutionnSchema = z.object({
  name : z
  .string({ required_error: "Name is required!" })
  .min(3, "Name must be at least 3 characters")
  .max(100, "Name is too long"),

  mobile : z
  .string({required_error : "Mobile is required!"})
  .regex(/^[6789]\d{9}$/, "Mobile number is invalid"),

  email : z.string().trim().toLowerCase().email("Invalid email"),
  type : z.enum(["individual", "institution"]),
  designation : z.string().max(100).nullish().or(z.literal("")),
  OrganizationName : z.string().max(200).nullish().or(z.literal("")),
  requirements : z.string().max(1000).nullish().or(z.literal("")),
  concerns : z.string().max(1000).nullish().or(z.literal("")),
  serviceInterest : z.string().max(200).nullish().or(z.literal("")),
  selectedDate: z.string().min(2, "Select a valid date"),
  selectedTime: z.string().min(2, "Select a valid time"),
  // `amount` is deliberately absent: the price is derived on the server from
  // `type` and `serviceInterest`. Zod strips it, so a client that still sends
  // one cannot influence what it is charged (SFS-02).
})

export const institutionPlanSchema = z.object({
  schoolName: z
    .string({ required_error: "School name is required!" })
    .min(3, "School name is too short")
    .max(100, "School name is too long"),
  contactName: z
    .string({ required_error: "Name is required!" })
    .min(3, "Name is too short")
    .max(100, "Name is too long"),
  contactMobile: z
    .string({ required_error: "Mobile is required!" })
    .regex(/^[6789]\d{9}$/, "Mobile number is invalid"),
  contactEmail: z.string().trim().toLowerCase().email("Invalid email"),
  studentsCount: z.number().positive("Student count must be more than 0"),
  addressLine1: z.string().min(10).max(200),
  addressLine2: z.string().min(5).max(100).nullish().or(z.literal("")),
  city: z
    .string()
    .min(2, "Invalid city")
    .max(100, "Maximum city name limit is 100 characters"),
  state: z
    .string()
    .min(2, "Invalid state")
    .max(100, "Maximum state name limit is 100 characters only"),
  pincode: z.string().regex(/^[0-9]{6}$/, "Invalid pincode"),
  plan: z.enum(["Basics", "Premium"]),
  selectedDate: z.string().min(2, "Select a valid date"),
  selectedTime: z.string().min(2, "Select a valid time"),
});

export const caRegistrationSchema = z.object({
  firstName: z
    .string({ required_error: "First name is required!" })
    .min(3, "First name must be at least 3 characters")
    .max(100, "First name is too long"),
  lastName: z
    .string()
    .max(100, "Last name is too long")
    .nullish()
    .or(z.literal("")),
  email: z.string().trim().toLowerCase().email("Invalid email"),
  mobile: z
    .string({ required_error: "Mobile is required!" })
    .regex(/^[6789]\d{9}$/, "Mobile number is invalid"),
  eduType: z.enum(["UG", "PG", "PhD"]), // Assuming caEducationType() returns a string
  department: z.string().max(100, "Department must be at most 100 characters"),
  collegeName: z
    .string()
    .max(200, "College name must be at most 200 characters"),
  yearInCollege: z.number().positive().optional(),
  collegeCity: z
    .string()
    .max(200, "College city must be at most 200 characters"),
  dob: z.coerce.date().nullish(),
  linkedin: z
    .string()
    .trim()
    .regex(urlPattern, "Only valid LinkedIn links are allowed"),
});
