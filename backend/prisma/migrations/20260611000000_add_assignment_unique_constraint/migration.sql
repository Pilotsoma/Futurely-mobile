-- CreateIndex
CREATE UNIQUE INDEX "Assignment_userId_title_subject_key" ON "Assignment"("userId", "title", "subject");

