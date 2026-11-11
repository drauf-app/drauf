CREATE TABLE "catalog_usage" (
	"household_id" text NOT NULL,
	"name_normalized" text NOT NULL,
	"name" text NOT NULL,
	"count" integer NOT NULL,
	"category_id" text,
	"last_quantity" double precision,
	"last_unit" text,
	"last_variant" text,
	"updated_at" timestamp with time zone NOT NULL,
	CONSTRAINT "catalog_usage_household_id_name_normalized_pk" PRIMARY KEY("household_id","name_normalized")
);
--> statement-breakpoint
ALTER TABLE "catalog_usage" ADD CONSTRAINT "catalog_usage_household_id_households_id_fk" FOREIGN KEY ("household_id") REFERENCES "public"."households"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "catalog_usage" ADD CONSTRAINT "catalog_usage_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;