-- Fix "dateOfBirth" column type on User: it was created as a native
-- DATE/TIMESTAMP column by an earlier (pre-encryption) version of this
-- field. The schema has declared it String (encrypted AES-256-GCM
-- ciphertext, format "iv:tag:data") for some time, but no migration ever
-- altered the underlying column's physical type to match — every write of
-- a real ciphertext into it failed with Postgres error 22007 ("invalid
-- input syntax for type date").
--
-- Any existing value (expected to be NULL for effectively all rows, since
-- nothing wrote to this column before the DOB verification feature) is
-- safely cast to its text representation.
DO $$ BEGIN
  IF (
    SELECT data_type FROM information_schema.columns
    WHERE table_name = 'User' AND column_name = 'dateOfBirth'
  ) <> 'text' THEN
    ALTER TABLE "User" ALTER COLUMN "dateOfBirth" TYPE TEXT USING "dateOfBirth"::TEXT;
  END IF;
END $$;
