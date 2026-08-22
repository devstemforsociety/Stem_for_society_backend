ALTER TABLE "institution_plan" DROP CONSTRAINT "institution_plan_schoolName_unique";--> statement-breakpoint
ALTER TABLE "institution_plan" DROP CONSTRAINT "institution_plan_contactMobile_unique";--> statement-breakpoint
ALTER TABLE "institution_plan" DROP CONSTRAINT "institution_plan_contactEmail_unique";--> statement-breakpoint
ALTER TABLE "blog" ADD COLUMN "rejected_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "blog" ADD COLUMN "rejected_by" uuid;--> statement-breakpoint
ALTER TABLE "blog" ADD CONSTRAINT "blog_rejected_by_admin_id_fk" FOREIGN KEY ("rejected_by") REFERENCES "public"."admin"("id") ON DELETE no action ON UPDATE no action;