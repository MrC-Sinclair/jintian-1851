CREATE TABLE IF NOT EXISTS "device_credentials" (
	"device_id" text PRIMARY KEY NOT NULL,
	"secret_hash" text NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "faction_memories" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"save_id" uuid NOT NULL,
	"faction_id" text NOT NULL,
	"turn" integer NOT NULL,
	"source" text NOT NULL,
	"sentiment" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"save_id" uuid NOT NULL,
	"turn" integer NOT NULL,
	"event_id" text NOT NULL,
	"event_type" text NOT NULL,
	"content" text NOT NULL,
	"embedding" vector(1024) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "game_saves" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"save_id" uuid NOT NULL,
	"device_id" text NOT NULL,
	"save_data" jsonb NOT NULL,
	"save_version" integer DEFAULT 1 NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "game_saves_save_id_unique" UNIQUE("save_id")
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_device_credentials_secret_hash" ON "device_credentials" USING btree ("secret_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_faction_memories_save_faction" ON "faction_memories" USING btree ("save_id","faction_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_faction_memories_embedding" ON "faction_memories" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_game_events_save_turn" ON "game_events" USING btree ("save_id","turn");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_game_events_embedding" ON "game_events" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_game_saves_device_id" ON "game_saves" USING btree ("device_id");