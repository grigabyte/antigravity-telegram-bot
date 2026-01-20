/**
 * Script to initialize accounts in Redis
 * Reads from antigravity-accounts.json and uploads to Upstash
 * 
 * Usage: node scripts/init-accounts.js
 */

import { Redis } from '@upstash/redis';
import { readFileSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN,
});

async function main() {
  // Read antigravity accounts
  const accountsPath = join(homedir(), '.config/opencode/antigravity-accounts.json');
  
  let antigravityData;
  try {
    const content = readFileSync(accountsPath, 'utf-8');
    antigravityData = JSON.parse(content);
  } catch (error) {
    console.error('Failed to read antigravity-accounts.json:', error.message);
    process.exit(1);
  }

  // Transform to our format
  const accounts = antigravityData.accounts.map(acc => ({
    email: acc.email,
    refreshToken: acc.refreshToken,
    projectId: acc.projectId || acc.managedProjectId,
  }));

  // Save to Redis
  await redis.set('accounts', accounts);
  
  console.log(`✅ Uploaded ${accounts.length} accounts to Redis`);
  console.log('Accounts:', accounts.map(a => a.email).join(', '));
}

main().catch(console.error);
