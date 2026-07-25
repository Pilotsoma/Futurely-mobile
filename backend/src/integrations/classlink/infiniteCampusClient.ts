import * as cheerio from 'cheerio';
import { AxiosInstance } from 'axios';
import { ClasslinkSession } from './classlinkClient';
import { DistrictConfig } from './districtConfig';

export interface ICCourse {
  courseName: string;
  courseCode: string;
  period: string;
  teacherName: string;
  room: string;
  term: string;
  grade: string | null;
  letter: string | null;
  credits: number | null;
}

export interface ICAttendanceRecord {
  date: string;
  period: string;
  courseName: string;
  status: string;
}

export interface ICReportCard {
  term: string;
  courses: ICCourse[];
  gpa: string | null;
}

export interface ICStudentData {
  schedule: ICCourse[];
  reportCards: ICReportCard[];
  attendance: ICAttendanceRecord[];
  transcript: ICCourse[];
  counselorName: string | null;
  counselorEmail: string | null;
}

/**
 * Try multiple URL patterns for an Infinite Campus portal page.
 * IC districts vary: some serve .xsl, some .jsp, some no extension.
 * Returns the HTML string of the first URL that returns HTTP 200 with content.
 */
async function fetchICPage(
  http: AxiosInstance,
  icBase: string,
  appName: string,
  pageName: string
): Promise<string | null> {
  const patterns = [
    `${icBase}/${appName}/portal/${pageName}.xsl`,
    `${icBase}/${appName}/portal/${pageName}.jsp`,
    `${icBase}/${appName}/portal/${pageName}`,
    `${icBase}/${appName}/campus/portal/${pageName}.xsl`,
    `${icBase}/${appName}/campus/portal/${pageName}`,
  ];

  for (const url of patterns) {
    try {
      const resp = await http.get(url, {
        validateStatus: (s) => s < 500,
        maxRedirects: 10,
      });
      if (resp.status === 200 && typeof resp.data === 'string' && resp.data.length > 200) {
        // Make sure we didn't end up on a login page
        const lower = resp.data.toLowerCase();
        if (!lower.includes('login') || lower.includes('<table') || lower.includes('<div')) {
          console.log(`[IC] Page "${pageName}" found at: ${url} (${resp.data.length} bytes)`);
          return resp.data;
        }
      }
    } catch (e) {
      // try next pattern
    }
  }
  console.warn(`[IC] Page "${pageName}" not found at any URL pattern`);
  return null;
}

