import * as cheerio from 'cheerio';
import { AxiosInstance } from 'axios';
import { ClasslinkSession } from './classlinkClient';
import { DistrictConfig } from './districtConfig';

export interface SchoologyCourse {
  sectionId: string;
  courseId: string;
  courseName: string;
  courseCode: string;
  period: string;
  teacherName: string;
  overallGrade: string | null;
  overallLetter: string | null;
}

export interface SchoologyAssignment {
  id: string;
  title: string;
  dueDate: string | null;
  maxPoints: number | null;
  earnedPoints: number | null;
  grade: string | null;
  category: string;
  isGraded: boolean;
  isMissing: boolean;
  isExcused: boolean;
  courseId: string;
  sectionId: string;
}

export interface SchoologyGradebook {
  courses: SchoologyCourse[];
  assignments: SchoologyAssignment[];
  lastUpdated: Date;
}

export async function getSchoologyGradebook(
  session: ClasslinkSession,
  district: DistrictConfig
): Promise<SchoologyGradebook> {
  if (!district.schoology.enabled) {
    throw new Error(`Schoology is not enabled for district "${district.id}".`);
  }

  const { http } = session;
  const schoologyBase = `https://${district.schoology.domain}`;

  // Navigate to Schoology via ClassLink SSO:
  // Step 1 — load the launchpad apps page, find the Schoology app link, and follow it.
  // Going directly to the Schoology domain skips the SSO handshake and results in a redirect
  // to Schoology's own login page instead of the ClassLink-authenticated session.
  console.log(`[Schoology:${district.id}] Navigating launchpad for SSO...`);
  const appsResp = await http.get(`https://launchpad.classlink.com/${district.classlink.tenant}/apps`);
  const $apps = cheerio.load(appsResp.data as string);

  // Find any link pointing to the Schoology domain
  let ssoEntryUrl: string | undefined;
  $apps('a[href]').each((_i, el) => {
    const href = $apps(el).attr('href') ?? '';
    if (href.includes('schoology') || href.includes(district.schoology.domain)) {
      ssoEntryUrl = href.startsWith('http') ? href : `https://launchpad.classlink.com${href}`;
      return false; // break
    }
  });

  if (ssoEntryUrl) {
    console.log(`[Schoology:${district.id}] Following SSO entry link: ${ssoEntryUrl}`);
    await http.get(ssoEntryUrl, { maxRedirects: 15 });
  } else {
    // Fallback: try navigating directly — may work if already have Schoology cookies
    console.log(`[Schoology:${district.id}] No SSO link found on launchpad — trying direct navigation`);
  }

  // Step 2 — now fetch Schoology home to confirm we have a valid session
  const schoologyHome = await http.get(schoologyBase, { maxRedirects: 15 });
  const finalUrl: string = (schoologyHome.request?.res?.responseUrl as string) || '';
  console.log(`[Schoology:${district.id}] finalUrl after SSO: ${finalUrl}`);

  if (!finalUrl.includes(district.schoology.domain)) {
    throw new Error(
      `SCHOOLOGY_SSO_FAILED: Could not reach Schoology for district "${district.id}". ` +
      `Final URL was: ${finalUrl}. Run debug-classlink.ts to inspect the redirect chain.`
    );
  }

  let courses: SchoologyCourse[] = [];
  const assignments: SchoologyAssignment[] = [];

  // Try Schoology's internal API first
  try {
    const sectionsResp = await http.get(`${schoologyBase}/iapi2/sections/student/me`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      validateStatus: (s) => s < 500, // don't throw on 403/404
    });
    console.log(`[Schoology:${district.id}] iapi2 sections status=${sectionsResp.status}`);
    if (sectionsResp.status === 200) {
      const rawSections = sectionsResp.data?.sections ?? sectionsResp.data?.section;
      if (Array.isArray(rawSections) && rawSections.length > 0) {
        courses = parseSectionsFromAPI(rawSections);
        console.log(`[Schoology:${district.id}] Parsed ${courses.length} courses from iapi2`);
      }
    }
  } catch (err) {
    console.warn(`[Schoology:${district.id}] iapi2 sections error:`, err instanceof Error ? err.message : String(err));
    // fall through to HTML scrape
  }

  if (courses.length === 0) {
    const gradesPageResp = await http.get(`${schoologyBase}/grades`);
    const $ = cheerio.load(gradesPageResp.data as string);
    courses = parseSectionsFromGradesPage($);
  }

  for (const course of courses) {
    const courseAssignments = await getAssignmentsForSection(http, schoologyBase, course.sectionId, course.courseId);
    assignments.push(...courseAssignments);
  }

  return { courses, assignments, lastUpdated: new Date() };
}

