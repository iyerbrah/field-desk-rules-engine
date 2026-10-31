PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_deliveries` (
	`id` text PRIMARY KEY NOT NULL,
	`shipment_line_id` text NOT NULL,
	`order_id` text NOT NULL,
	`qty` integer NOT NULL,
	`reversal_of_id` text,
	`reason` text DEFAULT '' NOT NULL,
	`evidence` text DEFAULT '' NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`shipment_line_id`) REFERENCES `shipment_lines`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`reversal_of_id`) REFERENCES `deliveries`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "deliveries_qty_check" CHECK(typeof("__new_deliveries"."qty") = 'integer' and (("__new_deliveries"."qty" > 0 and "__new_deliveries"."reversal_of_id" is null) or ("__new_deliveries"."qty" < 0 and "__new_deliveries"."reversal_of_id" is not null)))
);
--> statement-breakpoint
INSERT INTO `__new_deliveries`("id", "shipment_line_id", "order_id", "qty", "reversal_of_id", "reason", "evidence", "action_id", "created_at") SELECT "id", "shipment_line_id", "order_id", "qty", NULL, '', '', "action_id", "created_at" FROM `deliveries`;--> statement-breakpoint
DROP TABLE `deliveries`;--> statement-breakpoint
ALTER TABLE `__new_deliveries` RENAME TO `deliveries`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `deliveries_shipment_line_id_idx` ON `deliveries` (`shipment_line_id`);--> statement-breakpoint
CREATE INDEX `deliveries_order_id_idx` ON `deliveries` (`order_id`);--> statement-breakpoint
CREATE INDEX `deliveries_reversal_idx` ON `deliveries` (`reversal_of_id`);