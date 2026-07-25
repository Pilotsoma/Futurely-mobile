import { Router, Response } from 'express';
import { AuthRequest } from '../../middleware/auth';
import { prisma } from '../../lib/prisma';
import { loginClasslink, getOrRefreshSession } from './classlinkClient';
import { getSchoologyGradebook } from './schoologyClient';
import { getInfiniteCampusData } from './infiniteCampusClient';
import { getDistrict, listDistricts } from './districtConfig';
import { encryptPassword, decryptPassword } from '../grades/credentialCrypto';

const router = Router();

const asyncHandler = (fn: (req: AuthRequest, res: Response) => Promise<void>) =>
  (req: AuthRequest, res: Response, next: (err?: unknown) => void) => {
    Promise.resolve(fn(req, res)).catch(next);
  };

// GET /integrations/classlink/districts
router.get('/districts', asyncHandler(async (_req, res) => {
  res.json({ districts: listDistricts() });
}));

// POST /integrations/classlink/connect
// Body: { districtId, username, password }
router.post('/connect', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const { districtId, username, password } = req.body as {
    districtId?: string; username?: string; password?: string;
  };

  if (!districtId || !username || !password) {
    res.status(400).json({ error: { code: 'MISSING_FIELDS', message: 'districtId, username, and password are required' } });
    return;
  }

  let district;
  try {
    district = getDistrict(districtId);
  } catch {
    res.status(400).json({ error: { code: 'UNKNOWN_DISTRICT', message: `Unknown district: "${districtId}"` } });
    return;
  }

  try {
    await loginClasslink(userId, username, password, district);
  } catch (err) {
    const msg = err instanceof Error ? err.message : '';
    if (msg.startsWith('CLASSLINK_GOOGLE_SSO')) {
      res.status(400).json({ error: { code: 'GOOGLE_SSO', message: 'This district uses Google SSO — username/password login is not supported. Contact your school for direct ClassLink credentials.' } });
      return;
    }
    if (msg.startsWith('CLASSLINK_INVALID_CREDENTIALS')) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Incorrect username or password. Please try again.' } });
      return;
    }
    // Network / timeout / unexpected — surface the real message so we can diagnose
    res.status(502).json({ error: { code: 'LOGIN_FAILED', message: `ClassLink login failed: ${msg || 'Unknown error'}` } });
    return;
  }

  // Persist credentials using existing SchoolConnection model:
  //   systemType = "CLASSLINK", districtUrl = districtId slug, hacUsername = username
  const encrypted = encryptPassword(password);
  await prisma.schoolConnection.upsert({
    where: { userId },
    create: {
      userId,
      systemType: 'CLASSLINK',
      districtUrl: districtId,
      hacUsername: username,
      encryptedPassword: encrypted,
    },
    update: {
      systemType: 'CLASSLINK',
      districtUrl: districtId,
      hacUsername: username,
      encryptedPassword: encrypted,
    },
  });

  res.json({
    success: true,
    districtName: district.name,
    schoology: district.schoology.enabled,
    infiniteCampus: district.infiniteCampus.enabled,
  });
}));

// GET /integrations/classlink/schoology/gradebook
router.get('/schoology/gradebook', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const connection = await prisma.schoolConnection.findFirst({
    where: { userId, systemType: 'CLASSLINK' },
    select: { districtUrl: true, hacUsername: true, encryptedPassword: true },
  });

  if (!connection?.districtUrl || !connection.hacUsername || !connection.encryptedPassword) {
    res.status(404).json({ error: { code: 'NOT_CONNECTED', message: 'No ClassLink connection found. POST /connect first.' } });
    return;
  }

  let district;
  try {
    district = getDistrict(connection.districtUrl);
  } catch {
    res.status(400).json({ error: { code: 'UNKNOWN_DISTRICT', message: `Stored district "${connection.districtUrl}" is no longer configured.` } });
    return;
  }

  if (!district.schoology.enabled) {
    res.status(400).json({ error: { code: 'SCHOOLOGY_DISABLED', message: `Schoology is not enabled for district "${district.id}".` } });
    return;
  }

  try {
    const password = decryptPassword(connection.encryptedPassword);
    const session = await getOrRefreshSession(userId, connection.hacUsername, password, district);
    const gradebook = await getSchoologyGradebook(session, district);
    res.json(gradebook);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('SCHOOLOGY_SSO_FAILED')) {
      res.status(502).json({ error: { code: 'SCHOOLOGY_SSO_FAILED', message: 'Could not establish Schoology session via ClassLink. Try reconnecting.' } });
      return;
    }
    if (msg.startsWith('CLASSLINK_INVALID_CREDENTIALS')) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'ClassLink credentials are no longer valid. Please reconnect.' } });
      return;
    }
    throw err; // re-throw for the global error handler
  }
}));

// GET /integrations/classlink/infinitecampus
router.get('/infinitecampus', asyncHandler(async (req, res) => {
  const userId = req.userId!;
  const connection = await prisma.schoolConnection.findFirst({
    where: { userId, systemType: 'CLASSLINK' },
    select: { districtUrl: true, hacUsername: true, encryptedPassword: true },
  });

  if (!connection?.districtUrl || !connection.hacUsername || !connection.encryptedPassword) {
    res.status(404).json({ error: { code: 'NOT_CONNECTED', message: 'No ClassLink connection found. POST /connect first.' } });
    return;
  }

  let district;
  try {
    district = getDistrict(connection.districtUrl);
  } catch {
    res.status(400).json({ error: { code: 'UNKNOWN_DISTRICT', message: `Stored district "${connection.districtUrl}" is no longer configured.` } });
    return;
  }

  if (!district.infiniteCampus.enabled) {
    res.status(400).json({ error: { code: 'IC_DISABLED', message: `Infinite Campus is not enabled for district "${district.id}".` } });
    return;
  }

  try {
    const password = decryptPassword(connection.encryptedPassword);
    const session = await getOrRefreshSession(userId, connection.hacUsername, password, district);
    const data = await getInfiniteCampusData(session, district);
    res.json(data);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.startsWith('IC_SSO_FAILED')) {
      res.status(502).json({ error: { code: 'IC_SSO_FAILED', message: 'Could not establish Infinite Campus session via ClassLink. Try reconnecting.' } });
      return;
    }
    if (msg.startsWith('CLASSLINK_INVALID_CREDENTIALS')) {
      res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'ClassLink credentials are no longer valid. Please reconnect.' } });
      return;
    }
    throw err;
  }
}));

export default router;
