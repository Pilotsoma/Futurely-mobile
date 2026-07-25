-- Add counselorLastReadAt to CounselorStudentLink for unread message tracking
ALTER TABLE "CounselorStudentLink" ADD COLUMN "counselorLastReadAt" TIMESTAMP(3);
