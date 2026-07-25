CREATE TABLE IF NOT EXISTS "CanvasConnection" (
    "id" SERIAL NOT NULL,
    "userId" INTEGER NOT NULL,
    "canvasInstanceUrl" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "canvasUserId" TEXT,
    "canvasUserName" TEXT,
    "lastSynced" TIMESTAMP(3),
    "syncStatus" TEXT,
    "syncError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanvasConnection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "CanvasConnection_userId_key" ON "CanvasConnection"("userId");

ALTER TABLE "CanvasConnection" ADD CONSTRAINT "CanvasConnection_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
