CREATE TABLE `receipt_transfers` (
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`receipt_id` text NOT NULL,
	`to_customer_id` text NOT NULL,
	`to_receipt_id` text NOT NULL,
	`amount_paise` integer NOT NULL,
	`reason` text NOT NULL,
	`bank_reference` text NOT NULL,
	`action_id` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`to_receipt_id`) REFERENCES `payment_receipts`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "receipt_transfers_amount_paise_check" CHECK(typeof("receipt_transfers"."amount_paise") = 'integer' and "receipt_transfers"."amount_paise" > 0),
	CONSTRAINT "receipt_transfers_accounts_check" CHECK("receipt_transfers"."customer_id" <> "receipt_transfers"."to_customer_id")
);
--> statement-breakpoint
CREATE INDEX `receipt_transfers_customer_id_idx` ON `receipt_transfers` (`customer_id`);--> statement-breakpoint
CREATE INDEX `receipt_transfers_receipt_id_idx` ON `receipt_transfers` (`receipt_id`);--> statement-breakpoint
CREATE INDEX `receipt_transfers_to_customer_id_idx` ON `receipt_transfers` (`to_customer_id`);