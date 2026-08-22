ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "bank_account_name" varchar(200);--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "bank_name" varchar(200);--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "bank_ifsc" varchar(20);--> statement-breakpoint
ALTER TABLE "account" ADD COLUMN IF NOT EXISTS "bank_account_number" varchar(40);