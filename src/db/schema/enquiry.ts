import {
  char,
  date,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  timestamp,
  time,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { addressTable } from "./misc";
import { relations } from "drizzle-orm";
import { timestamps } from "./helper";
import { nanoid } from "nanoid";
import { transactionStatusEnum } from "./training";

export const caEducationType = pgEnum("ca_edu_type", ["UG", "PG", "PhD"]);
export const institutionPlans = pgEnum("inst_plans", ["Basics", "Premium"]);
export const IndividualOrInstitutionEnum = pgEnum("ind-int-type",["individual","institution"]);

export const IndividualInstitutiontable = pgTable("individual_institution", {
  id : uuid().primaryKey().defaultRandom(),
  name : varchar({length: 200}).notNull(),
  mobile : char({length: 10}).notNull(),
  email : varchar({length: 200}).notNull(),
  type : IndividualOrInstitutionEnum().notNull(),
  designation : varchar({length: 100}),
  organizationName : varchar({length: 200}),
  requirements : text(),
  concerns : text(),
  serviceInterest : varchar({length: 200}),
  selectedDate: varchar("selectedDate", { length: 20 }), // e.g., "2023-10-15"
  selectedTime: varchar("selectedTime", { length: 20 }), // e.g., "10:30 AM", "2:30 PM"
  ...timestamps(),
});


/**
 * One row per institution plan booking.
 *
 * schoolName, contactMobile and contactEmail were each unique, and the handler
 * upserted on schoolName. That made a booking destructive in two ways: a school
 * booking a second time silently overwrote its own earlier booking - including
 * the meeting date and time already agreed - and two genuinely different
 * schools that happen to share a name could not both exist. The transaction
 * rows survived, so payments existed with no matching booking to service.
 *
 * A booking is an event, not an identity: the constraints are gone and each
 * submission inserts its own row.
 */
export const institutionPlanTable = pgTable("institution_plan", {
  id: uuid().primaryKey().defaultRandom(),
  schoolName: varchar({ length: 200 }).notNull(),
  addressId: integer()
    .references(() => addressTable.id)
    .notNull(),
  contactName: varchar({ length: 200 }).notNull(),
  contactMobile: char({ length: 10 }).notNull(),
  contactEmail: varchar().notNull(),
  studentsCount: integer(),
  selectedDate: varchar("selectedDate", { length: 20 }), // e.g., "2023-10-15"
  selectedTime: varchar("selectedTime", { length: 20 }), // e.g., "10:30 AM", "2:30 PM"
});

export const psychologyTrainingTable = pgTable("psychology_training", {
  id: uuid().primaryKey().defaultRandom(),
  firstName: varchar({ length: 50 }).notNull(),
  lastName: varchar({ length: 50 }),
  email: varchar({ length: 200 }).notNull(),
  mobile: char({ length: 10 }).notNull(),
  city: varchar("city", { length: 200 }).notNull(),
  state: varchar("state", { length: 200 }).notNull(),
  idCardURL: text(),
  selectedDate: varchar("selectedDate", {length: 20}), // e.g., "2023-10-15"
  selectedTime: varchar("selectedTime", { length: 20 }), // e.g., "10:30 AM", "2:30 PM"
  ...timestamps(),
});

export const careerCounsellingTable = pgTable("career_counselling", {
  id: uuid().primaryKey().defaultRandom(),
  firstName: varchar({ length: 50 }).notNull(),
  lastName: varchar({ length: 50 }),
  email: varchar({ length: 200 }).notNull(),
  mobile: char({ length: 10 }).notNull(),
  service: varchar({ length: 100 }),
  plan: institutionPlans(),
  /**
   * Evidence for the student discount, mirroring psychology_training. The
   * discount used to be granted for any non-empty "studentId" string in the
   * request body, which meant anyone could take 75% off. It now requires a
   * document an admin can actually look at.
   */
  idCardURL: text(),
  selectedDate: varchar("selectedDate", { length: 20 }), // e.g., "2023-10-15"
  selectedTime: varchar("selectedTime", { length: 20 }), // e.g., "10:30 AM", "2:30 PM"
  ...timestamps(),
});

/** This table contains transactions for psychology payments, institution plan payments and career counselling payments */
export const institutionTransactionTable = pgTable("institution_transaction", {
  id: uuid().primaryKey().defaultRandom(),
  institutionId: uuid("institution_id")
    .references(() => institutionPlanTable.id)
    .notNull(),
  plan: institutionPlans().notNull(),
  transactionId: uuid("transaction_id")
    .references(() => enquiryTransactionTable.id)
    .notNull(),
  ...timestamps(),
});

export const careerCounsellingTransactionTable = pgTable("career_transaction", {
  id: uuid().primaryKey().defaultRandom(),
  careerId: uuid("institution_id")
    .references(() => careerCounsellingTable.id)
    .notNull(),
  transactionId: uuid("transaction_id")
    .references(() => enquiryTransactionTable.id)
    .notNull(),
  ...timestamps(),
});

export const psychologyTransactionTable = pgTable("psychology_transaction", {
  id: uuid().primaryKey().defaultRandom(),
  psychologyId: uuid("psych_req_id")
    .references(() => psychologyTrainingTable.id)
    .notNull(),
  transactionId: uuid("transaction_id")
    .references(() => enquiryTransactionTable.id)
    .notNull(),
  ...timestamps(),
});

export const IndividualInstitutionTransactionTable = pgTable("individual_institution_transaction", {
  id: uuid().primaryKey().defaultRandom(),
  Id: uuid("individual_institution_id")
    .references(() => IndividualInstitutiontable.id)
    .notNull(),
  transactionId: uuid("transaction_id")
    .references(() => enquiryTransactionTable.id)
    .notNull(),
  ...timestamps(),
});

export const enquiryTransactionTable = pgTable("enq_transaction", {
  id: uuid().primaryKey().defaultRandom(),
  txnNo: char("txn_no", { length: 50 }).$defaultFn(() => nanoid(21)),
  paymentId: varchar({ length: 500 }),
  orderId: varchar({ length: 500 }).notNull(),
  signature: varchar({ length: 500 }),
  idempotencyId: varchar({ length: 500 }),
  amount: varchar({ length: 10 }).notNull(),
  status: transactionStatusEnum("status").default("pending"),
  /**
   * When the receipt email for this payment was sent, whichever side sent it.
   * The browser fires the receipt call after checkout and the webhook fires
   * one too; without a marker a customer gets two, and a customer who closed
   * the tab used to get none.
   */
  receiptSentAt: timestamp("receipt_sent_at"),
  ...timestamps(),
});

export const campusAmbassadorTable = pgTable("ca_application", {
  id: uuid().primaryKey().defaultRandom(),
  firstName: varchar({ length: 50 }).notNull(),
  lastName: varchar({ length: 50 }),
  email: varchar({ length: 200 }).notNull(),
  mobile: char({ length: 10 }).notNull(),
  eduType: caEducationType().notNull(),
  department: varchar({ length: 100 }).notNull(),
  collegeName: varchar({ length: 200 }).notNull(),
  yearInCollege: smallint(),
  collegeCity: varchar("city", { length: 200 }).notNull(),
  dob: date("date_of_birth"),
  linkedin: varchar(),
  ...timestamps(),
});

export const institutionTransactionTableRelations = relations(
  institutionTransactionTable,
  ({ one }) => ({
    institutionPlan: one(institutionPlanTable, {
      fields: [institutionTransactionTable.institutionId],
      references: [institutionPlanTable.id],
    }),
    transaction: one(enquiryTransactionTable, {
      fields: [institutionTransactionTable.transactionId],
      references: [enquiryTransactionTable.id],
    }),
  }),
);

export const careerTransactionTableRelations = relations(
  careerCounsellingTransactionTable,
  ({ one }) => ({
    career: one(careerCounsellingTable, {
      fields: [careerCounsellingTransactionTable.careerId],
      references: [careerCounsellingTable.id],
    }),
    transaction: one(enquiryTransactionTable, {
      fields: [careerCounsellingTransactionTable.transactionId],
      references: [enquiryTransactionTable.id],
    }),
  }),
);

export const psychologyTransactionTableRelations = relations(
  psychologyTransactionTable,
  ({ one }) => ({
    psychology: one(psychologyTrainingTable, {
      fields: [psychologyTransactionTable.psychologyId],
      references: [psychologyTrainingTable.id],
    }),
    transaction: one(enquiryTransactionTable, {
      fields: [psychologyTransactionTable.transactionId],
      references: [enquiryTransactionTable.id],
    }),
  }),
);

export const institutionPlanTableRelations = relations(
  institutionPlanTable,
  ({ one, many }) => ({
    address: one(addressTable, {
      fields: [institutionPlanTable.addressId],
      references: [addressTable.id],
    }),
    transactions: many(institutionTransactionTable),
  }),
);

export const psychologyTrainingTableRelations = relations(
  psychologyTrainingTable,
  ({ many }) => ({
    transactions: many(psychologyTransactionTable),
  }),
);

export const careerCounsellingRelations = relations(
  careerCounsellingTable,
  ({ many }) => ({
    transactions: many(careerCounsellingTransactionTable),
  }),
);

export const IndividualInstitutionTransactionTableRelations = relations(
  IndividualInstitutionTransactionTable,
  ({ one }) => ({
    individualInstitution: one(IndividualInstitutiontable, {
      fields: [IndividualInstitutionTransactionTable.Id],
      references: [IndividualInstitutiontable.id],
    }),
    transaction: one(enquiryTransactionTable, {
      fields: [IndividualInstitutionTransactionTable.transactionId],
      references: [enquiryTransactionTable.id],
    }),
  }),
);

export const IndividualInstitutionTableRelations = relations(
  IndividualInstitutiontable,
  ({ many }) => ({
    transactions: many(IndividualInstitutionTransactionTable),
  }),
);
