-- CreateTable
CREATE TABLE "Course" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "name" TEXT NOT NULL,
    "teacher" TEXT NOT NULL,
    "period" INTEGER NOT NULL,
    "courseType" TEXT NOT NULL,
    "creditHours" INTEGER NOT NULL,
    "semester" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    CONSTRAINT "Course_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Grade" (
    "id" INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
    "letterGrade" TEXT NOT NULL,
    "percentage" REAL NOT NULL,
    "gradingPeriod" TEXT NOT NULL,
    "courseId" INTEGER NOT NULL,
    CONSTRAINT "Grade_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
