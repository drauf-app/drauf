CREATE TABLE "applied_operations" (
	"id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"applied_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "list_entries" ADD COLUMN "field_times" text;--> statement-breakpoint
ALTER TABLE "applied_operations" ADD CONSTRAINT "applied_operations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;