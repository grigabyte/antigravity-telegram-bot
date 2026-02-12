import type { TelegramUpdate } from '../../src/types.js';

type TelegramMessage = NonNullable<TelegramUpdate['message']>;

export function createMessageUpdate(overrides: Partial<TelegramUpdate> = {}): TelegramUpdate {
  const baseMessage: TelegramMessage = {
    message_id: 10,
    date: Math.floor(Date.now() / 1000),
    chat: { id: 12345, type: 'private' },
    from: { id: 777, first_name: 'Test' },
    text: 'test message',
  };

  const base: TelegramUpdate = {
    update_id: 1000,
    message: baseMessage,
  };

  const overrideMessage = overrides.message;

  const mergedMessage: TelegramMessage = {
    ...baseMessage,
    ...overrideMessage,
    chat: {
      ...baseMessage.chat,
      ...overrideMessage?.chat,
    },
    from: {
      ...baseMessage.from,
      ...overrideMessage?.from,
    },
    message_id: overrideMessage?.message_id ?? baseMessage.message_id,
    date: overrideMessage?.date ?? baseMessage.date,
  };

  return {
    ...base,
    ...overrides,
    message: mergedMessage,
  };
}
