ALTER TABLE "abonnements" ALTER COLUMN "type_etablissement" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "plans_tarifs" ALTER COLUMN "type_etablissement_cible" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "terrasses" ALTER COLUMN "type_etablissement" SET DATA TYPE varchar(20);--> statement-breakpoint
ALTER TABLE "terrasses" ALTER COLUMN "type_etablissement" SET DEFAULT 'TERRASSE';