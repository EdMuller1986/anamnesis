import { describe, it, expect } from 'vitest';
import { renderHistory, _changelogTest } from './services/changelog.js';

describe('changelog renderHistory', () => {
  it('renders all audit entity types used by triggers', async () => {
    const types = [
      'timeline', 'document', 'diagnosis', 'medication', 'prescription',
      'plan', 'error', 'lab_result', 'specialist', 'comment',
      'vaccination', 'growth', 'reminder',
    ];
    const rows = types.map((entity_type, i) => ({
      id: i + 1,
      entity_type,
      entity_id: 100 + i,
      action: 'insert',
      new_value: JSON.stringify({
        title: 'T', name: 'N', full_name: 'F', parameter: 'P',
        text: 'hello', measured_at: '2026-01-02', height_cm: 100, weight_kg: 20,
        remind_at: '2026-01-03', status: 'active', medication_id: 5,
      }),
      old_value: null,
      created_at: '2026-08-18 12:00:00',
      patient_id: 1,
    }));

    const out = await renderHistory(rows, { limit: 50 });
    expect(out.groups.length).toBe(1);
    expect(out.groups[0].entries).toHaveLength(types.length);
    expect(out.total).toBe(types.length);

    const byType = Object.fromEntries(out.groups[0].entries.map((e) => [e.entity_type, e]));
    expect(byType.specialist.ref_kind).toBe('specialists');
    expect(byType.error.ref_kind).toBe('error');
    expect(byType.lab_result.ref_kind).toBe('lab');
    expect(byType.vaccination.ref_kind).toBe('vaccinations');
    expect(byType.document.ref_kind).toBe('document');
    expect(byType.growth.icon).toBe('IconRuler2');
  });

  it('groups ISO timestamps with T separator', async () => {
    const out = await renderHistory([
      {
        id: 1, entity_type: 'diagnosis', entity_id: 1, action: 'insert',
        new_value: '{"name":"X"}', created_at: '2026-08-18T15:30:00.000Z',
      },
    ]);
    expect(out.groups[0].date).toBe('2026-08-18');
  });

  it('delete actions clear ref and use red', async () => {
    const out = await renderHistory([
      {
        id: 1, entity_type: 'plan', entity_id: 9, action: 'delete',
        old_value: '{"title":"Gone"}', created_at: '2026-08-18 10:00:00',
      },
    ]);
    const e = out.groups[0].entries[0];
    expect(e.color).toBe('red');
    expect(e.ref_kind).toBeNull();
  });

  it('unknown entity_type still appears', async () => {
    const out = await renderHistory([
      {
        id: 1, entity_type: 'future_thing', entity_id: 1, action: 'insert',
        created_at: '2026-08-18 10:00:00',
      },
    ]);
    expect(out.groups[0].entries[0].title).toContain('future_thing');
  });

  it('dateKey helper', () => {
    expect(_changelogTest.dateKey('2026-01-02 03:04:05')).toBe('2026-01-02');
    expect(_changelogTest.dateKey('2026-01-02T03:04:05Z')).toBe('2026-01-02');
  });
});