export async function getInfiniteCampusData(
  session: ClasslinkSession,
  district: DistrictConfig
): Promise<ICStudentData> {
  if (!district.infiniteCampus.enabled) {
    throw new Error(`Infinite Campus is not enabled for district "${district.id}".`);
  }

  const { http } = session;
  const icBase = district.infiniteCampus.baseUrl;
  const appName = district.infiniteCampus.appName;

  // Step 1: Navigate to IC via ClassLink SSO.
  // Strategy A: Try the launchpad apps page, find an Infinite Campus link, and follow it.
  // This establishes the SSO session on the IC domain.
  console.log(`[IC:${district.id}] Initiating SSO via ClassLink launchpad...`);
  let ssoEstablished = false;

  try {
    const appsResp = await http.get(`https://launchpad.classlink.com/${district.classlink.tenant}/apps`, {
      maxRedirects: 15,
      validateStatus: (s) => s < 500,
    });
    const $apps = cheerio.load(appsResp.data as string);
    let icAppLink: string | undefined;
    $apps('a[href]').each((_i, el) => {
      const href = $apps(el).attr('href') ?? '';
      if (href.includes('infinitecampus') || href.includes(new URL(icBase).hostname)) {
        icAppLink = href.startsWith('http') ? href : `https://launchpad.classlink.com${href}`;
        return false;
      }
    });

    if (icAppLink) {
      console.log(`[IC:${district.id}] Following SSO link: ${icAppLink}`);
      const ssoResp = await http.get(icAppLink, { maxRedirects: 15, validateStatus: (s) => s < 500 });
      const ssoFinalUrl: string = (ssoResp.request?.res?.responseUrl as string) || '';
      ssoEstablished = ssoFinalUrl.includes(new URL(icBase).hostname);
      console.log(`[IC:${district.id}] SSO final URL: ${ssoFinalUrl}, established=${ssoEstablished}`);
    }
  } catch (e) {
    console.warn(`[IC:${district.id}] Launchpad SSO attempt failed:`, e instanceof Error ? e.message : String(e));
  }

  // Strategy B: If launchpad SSO didn't work, try the portal directly
  if (!ssoEstablished) {
    const directUrls = [
      `${icBase}/${appName}/portal/students/${district.id}.jsp`,
      `${icBase}/${appName}/portal/portalOutline.xsl`,
      `${icBase}/${appName}/portal`,
    ];
    for (const url of directUrls) {
      try {
        const resp = await http.get(url, { maxRedirects: 15, validateStatus: (s) => s < 500 });
        const finalUrl: string = (resp.request?.res?.responseUrl as string) || '';
        if (!finalUrl.includes('/login') && !finalUrl.includes('/LogOn') && !finalUrl.includes('/auth')) {
          console.log(`[IC:${district.id}] Direct portal access succeeded: ${finalUrl}`);
          ssoEstablished = true;
          break;
        }
      } catch { /* try next */ }
    }
  }

  if (!ssoEstablished) {
    throw new Error(
      `IC_SSO_FAILED: Could not reach Infinite Campus for district "${district.id}". ` +
      `Run debug-classlink.ts --dump-ic to inspect the portal HTML.`
    );
  }

  // Step 2: Fetch all IC pages in parallel, trying multiple URL patterns each
  const [scheduleHtml, gradesHtml, attendanceHtml, transcriptHtml] = await Promise.all([
    fetchICPage(http, icBase, appName, 'schedule'),
    fetchICPage(http, icBase, appName, 'grades'),
    fetchICPage(http, icBase, appName, 'attendance'),
    fetchICPage(http, icBase, appName, 'transcript'),
  ]);

  const schedule = scheduleHtml ? parseICSchedule(cheerio.load(scheduleHtml), district.id) : [];
  const reportCards = gradesHtml ? parseICGrades(cheerio.load(gradesHtml), district.id) : [];
  const attendance = attendanceHtml ? parseICAttendance(cheerio.load(attendanceHtml), district.id) : [];
  const transcript = transcriptHtml ? parseICTranscript(cheerio.load(transcriptHtml), district.id) : [];

  let counselorName: string | null = null;
  let counselorEmail: string | null = null;
  try {
    const profileHtml = await fetchICPage(http, icBase, appName, 'student');
    if (profileHtml) {
      const $p = cheerio.load(profileHtml);
      counselorName = $p('dt:contains("Counselor"), td:contains("Counselor")').next().text().trim() || null;
      counselorEmail = $p('a[href*="mailto:"]').filter((_i, el) => {
        return $p(el).closest('tr, .counselor-row').text().toLowerCase().includes('counselor');
      }).attr('href')?.replace('mailto:', '') || null;
    }
  } catch { /* non-fatal */ }

  return { schedule, reportCards, attendance, transcript, counselorName, counselorEmail };
}

// NOTE: IC portal renders .xsl pages as HTML. Selectors below cover common IC layouts.
// Run debug-classlink.ts --dump-ic to capture raw HTML and tune selectors per district.

function parseICSchedule($: cheerio.CheerioAPI, districtId: string): ICCourse[] {
  const courses: ICCourse[] = [];

  // Try multiple selectors — IC layouts vary by version
  const selectors = ['tr.schedule-row', '.classRow', 'tr[data-period]', 'tr.listrow', 'table.listTable tr'];
  let matched = '';
  for (const sel of selectors) {
    if ($(sel).length > 0) { matched = sel; break; }
  }
  console.log(`[IC:${districtId}] schedule selector match="${matched}" rows=${$(matched || 'tr').length}`);

  $(matched || 'tr.schedule-row, .classRow, tr[data-period]').each((_i, el) => {
    const cells = $(el).find('td');
    if (cells.length >= 3) {
      courses.push({
        period: $(cells[0]).text().trim(),
        courseName: $(cells[1]).text().trim() || $(cells[2]).text().trim(),
        courseCode: $(cells[1]).attr('data-code') || '',
        teacherName: cells.length > 3 ? $(cells[3]).text().trim() : $(cells[2]).text().trim(),
        room: cells.length > 4 ? $(cells[4]).text().trim() : '',
        term: '',
        grade: null,
        letter: null,
        credits: null,
      });
    }
  });
  console.log(`[IC:${districtId}] schedule parsed ${courses.length} courses`);
  return courses;
}