function parseSectionsFromAPI(sections: any[]): SchoologyCourse[] {
  return sections.map((s: any) => ({
    sectionId: String(s.id || s.nid || ''),
    courseId: String(s.course_id || ''),
    courseName: s.course_title || s.title || 'Unknown Course',
    courseCode: s.course_code || '',
    period: s.section_title || s.period || '',
    teacherName: s.primary_teacher_display_name || '',
    overallGrade: s.grade ?? null,
    overallLetter: s.letter_grade ?? null,
  }));
}

function parseSectionsFromGradesPage($: cheerio.CheerioAPI): SchoologyCourse[] {
  const courses: SchoologyCourse[] = [];
  // Selectors cover common Schoology layouts — run debug harness to confirm for each district
  $('.gradebook-course-row, .course-row').each((_i, el) => {
    const sectionId = $(el).attr('data-section-nid') || $(el).attr('data-id') || '';
    const courseId = $(el).attr('data-course-nid') || '';
    const courseName = $(el).find('.title, .course-name').first().text().trim();
    const grade = $(el).find('.grade, .overall-grade').first().text().trim();
    if (courseName) {
      courses.push({ sectionId, courseId, courseName, courseCode: '', period: '', teacherName: '', overallGrade: grade || null, overallLetter: null });
    }
  });
  return courses;
}

async function getAssignmentsForSection(
  http: AxiosInstance,
  base: string,
  sectionId: string,
  _courseId: string
): Promise<SchoologyAssignment[]> {
  if (!sectionId) return [];

  try {
    const resp = await http.get(`${base}/iapi2/gradebook/student/${sectionId}`, {
      headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      validateStatus: (s) => s < 500,
    });
    if (resp.status === 200) {
      const items = resp.data?.grade_items ?? resp.data?.gradeItems;
      if (Array.isArray(items) && items.length > 0) {
        return parseAssignmentsFromAPI(items, sectionId);
      }
    }
  } catch { /* fall through */ }

  try {
    const resp = await http.get(`${base}/grades/section/${sectionId}`);
    const $ = cheerio.load(resp.data as string);
    return parseAssignmentsFromHTML($, sectionId);
  } catch {
    return [];
  }
}

function parseAssignmentsFromAPI(items: any[], sectionId: string): SchoologyAssignment[] {
  return items.map((item: any) => ({
    id: String(item.id || item.assignment_id || ''),
    title: item.title || item.assignment_title || 'Untitled',
    dueDate: item.due || item.due_date || null,
    maxPoints: item.max_points != null ? Number(item.max_points) : null,
    earnedPoints: item.grade != null ? Number(item.grade) : null,
    grade: item.letter_grade || null,
    category: item.grading_category || item.category || 'Assignment',
    isGraded: item.is_graded ?? item.grade != null,
    isMissing: item.missing === 1 || item.is_missing === true,
    isExcused: item.excused === 1 || item.is_excused === true,
    courseId: String(item.course_id || ''),
    sectionId,
  }));
}

function parseAssignmentsFromHTML($: cheerio.CheerioAPI, sectionId: string): SchoologyAssignment[] {
  const assignments: SchoologyAssignment[] = [];
  $('tr.item-row, .gradebook-row').each((_i, el) => {
    const title = $(el).find('.title, .assignment-title').first().text().trim();
    const earned = $(el).find('.grade-column .rounded-grade, .score').first().text().trim();
    const max = $(el).find('.max-grade, .out-of').first().text().trim();
    const dueDate = $(el).find('.due-date').first().attr('data-date') || null;
    const category = $(el).find('.category').first().text().trim();
    if (title) {
      assignments.push({
        id: $(el).attr('data-id') || '',
        title,
        dueDate,
        maxPoints: max ? Number(max.replace(/[^0-9.]/g, '')) : null,
        earnedPoints: earned && earned !== '-' ? Number(earned.replace(/[^0-9.]/g, '')) : null,
        grade: null,
        category: category || 'Assignment',
        isGraded: earned !== '' && earned !== '-',
        isMissing: $(el).hasClass('missing'),
        isExcused: $(el).hasClass('excused'),
        courseId: '',
        sectionId,
      });
    }
  });
  return assignments;
}
import { safeConsole as console } from '../../common/safeConsole'
