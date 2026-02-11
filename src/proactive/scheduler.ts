import { REQUEST_TIMEOUTS, TELEGRAM_API_BASE } from '../config.js';
import { fetchWithTimeout } from '../network/fetch.js';
import { getUserSettings, supabaseQuery } from '../db/supabase.js';
import { sendTelegram } from '../telegram/client.js';
import { isInQuietHours } from '../time/clock.js';

interface ProactiveJob {
  id: number;
  user_id: number;
  chat_id: number;
  job_type: string;
  due_at: number;
  payload: {
    text: string;
  };
  status: 'pending' | 'sent' | 'cancelled';
}

export async function scheduleProactiveMessage(
  userId: number,
  chatId: number,
  dueAt: number,
  text: string,
  jobType: string = 'followup'
): Promise<void> {
  await supabaseQuery('proactive_jobs', 'POST', {
    user_id: userId,
    chat_id: chatId,
    job_type: jobType,
    due_at: dueAt,
    payload: { text },
    status: 'pending',
  });
}

export async function hasPendingProactiveJob(userId: number, jobType: string): Promise<boolean> {
  const rows = await supabaseQuery(
    'proactive_jobs',
    'GET',
    null,
    `?user_id=eq.${userId}&job_type=eq.${jobType}&status=eq.pending&order=due_at.desc&limit=1`
  );
  return Array.isArray(rows) && rows.length > 0;
}

export async function runDueProactiveJobs(nowTs: number = Date.now()): Promise<number> {
  const jobs = (await supabaseQuery(
    'proactive_jobs',
    'GET',
    null,
    `?status=eq.pending&due_at=lte.${nowTs}&order=due_at.asc&limit=20`
  )) as ProactiveJob[];

  let sent = 0;

  for (const job of jobs || []) {
    try {
      const settings = await getUserSettings(job.user_id);
      if (isInQuietHours(settings.timezone, settings.quietHoursStart, settings.quietHoursEnd)) {
        const deferredTs = nowTs + 60 * 60 * 1000;
        await supabaseQuery(
          'proactive_jobs',
          'PATCH',
          { due_at: deferredTs },
          `?id=eq.${job.id}`
        );
        continue;
      }

      await sendTelegram(job.chat_id, job.payload.text, undefined, true);
      await supabaseQuery(
        'proactive_jobs',
        'PATCH',
        { status: 'sent', sent_at: new Date().toISOString() },
        `?id=eq.${job.id}`
      );
      sent += 1;
    } catch (error) {
      console.error('Proactive job failed:', job.id, error);
    }
  }

  return sent;
}

export async function pingWebhookHealth(): Promise<boolean> {
  const response = await fetchWithTimeout(
    `${TELEGRAM_API_BASE}/getMe`,
    { method: 'GET' },
    REQUEST_TIMEOUTS.telegram
  );
  return response.ok;
}
