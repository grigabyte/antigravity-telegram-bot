import { getUserSettings, supabaseQuery } from '../db/supabase.js';
import { sendTelegram } from '../telegram/client.js';
import { isInQuietHours } from '../time/clock.js';

const STALE_PROCESSING_MS = 15 * 60 * 1000;

interface ProactiveJobLease {
  id: number;
  user_id: number;
  chat_id: number;
  job_type: string;
  due_at: number;
  payload: { text?: string } | null;
  status: 'processing';
  lease_token: string | null;
}

interface ProactiveRuntimeState {
  supportsLeaseColumns: boolean;
  supportsProcessingStatus: boolean;
}

interface ProactiveRuntimeColumns {
  lease_token?: string | null;
  leased_at?: string | null;
}

function isLegacyProcessingUpgradeError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const message = error.message.toLowerCase();
  return (
    message.includes('processing') &&
    (message.includes('check constraint') || message.includes('violates') || message.includes('23514'))
  );
}

function createLeaseToken(jobId: number): string {
  return `${Date.now()}-${jobId}-${Math.random().toString(36).slice(2, 10)}`;
}

function parseLeaseRows(rows: unknown, supportsLeaseColumns: boolean): ProactiveJobLease[] {
  if (!Array.isArray(rows)) return [];
  return rows
    .map((row) => {
      if (!row || typeof row !== 'object') return null;
      const record = row as Record<string, unknown>;
      if (!Number.isFinite(Number(record.id))) return null;
      const payload = record.payload && typeof record.payload === 'object'
        ? (record.payload as { text?: string })
        : null;
      return {
        id: Number(record.id),
        user_id: Number(record.user_id),
        chat_id: Number(record.chat_id),
        job_type: typeof record.job_type === 'string' ? record.job_type : 'unknown',
        due_at: Number(record.due_at || 0),
        payload,
        status: 'processing' as const,
        lease_token: supportsLeaseColumns && typeof record.lease_token === 'string' ? record.lease_token : null,
      };
    })
    .filter((row): row is ProactiveJobLease => Boolean(row));
}

