CREATE TABLE "store_excluded_categories" (
	"store_id" text NOT NULL,
	"category_id" text NOT NULL,
	CONSTRAINT "store_excluded_categories_store_id_category_id_pk" PRIMARY KEY("store_id","category_id")
);
--> statement-breakpoint
ALTER TABLE "store_excluded_categories" ADD CONSTRAINT "store_excluded_categories_store_id_stores_id_fk" FOREIGN KEY ("store_id") REFERENCES "public"."stores"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "store_excluded_categories" ADD CONSTRAINT "store_excluded_categories_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE cascade ON UPDATE no action;