CREATE TABLE IF NOT EXISTS "ItemPrice" (
    "id" SERIAL NOT NULL,
    "itemType" TEXT NOT NULL,
    "itemId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,

    CONSTRAINT "ItemPrice_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ItemPrice_itemType_itemId_key" ON "ItemPrice"("itemType", "itemId");
