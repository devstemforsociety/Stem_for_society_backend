import { and, eq, isNull } from "drizzle-orm";
import { db } from "../db/connection";
import {
  careerCounsellingTransactionTable,
  enquiryTransactionTable,
  institutionTransactionTable,
  psychologyTransactionTable,
} from "../db/schema/enquiry";
import { transactionTable } from "../db/schema/training";

/**
 * The contact details the server already holds for a payment. Emails are sent
 * to this address, never to one supplied by the caller.
 */
export type VerifiedRecipient = {
  email: string;
  name: string;
  /** Which table the transaction lives in, so the receipt can be stamped. */
  source: "training" | "enquiry";
  transactionId: string;
  amount: string;
  /** Null until a receipt has been sent for this payment. */
  receiptSentAt: Date | null;
  /** Which flow this payment came from, so a receipt can pick its template. */
  kind: "course" | "career" | "psychology" | "institution";
  /** Course title, plan or school name - whatever names the purchase. */
  detail: string;
};

/**
 * Resolves a Razorpay payment id into the recipient recorded against it, or
 * null when no successful payment matches.
 *
 * The confirmation-email endpoints are unauthenticated because the enquiry
 * booking flows have no signed-in user. That left them as an open relay: the
 * caller named both the recipient and the contents, so anyone could send
 * branded "payment received" mail from this domain to anybody. Requiring a
 * payment id that resolves to a *successful* transaction, and then ignoring
 * the caller's address in favour of the stored one, closes both halves of
 * that - an attacker can neither forge a payment nor redirect a real one.
 *
 * A pending or failed transaction resolves to null on purpose: a receipt for
 * an unpaid order is exactly the message worth forging.
 */
export async function resolveVerifiedPayment(
  paymentId: string,
): Promise<VerifiedRecipient | null> {
  if (!paymentId) return null;

  const courseRecipient = await resolveCoursePayment(paymentId);
  if (courseRecipient) return courseRecipient;

  return resolveEnquiryPayment(paymentId);
}

/** Course purchases: transaction -> enrolment -> the user who enrolled. */
async function resolveCoursePayment(
  paymentId: string,
): Promise<VerifiedRecipient | null> {
  const txn = await db.query.transactionTable.findFirst({
    where: eq(transactionTable.paymentId, paymentId),
    with: {
      enrolment: {
        with: {
          user: {
            columns: { email: true, firstName: true, lastName: true },
          },
          training: { columns: { title: true } },
        },
      },
    },
  });

  if (!txn || txn.status !== "success") return null;

  const user = txn.enrolment?.user;
  if (!user?.email) return null;

  return {
    email: user.email,
    name: [user.firstName, user.lastName].filter(Boolean).join(" ").trim(),
    source: "training",
    transactionId: txn.id,
    amount: txn.amount,
    receiptSentAt: txn.receiptSentAt,
    kind: "course",
    detail: txn.enrolment?.training?.title ?? "",
  };
}

/**
 * Enquiry purchases (career counselling, psychology, institution plans) all
 * share one transaction table and reach their contact through a join table.
 * There are no reverse relations defined on the transaction, so this resolves
 * in two steps rather than one query.
 */
async function resolveEnquiryPayment(
  paymentId: string,
): Promise<VerifiedRecipient | null> {
  const txn = await db.query.enquiryTransactionTable.findFirst({
    where: eq(enquiryTransactionTable.paymentId, paymentId),
  });

  if (!txn || txn.status !== "success") return null;

  const career = await db.query.careerCounsellingTransactionTable.findFirst({
    where: eq(careerCounsellingTransactionTable.transactionId, txn.id),
    with: { career: true },
  });
  if (career?.career?.email) {
    return {
      email: career.career.email,
      name: joinName(career.career.firstName, career.career.lastName),
      ...enquiryFields(txn),
      kind: "career" as const,
      detail: career.career.service ?? career.career.plan ?? "",
    };
  }

  const psychology = await db.query.psychologyTransactionTable.findFirst({
    where: eq(psychologyTransactionTable.transactionId, txn.id),
    with: { psychology: true },
  });
  if (psychology?.psychology?.email) {
    return {
      email: psychology.psychology.email,
      name: joinName(
        psychology.psychology.firstName,
        psychology.psychology.lastName,
      ),
      ...enquiryFields(txn),
      kind: "psychology" as const,
      detail: "Mental wellbeing session",
    };
  }

  const institution = await db.query.institutionTransactionTable.findFirst({
    where: eq(institutionTransactionTable.transactionId, txn.id),
    with: { institutionPlan: true },
  });
  if (institution?.institutionPlan?.contactEmail) {
    return {
      email: institution.institutionPlan.contactEmail,
      name: institution.institutionPlan.contactName,
      ...enquiryFields(txn),
      kind: "institution" as const,
      detail: institution.institutionPlan.schoolName,
    };
  }

  return null;
}

function joinName(first: string, last: string | null): string {
  return [first, last].filter(Boolean).join(" ").trim();
}

function enquiryFields(txn: {
  id: string;
  amount: string;
  receiptSentAt: Date | null;
}) {
  return {
    source: "enquiry" as const,
    transactionId: txn.id,
    amount: txn.amount,
    receiptSentAt: txn.receiptSentAt,
  };
}

/**
 * Atomically claims the right to send this payment's receipt.
 *
 * Returns true only for the caller that won. The browser fires the receipt
 * call after checkout and the webhook fires one independently, so a
 * read-then-write check would let both through - the claim has to be the
 * conditional UPDATE itself.
 */
export async function claimReceipt(
  payment: VerifiedRecipient,
): Promise<boolean> {
  const now = new Date();
  if (payment.source === "training") {
    const rows = await db
      .update(transactionTable)
      .set({ receiptSentAt: now })
      .where(
        and(
          eq(transactionTable.id, payment.transactionId),
          isNull(transactionTable.receiptSentAt),
        ),
      )
      .returning({ id: transactionTable.id });
    return rows.length > 0;
  }

  const rows = await db
    .update(enquiryTransactionTable)
    .set({ receiptSentAt: now })
    .where(
      and(
        eq(enquiryTransactionTable.id, payment.transactionId),
        isNull(enquiryTransactionTable.receiptSentAt),
      ),
    )
    .returning({ id: enquiryTransactionTable.id });
  return rows.length > 0;
}

/**
 * Gives the claim back when sending failed, so the other side (or a retry)
 * can still deliver the receipt. A missing receipt is worse than a duplicate.
 */
export async function releaseReceipt(
  payment: VerifiedRecipient,
): Promise<void> {
  if (payment.source === "training") {
    await db
      .update(transactionTable)
      .set({ receiptSentAt: null })
      .where(eq(transactionTable.id, payment.transactionId));
    return;
  }
  await db
    .update(enquiryTransactionTable)
    .set({ receiptSentAt: null })
    .where(eq(enquiryTransactionTable.id, payment.transactionId));
}
