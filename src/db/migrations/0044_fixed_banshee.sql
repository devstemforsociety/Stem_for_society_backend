CREATE INDEX IF NOT EXISTS "user_lower_email_idx" ON "user" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_order_id_idx" ON "transaction" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "transaction_enrolment_id_idx" ON "transaction" USING btree ("enrolment_id");