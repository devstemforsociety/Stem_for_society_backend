import {
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
  varchar,
} from "drizzle-orm/pg-core";
import { instructorTable } from "./users";
import { timestamps } from "./helper";
import { trainingTable } from "./training";
import { relations } from "drizzle-orm";

export const payoutStatusEnum = pgEnum("payout_status", [
  "pending",
  "queued",
  "scheduled",
  "processing",
  "processed",
  "reversed",
  "cancelled",
  "rejected",
  "failed",
]);

/** Never touch `rzpyFundingAcctId` field */
export const accountTable = pgTable("account", {
  id: uuid().defaultRandom().primaryKey(),
  partnerId: uuid("partner_id")
    .references(() => instructorTable.id)
    .unique()
    .notNull(),
  rzpyContactId: varchar({ length: 40 }).unique(),
  rzpyFundingAcctId: varchar({ length: 40 }).unique(), // fundingAcct and bankAcc refer to same
  rzpyBankAcctId: varchar({ length: 40 }).unique(), // fundingAcct and bankAcc refer to same
  rzpyVPAId: varchar("rzpy_vpa_id", { length: 40 }).unique(),
  /**
   * The partner's UPI id, stored as given.
   *
   * Distinct from rzpyVPAId, which is a Razorpay fund-account identifier.
   * These payouts are settled manually, so what matters is the address a human
   * types into a UPI app - there is no gateway object behind it.
   */
  upiId: varchar("upi_id", { length: 256 }),
  /**
   * Bank details as the partner entered them.
   *
   * Payouts are settled by hand, so these are stored rather than exchanged for
   * a Razorpay fund account. That makes them real financial data at rest: only
   * ever read back on admin surfaces, never on a public or partner listing.
   */
  bankAccountName: varchar("bank_account_name", { length: 200 }),
  bankName: varchar("bank_name", { length: 200 }),
  bankIfsc: varchar("bank_ifsc", { length: 20 }),
  bankAccountNumber: varchar("bank_account_number", { length: 40 }),
  rzpyCardId: varchar({ length: 40 }).unique(),
  bankAccVerifiedOn: timestamp({ withTimezone: true }),
  VPAVerifiedOn: timestamp("vpa_verified_on", { withTimezone: true }),
  cardVerifiedOn: timestamp({ withTimezone: true }),
});

export const payoutTable = pgTable("payout", {
  id: uuid().defaultRandom().primaryKey(),
  acctId: uuid("account_id").references(() => accountTable.id),
  referenceNo: varchar({ length: 30 }).notNull(),
  rzpyPayoutId: varchar({ length: 40 }),
  ...timestamps("createdAt", "completedOn"),
  status: payoutStatusEnum("status").default("pending"),
  reason: text(),
  trainingId: uuid("training_id").references(() => trainingTable.id),
  amount: varchar({ length: 10 }),
});

export const accountTableRelations = relations(
  accountTable,
  ({ one, many }) => ({
    partner: one(instructorTable, {
      fields: [accountTable.partnerId],
      references: [instructorTable.id],
    }),
    payouts: many(payoutTable),
  }),
);

export const payoutTableRelations = relations(payoutTable, ({ one }) => ({
  account: one(accountTable, {
    fields: [payoutTable.acctId],
    references: [accountTable.id],
  }),
  training: one(trainingTable, {
    fields: [payoutTable.trainingId],
    references: [trainingTable.id],
  }),
}));
