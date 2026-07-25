// DEBUG HARNESS for ClassLink / Schoology / Infinite Campus
// Usage:
//   npx ts-node src/integrations/classlink/debug-classlink.ts <districtId> <username> <password> [flags]
//
// Flags:
//   --dump-classlink            Dump ClassLink launchpad HTML
//   --dump-schoology-grades     Dump Schoology grades page + iapi2 JSON
//   --dump-ic                   Dump all Infinite Campus pages
//   --all (default)             Dump everything
//
// Example:
//   npx ts-node src/integrations/classlink/debug-classlink.ts pausd student@pausd.us mypassword --all

import { loginClasslink } from './classlinkClient';
import { getDistrict } from './districtConfig';
import * as fs from 'fs';
import * as path from 'path';

async function main() {
  const positional = process.argv.slice(2).filter(a => !a.startsWith('--'));
  const flags = process.argv.slice(2).filter(a => a.startsWith('--'));
  const [districtId, username, password] = positional;
  const dumpAll = flags.includes('--all') || flags.length === 0;

  if (!districtId || !username || !password) {
    console.error('Usage: npx ts-node debug-classlink.ts <districtId> <username> <password> [--all | --dump-classlink | --dump-schoology-grades | --dump-ic]');
    console.error('Available districts: pausd, srvusd, dasd, shakopee, norristown, fulton, d303');
    process.exit(1);
  }

  let district;
  try {
    district = getDistrict(districtId);
  } catch (e: any) {
    console.error(`Error: ${e.message}`);
    process.exit(1);
  }

  // __dirname is available in CommonJS (ts-node default). Fall back to process.cwd() if undefined.
  const baseDir = (typeof __dirname !== 'undefined' ? __dirname : process.cwd());
  const outDir = path.join(baseDir, '..', '..', '..', '..', 'debug-classlink-output');
  fs.mkdirSync(outDir, { recursive: true });

  console.log(`\nLogging into ClassLink for district: ${district.name}`);
  // Use a dummy numeric userId for debug purposes
  const session = await loginClasslink(999999, username, password, district);
  console.log('ClassLink login succeeded\n');

  // Dump cookies after login
  const cookies = session.cookieJar.getCookiesSync('https://launchpad.classlink.com');
  console.log(`Session cookies on launchpad.classlink.com (${cookies.length}):`);
  cookies.forEach(c => console.log(`  ${c.key}=${c.value.slice(0, 30)}...`));

  // ── Dump 1: ClassLink Launchpad ──────────────────────────────────────────
  if (dumpAll || flags.includes('--dump-classlink')) {
    console.log('Fetching ClassLink launchpad...');
    const resp = await session.http.get(`https://launchpad.classlink.com/${district.classlink.tenant}`);
    const file = path.join(outDir, `${districtId}-classlink-launchpad.html`);
    fs.writeFileSync(file, resp.data as string);
    console.log(`   Saved to: ${file}`);

    const links = ((resp.data as string).match(/href="[^"]*"/g) || []);
    const schoologyLinks = links.filter((l: string) => l.includes('schoology'));
    const icLinks = links.filter((l: string) => l.includes('infinitecampus'));
    console.log(`   Schoology links: ${schoologyLinks.length}`);
    schoologyLinks.forEach((l: string) => console.log(`     ${l}`));
    console.log(`   Infinite Campus links: ${icLinks.length}`);
    icLinks.forEach((l: string) => console.log(`     ${l}`));
  }

  // ── Dump 2: Schoology ─────────────────────────────────────────────────────
  if ((dumpAll || flags.includes('--dump-schoology-grades')) && district.schoology.enabled) {
    console.log('\nFetching Schoology grades page...');
    const schoologyBase = `https://${district.schoology.domain}`;
    try {
      await session.http.get(schoologyBase);
      const gradesResp = await session.http.get(`${schoologyBase}/grades`);
      const file = path.join(outDir, `${districtId}-schoology-grades.html`);
      fs.writeFileSync(file, gradesResp.data as string);
      console.log(`   Saved to: ${file}`);

      const iapiResp = await session.http.get(`${schoologyBase}/iapi2/sections/student/me`, {
        headers: { 'X-Requested-With': 'XMLHttpRequest', Accept: 'application/json' },
      });
      const apiFile = path.join(outDir, `${districtId}-schoology-iapi2-sections.json`);
      fs.writeFileSync(apiFile, JSON.stringify(iapiResp.data, null, 2));
      console.log(`   iapi2 response saved to: ${apiFile}`);
    } catch (e: any) {
      console.error(`   Schoology fetch failed: ${e.message}`);
    }
  }

  // ── Dump 3: Infinite Campus ───────────────────────────────────────────────
  if ((dumpAll || flags.includes('--dump-ic')) && district.infiniteCampus.enabled) {
    const icBase = district.infiniteCampus.baseUrl;
    const appName = district.infiniteCampus.appName;
    const pages = [
      { name: 'schedule', path: `${appName}/portal/schedule.xsl` },
      { name: 'grades', path: `${appName}/portal/grades.xsl` },
      { name: 'attendance', path: `${appName}/portal/attendance.xsl` },
      { name: 'transcript', path: `${appName}/portal/transcript.xsl` },
      { name: 'student-profile', path: `${appName}/portal/student.xsl` },
    ];

    for (const page of pages) {
      console.log(`\nFetching IC ${page.name}...`);
      try {
        const resp = await session.http.get(`${icBase}/${page.path}`);
        const file = path.join(outDir, `${districtId}-ic-${page.name}.html`);
        fs.writeFileSync(file, resp.data as string);
        console.log(`   Saved to: ${file}`);
        const lines = (resp.data as string).split('\n').slice(0, 20);
        console.log(`   First 20 lines:\n${lines.map((l: string) => '   | ' + l).join('\n')}`);
      } catch (e: any) {
        console.error(`   IC ${page.name} failed: ${e.message}`);
        // Try alternate URL patterns
        const altPaths = [
          `${appName}/portal/students/${districtId}.jsp`,
          `${appName}/portal/grades`,
          `${appName}/campus/portal/students/${districtId}.jsp`,
        ];
        for (const alt of altPaths) {
          try {
            const r = await session.http.get(`${icBase}/${alt}`);
            const altFile = path.join(outDir, `${districtId}-ic-${page.name}-alt.html`);
            fs.writeFileSync(altFile, r.data as string);
            console.log(`   Alt path worked: ${alt} -> saved to ${altFile}`);
            break;
          } catch { /* try next */ }
        }
      }
    }
  }

  console.log(`\nDebug dump complete. Check: ${outDir}`);
  console.log('Next steps:');
  console.log('  1. Open the HTML files and inspect the structure');
  console.log('  2. Update selectors in schoologyClient.ts and infiniteCampusClient.ts');
  console.log('  3. Re-run to verify data is being parsed correctly');
}

main().catch(e => {
  console.error(`\nFatal error: ${e.message}`);
  console.error(e.stack);
  process.exit(1);
});
