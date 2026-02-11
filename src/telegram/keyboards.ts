export function getReplyKeyboard() {
  return {
    keyboard: [
      [{ text: '🔍 Поиск' }, { text: '📊 Статистика' }],
      [{ text: '💾 Экспорт' }, { text: '🗑️ Очистить' }],
    ],
    resize_keyboard: true,
    is_persistent: false,
  };
}

export function getConfirmClearKeyboard() {
  return {
    inline_keyboard: [
      [
        { text: '✅ Да, очистить', callback_data: 'clear_confirm' },
        { text: '❌ Отмена', callback_data: 'clear_cancel' },
      ],
    ],
  };
}
