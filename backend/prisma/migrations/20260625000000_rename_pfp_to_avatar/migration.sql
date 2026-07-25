-- Rename pfpEffect → avatarEffect and ownedPfpEffects → ownedAvatarEffects on User
ALTER TABLE "User" RENAME COLUMN "pfpEffect" TO "avatarEffect";
ALTER TABLE "User" RENAME COLUMN "ownedPfpEffects" TO "ownedAvatarEffects";

-- Migrate itemType 'pfp' → 'avatar' in all tables that store it as a string
UPDATE "MarketplaceListing" SET "itemType" = 'avatar' WHERE "itemType" = 'pfp';
UPDATE "Post" SET "giveawayItemType" = 'avatar' WHERE "giveawayItemType" = 'pfp';
UPDATE "Post" SET "unboxItemType" = 'avatar' WHERE "unboxItemType" = 'pfp';
UPDATE "TradeOffer" SET "offerItems" = REPLACE("offerItems"::text, '"type":"pfp"', '"type":"avatar"')::jsonb WHERE "offerItems"::text LIKE '%"type":"pfp"%';
UPDATE "TradeOffer" SET "wantItems" = REPLACE("wantItems"::text, '"type":"pfp"', '"type":"avatar"')::jsonb WHERE "wantItems"::text LIKE '%"type":"pfp"%';
UPDATE "DynamicPrice" SET "itemType" = 'avatar' WHERE "itemType" = 'pfp';
