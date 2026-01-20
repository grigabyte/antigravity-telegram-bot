/**
 * Account rotation for Antigravity-style multi-account setup
 * Stores account state in Redis for persistence across serverless invocations
 */

import { Redis } from '@upstash/redis';

export interface Account {
  email: string;
  refreshToken: string;
  projectId?: string;
  rateLimitUntil?: number;
}

// Initialize Redis client
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ACCOUNTS_KEY = 'accounts';
const CURRENT_INDEX_KEY = 'current_account_index';
const RATE_LIMIT_PREFIX = 'rate_limit:';

/**
 * Get all accounts from Redis
 */
export async function getAccounts(): Promise<Account[]> {
  const accounts = await redis.get<Account[]>(ACCOUNTS_KEY);
  return accounts || [];
}

/**
 * Save accounts to Redis
 */
export async function saveAccounts(accounts: Account[]): Promise<void> {
  await redis.set(ACCOUNTS_KEY, accounts);
}

/**
 * Get the next available account (round-robin with rate limit awareness)
 */
export async function getNextAccount(): Promise<Account | null> {
  const accounts = await getAccounts();
  if (accounts.length === 0) return null;

  const currentIndex = (await redis.get<number>(CURRENT_INDEX_KEY)) || 0;
  const now = Date.now();

  // Try to find an available account starting from current index
  for (let i = 0; i < accounts.length; i++) {
    const index = (currentIndex + i) % accounts.length;
    const account = accounts[index];
    
    // Check if rate limited
    const rateLimitUntil = await redis.get<number>(`${RATE_LIMIT_PREFIX}${account.email}`);
    if (!rateLimitUntil || rateLimitUntil < now) {
      // Update index for next call
      await redis.set(CURRENT_INDEX_KEY, (index + 1) % accounts.length);
      return account;
    }
  }

  // All accounts are rate limited, return the one that will be available soonest
  let soonestAccount = accounts[0];
  let soonestTime = Infinity;

  for (const account of accounts) {
    const rateLimitUntil = await redis.get<number>(`${RATE_LIMIT_PREFIX}${account.email}`);
    if (rateLimitUntil && rateLimitUntil < soonestTime) {
      soonestTime = rateLimitUntil;
      soonestAccount = account;
    }
  }

  return soonestAccount;
}

/**
 * Mark an account as rate limited
 */
export async function markRateLimited(email: string, durationMs: number = 60000): Promise<void> {
  const until = Date.now() + durationMs;
  await redis.set(`${RATE_LIMIT_PREFIX}${email}`, until, { ex: Math.ceil(durationMs / 1000) });
}

/**
 * Initialize accounts from environment variable
 * Format: JSON array of { email, refreshToken } objects
 */
export async function initAccountsFromEnv(): Promise<void> {
  const accountsJson = process.env.GOOGLE_ACCOUNTS;
  if (!accountsJson) {
    console.warn('No GOOGLE_ACCOUNTS environment variable found');
    return;
  }

  try {
    const accounts = JSON.parse(accountsJson) as Account[];
    await saveAccounts(accounts);
    console.log(`Initialized ${accounts.length} accounts`);
  } catch (error) {
    console.error('Failed to parse GOOGLE_ACCOUNTS:', error);
  }
}
