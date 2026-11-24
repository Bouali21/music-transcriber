CREATE TABLE `scores` (
	`id` text PRIMARY KEY NOT NULL,
	`owner_id` text NOT NULL,
	`title` text NOT NULL,
	`instrument` text NOT NULL,
	`tempo` integer NOT NULL,
	`key_fifths` integer NOT NULL,
	`key_mode` text NOT NULL,
	`time_num` integer NOT NULL,
	`time_den` integer NOT NULL,
	`duration_sec` real NOT NULL,
	`notes` text NOT NULL,
	`note_count` integer NOT NULL,
	`audio_key` text NOT NULL,
	`audio_type` text NOT NULL,
	`audio_bytes` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`share_token` text,
	`created_at` text NOT NULL,
	`updated_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scores_share_token_unique` ON `scores` (`share_token`);--> statement-breakpoint
CREATE INDEX `scores_owner_idx` ON `scores` (`owner_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text DEFAULT (current_timestamp) NOT NULL
);