function parseICGrades($: cheerio.CheerioAPI, districtId: string): ICReportCard[] {
  const reportCards: ICReportCard[] = [];

  // Try multiple term header selectors
  const termSelectors = ['.gradingPeriod', '.term-header', 'h3', 'h4', '.reportCard h2', 'caption'];
  let termSel = '';
  for (const sel of termSelectors) {
    if ($(sel).length > 0) { termSel = sel; break; }
  }
  console.log(`[IC:${districtId}] grades term selector="${termSel}" count=${$(termSel || 'h3').length}`);

  $(termSel || '.gradingPeriod, .term-header, h3, h4').each((_i, termEl) => {
    const term = $(termEl).text().trim();
    if (!term || term.length > 50) return;

    const courses: ICCourse[] = [];
    $(termEl).nextUntil('.gradingPeriod, .term-header, h3, h4', 'tr.courseRow, tr, .courseRow').each((_j, row) => {
      // Try multiple selectors for course name
      const courseName =
        $(row).find('.courseName').first().text().trim() ||
        $(row).find('td:nth-child(1)').first().text().trim() ||
        $(row).find('td').first().text().trim();
      const grade =
        $(row).find('.grade').first().text().trim() ||
        $(row).find('td.grade').first().text().trim() ||
        $(row).find('td:nth-child(4)').first().text().trim();
      const letter =
        $(row).find('.letter').first().text().trim() ||
        $(row).find('td.letter').first().text().trim();
      if (courseName && !/^(course|class|subject|period)/i.test(courseName)) {
        courses.push({
          courseName,
          courseCode: '',
          period: $(row).find('.period, td.period').first().text().trim(),
          teacherName: $(row).find('.teacher, td.teacher').first().text().trim(),
          room: '',
          term,
          grade: grade || null,
          letter: letter || null,
          credits: null,
        });
      }
    });

    const gpa = $('*:contains("GPA")').filter((_k, el) => $(el).children().length === 0)
      .first().text().replace(/[^0-9.]/g, '') || null;

    if (courses.length > 0) {
      reportCards.push({ term, courses, gpa });
    }
  });
  console.log(`[IC:${districtId}] grades parsed ${reportCards.length} report cards`);
  return reportCards;
}

function parseICAttendance($: cheerio.CheerioAPI, districtId: string): ICAttendanceRecord[] {
  const records: ICAttendanceRecord[] = [];

  const selectors = ['tr.attendance-row', 'tr[data-date]', 'tr.listrow', 'table.listTable tr'];
  let matched = '';
  for (const sel of selectors) {
    if ($(sel).length > 0) { matched = sel; break; }
  }
  console.log(`[IC:${districtId}] attendance selector="${matched}"`);

  $(matched || 'tr.attendance-row, tr[data-date]').each((_i, el) => {
    const cells = $(el).find('td');
    if (cells.length < 2) return;
    records.push({
      date: $(el).attr('data-date') || $(cells[0]).text().trim(),
      period: $(cells[1]).text().trim(),
      courseName: cells.length > 2 ? $(cells[2]).text().trim() : '',
      status: cells.length > 3 ? $(cells[3]).text().trim() : 'Unknown',
    });
  });
  console.log(`[IC:${districtId}] attendance parsed ${records.length} records`);
  return records;
}

function parseICTranscript($: cheerio.CheerioAPI, districtId: string): ICCourse[] {
  const courses: ICCourse[] = [];

  const selectors = ['tr.transcript-row', 'tr[data-course]', 'tr.listrow', 'table.transcriptTable tr'];
  let matched = '';
  for (const sel of selectors) {
    if ($(sel).length > 0) { matched = sel; break; }
  }
  console.log(`[IC:${districtId}] transcript selector="${matched}"`);

  $(matched || 'tr.transcript-row, tr[data-course]').each((_i, el) => {
    const cells = $(el).find('td');
    if (cells.length >= 3) {
      const courseName = $(cells[0]).text().trim() || $(cells[1]).text().trim();
      if (!courseName || /^(course|class|subject)/i.test(courseName)) return;
      courses.push({
        courseName,
        courseCode: $(cells[0]).attr('data-code') || '',
        period: '',
        teacherName: '',
        room: '',
        term: $(cells[1]).text().trim(),
        grade: $(cells[cells.length - 2]).text().trim() || null,
        letter: $(cells[cells.length - 1]).text().trim() || null,
        credits: null,
      });
    }
  });
  console.log(`[IC:${districtId}] transcript parsed ${courses.length} courses`);
  return courses;
}
import { safeConsole as console } from '../../common/safeConsole'
