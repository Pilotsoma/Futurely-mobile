#!/usr/bin/env node
/**
 * Baselines all existing Prisma migrations as "already applied" for databases
 * that were originally set up with `prisma db push` instead of `prisma migrate`.
 * Safe to run repeatedly — already-tracked migrations are silently skipped.
 */
const { execSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const migrationsDir = path.join(__dirname, '..', 'prisma', 'migrations')
const entries = fs.readdirSync(migrationsDir).sort()

for (const entry of entries) {
  if (!fs.statSync(path.join(migrationsDir, entry)).isDirectory()) continue
  try {
    execSync(`npx prisma migrate resolve --applied "${entry}"`, { stdio: 'pipe' })
    console.log(`✓ Baselined: ${entry}`)
  } catch {
    console.log(`~ Already tracked: ${entry}`)
  }
}
