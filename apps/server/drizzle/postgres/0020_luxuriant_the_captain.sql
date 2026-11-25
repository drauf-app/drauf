ALTER TABLE "plan_entries" DROP CONSTRAINT "plan_entries_slot_id_meal_slots_id_fk";
--> statement-breakpoint
DROP INDEX "plan_entries_day_slot_idx";--> statement-breakpoint
ALTER TABLE "plan_entries" ALTER COLUMN "slot_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_entries" ADD CONSTRAINT "plan_entries_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_entries_day_idx" ON "plan_entries" USING btree ("household_id","date");