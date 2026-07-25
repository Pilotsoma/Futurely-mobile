import { prisma } from '../lib/prisma'
import { DAILY_COIN_CAP } from '../constants/educator'

export async function grantCoinsToStudent(
  educatorId: number,
  studentId: number,
  coins: number,
): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const today = new Date().toISOString().split('T')[0]
    const agg = await tx.educatorCoinGrant.aggregate({
      where: { studentId, grantDate: today },
      _sum: { coins: true },
    })
    const alreadyGranted = agg._sum.coins ?? 0
    if (alreadyGranted + coins > DAILY_COIN_CAP) {
      throw Object.assign(new Error('COIN_CAP_EXCEEDED'), { code: 'COIN_CAP_EXCEEDED' })
    }
    await tx.educatorCoinGrant.create({
      data: { educatorId, studentId, coins, grantDate: today },
    })
    await tx.user.update({
      where: { id: studentId },
      data: { coins: { increment: coins } },
    })
  })
}
