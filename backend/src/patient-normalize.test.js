import { describe, it, expect } from 'vitest';
import {
  normalizePatient,
  mapPlanItem,
  mapMedicationRow,
  mapErrorRow,
} from './services/patient-normalize.js';

describe('patient-normalize', () => {
  it('fills full_name from name and date_of_birth from birth_date', () => {
    const p = normalizePatient({
      id: 1,
      name: 'Ivanov Ivan',
      birth_date: '2015-01-01',
      full_name: null,
      date_of_birth: null,
    });
    expect(p.full_name).toBe('Ivanov Ivan');
    expect(p.date_of_birth).toBe('2015-01-01');
    expect(p.name).toBe('Ivanov Ivan');
  });

  it('prefers full_name / date_of_birth when present', () => {
    const p = normalizePatient({
      id: 1,
      name: 'Old',
      full_name: 'New Name',
      birth_date: '2010-01-01',
      date_of_birth: '2011-02-02',
    });
    expect(p.full_name).toBe('New Name');
    expect(p.date_of_birth).toBe('2011-02-02');
  });

  it('maps plan deadline and description aliases', () => {
    const row = mapPlanItem({
      id: 1,
      title: 'T',
      detail: 'Detail text',
      due_date: '2026-09-01',
      sort_order: null,
    });
    expect(row.deadline).toBe('2026-09-01');
    expect(row.description).toBe('Detail text');
    expect(row.sort_order).toBe(0);
  });

  it('maps medication prescribed_by from specialist name', () => {
    const m = mapMedicationRow({
      id: 1,
      name: 'Drug',
      prescribed_by: null,
      specialist_name_resolved: 'Dr Who',
    });
    expect(m.prescribed_by).toBe('Dr Who');
  });

  it('maps error description from detail', () => {
    const e = mapErrorRow({ id: 1, title: 'X', detail: 'Body', description: null });
    expect(e.description).toBe('Body');
  });
});
