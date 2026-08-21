ALTER TABLE "enq_transaction" ADD COLUMN "receipt_sent_at" timestamp;--> statement-breakpoint
ALTER TABLE "transaction" ADD COLUMN "receipt_sent_at" timestamp;