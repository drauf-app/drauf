CREATE TABLE "meal_slots" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"name" text NOT NULL,
	"sort_order" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "plan_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"household_id" text NOT NULL,
	"date" text NOT NULL,
	"slot_id" text NOT NULL,
	"text" text,
	"link" text,
	"cook_id" text,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "meal_slots" ADD CONSTRAINT "meal_slots_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entries" ADD CONSTRAINT "plan_entries_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entries" ADD CONSTRAINT "plan_entries_slot_id_meal_slots_id_fk" FOREIGN KEY ("slot_id") REFERENCES "public"."meal_slots"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_entries" ADD CONSTRAINT "plan_entries_cook_id_users_id_fk" FOREIGN KEY ("cook_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "plan_entries_day_slot_idx" ON "plan_entries" USING btree ("household_id","date","slot_id");