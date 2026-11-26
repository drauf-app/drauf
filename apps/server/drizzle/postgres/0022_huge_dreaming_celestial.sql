ALTER TABLE "users" ADD COLUMN "avatar_key" text;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_avatar_key_unique" UNIQUE("avatar_key");