import { describe, it, expect, vi } from 'vitest';
import * as scheduler from './scheduler';
import * as telegram from './telegram';

// Mock telegram sendMessage
vi.mock('./telegram', () => ({
  sendMessage: vi.fn(() => Promise.resolve({ ok: true }))
}));

const mockDB = (reminders = []) => ({
  prepare: vi.fn((query) => ({
    bind: vi.fn(() => ({
      all: () => Promise.resolve({ results: reminders }),
      run: () => Promise.resolve({ success: true })
    }))
  }))
});

describe('Reminder Scheduler', () => {
  it('should send notifications for due reminders and mark them as done', async () => {
    const dueReminders = [
      { id: 1, title: 'Take Vitamin D', remind_at: '2020-01-01 10:00:00', status: 'pending' }
    ];
    const db = mockDB(dueReminders);
    const env = { DB: db };

    await scheduler.checkReminders(env);

    // Verify sendMessage was called
    expect(telegram.sendMessage).toHaveBeenCalledWith(env, expect.stringContaining('Take Vitamin D'));
    
    // Verify DB update was called
    expect(db.prepare).toHaveBeenCalledWith(expect.stringContaining('UPDATE reminders SET status = \'done\''));
  });

  it('should do nothing if no reminders are due', async () => {
    vi.clearAllMocks();
    const db = mockDB([]);
    const env = { DB: db };

    await scheduler.checkReminders(env);

    expect(telegram.sendMessage).not.toHaveBeenCalled();
  });
});
