/**
 * Dual-field compatibility: schema has both name/full_name and birth_date/date_of_birth.
 * Always expose canonical FE fields and keep pairs in sync for writers.
 */

export function normalizePatient(row) {
  if (!row) return null;
  const full_name = row.full_name || row.name || null;
  const date_of_birth = row.date_of_birth || row.birth_date || null;
  return {
    ...row,
    full_name,
    name: full_name || row.name || null,
    date_of_birth,
    birth_date: date_of_birth || row.birth_date || null,
  };
}

export function normalizePatients(rows) {
  return (rows || []).map(normalizePatient);
}

/** Map plan row for dashboard/FE (deadline + description aliases). */
export function mapPlanItem(row) {
  if (!row) return row;
  return {
    ...row,
    description: row.description ?? row.detail ?? null,
    deadline: row.due_date ?? null,
    sort_order: row.sort_order ?? 0,
  };
}

export function mapMedicationRow(row) {
  if (!row) return row;
  return {
    ...row,
    prescribed_by: row.prescribed_by || row.specialist_name_resolved || null,
  };
}

export function mapErrorRow(row) {
  if (!row) return row;
  return {
    ...row,
    description: row.description ?? row.detail ?? null,
    action_text: row.action_text ?? null,
  };
}