function applyLeaseFields(
  patch: Record<string, unknown>,
  leaseToken: string | null,
  leasedAt: string | null
): Record<string, unknown> {
  const withLease: Record<string, unknown> = { ...patch };
  const runtimePatch = withLease as ProactiveRuntimeColumns;
  runtimePatch.lease_token = leaseToken;
  runtimePatch.leased_at = leasedAt;
  return withLease;
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
  const leaseToken = createLeaseToken(Math.floor(nowTs % 100000));
  const leaseTs = new Date().toISOString();
  const legacyLeaseDueAt = nowTs + 5 * 60 * 1000;
  const staleIso = new Date(nowTs - STALE_PROCESSING_MS).toISOString();
  let claimedRows: unknown;
  const runtimeState: ProactiveRuntimeState = {
    supportsLeaseColumns: true,
    supportsProcessingStatus: true,
  };

  try {
    await supabaseQuery(
      'proactive_jobs',
      'PATCH',
      {
        status: 'pending',
        lease_token: null,
        leased_at: null,
      },
      `?status=eq.processing&leased_at=lt.${encodeURIComponent(staleIso)}`
    );
  } catch {
    // best-effort stale lease recovery
  }
  try {
    claimedRows = await supabaseQuery(
      'proactive_jobs',
      'PATCH',
      applyLeaseFields({ status: 'processing' }, leaseToken, leaseTs),
      `?status=eq.pending&due_at=lte.${nowTs}&order=due_at.asc&limit=20&select=id,user_id,chat_id,job_type,due_at,payload,lease_token`,
      'return=representation'
    );
  } catch (error) {
    const message = error instanceof Error ? error.message.toLowerCase() : '';
    const leaseColumnsMissing = message.includes('lease_token') || message.includes('leased_at') || message.includes('42703');
    const processingStatusRejected =
      message.includes('processing') && (message.includes('check constraint') || message.includes('violates') || message.includes('23514'));
    if (!leaseColumnsMissing && !processingStatusRejected) {
      throw error;
    }

    runtimeState.supportsLeaseColumns = false;
    runtimeState.supportsProcessingStatus = !processingStatusRejected;
    console.warn('Using legacy proactive claim mode; update SQL migrations for stronger idempotency.');

    if (runtimeState.supportsProcessingStatus) {
      try {
        claimedRows = await supabaseQuery(
          'proactive_jobs',
          'PATCH',
          { status: 'processing' },
          `?status=eq.pending&due_at=lte.${nowTs}&order=due_at.asc&limit=20&select=id,user_id,chat_id,job_type,due_at,payload`,
          'return=representation'
        );
      } catch (legacyError) {
        if (!isLegacyProcessingUpgradeError(legacyError)) {
          throw legacyError;
        }
        runtimeState.supportsProcessingStatus = false;
        claimedRows = await supabaseQuery(
          'proactive_jobs',
          'PATCH',
          { due_at: legacyLeaseDueAt },
          `?status=eq.pending&due_at=lte.${nowTs}&order=due_at.asc&limit=20&select=id,user_id,chat_id,job_type,due_at,payload`,
          'return=representation'
        );
      }
    } else {
      claimedRows = await supabaseQuery(
        'proactive_jobs',
        'PATCH',
        { due_at: legacyLeaseDueAt },
        `?status=eq.pending&due_at=lte.${nowTs}&order=due_at.asc&limit=20&select=id,user_id,chat_id,job_type,due_at,payload`,
        'return=representation'
      );
    }
  }

  const jobs = parseLeaseRows(claimedRows, runtimeState.supportsLeaseColumns);

  let sent = 0;

  for (const job of jobs) {
    const supportsLeaseColumns = runtimeState.supportsLeaseColumns;
    const rowFilter = supportsLeaseColumns
      ? `?id=eq.${job.id}&status=eq.processing&lease_token=eq.${job.lease_token || leaseToken}`
      : runtimeState.supportsProcessingStatus
        ? `?id=eq.${job.id}&status=eq.processing`
        : `?id=eq.${job.id}&status=eq.pending&due_at=eq.${legacyLeaseDueAt}`;

    const releaseDueAt = nowTs + 60 * 1000;

    const releasePatch = supportsLeaseColumns
      ? applyLeaseFields(
          {
            status: 'pending',
          },
          null,
          null
        )
      : {
          status: 'pending',
          due_at: releaseDueAt,
        };

    if (!runtimeState.supportsProcessingStatus && job.due_at > nowTs) {
      continue;
    }

    try {
      if (!job.payload?.text) {
        await supabaseQuery(
          'proactive_jobs',
          'PATCH',
          supportsLeaseColumns
            ? applyLeaseFields(
                {
                  status: 'cancelled',
                },
                null,
                null
              )
            : {
                status: 'cancelled',
                due_at: releaseDueAt,
              },
          rowFilter
        );
        continue;
      }

      const settings = await getUserSettings(job.user_id);
      if (isInQuietHours(settings.timezone, settings.quietHoursStart, settings.quietHoursEnd)) {
        const deferredTs = nowTs + 60 * 60 * 1000;
        await supabaseQuery(
          'proactive_jobs',
          'PATCH',
          supportsLeaseColumns
            ? applyLeaseFields(
                {
                  due_at: deferredTs,
                  status: 'pending',
                },
                null,
                null
              )
            : {
                due_at: deferredTs,
                status: 'pending',
              },
          rowFilter
        );
        continue;
      }

      await sendTelegram(job.chat_id, job.payload.text, undefined, true);
      await supabaseQuery(
        'proactive_jobs',
        'PATCH',
        supportsLeaseColumns
          ? applyLeaseFields(
              {
                status: 'sent',
                sent_at: new Date().toISOString(),
              },
              null,
              null
            )
          : {
              status: 'sent',
              sent_at: new Date().toISOString(),
              due_at: nowTs,
            },
        rowFilter
      );
      sent += 1;
    } catch (error) {
      await supabaseQuery(
        'proactive_jobs',
        'PATCH',
        releasePatch,
        rowFilter
      ).catch(() => {
        // noop
      });
      console.error('Proactive job failed:', job.id, String(error));
    }
  }

  return sent;
}
