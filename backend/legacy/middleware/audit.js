const { rawDb } = require('../db');

function logAudit(entityType, entityId, action, oldValue, newValue) {
  try {
    rawDb.prepare(
      `INSERT INTO audit_log (entity_type, entity_id, action, old_value, new_value)
       VALUES (?, ?, ?, ?, ?)`
    ).run(
      entityType,
      entityId || null,
      action,
      oldValue ? JSON.stringify(oldValue) : null,
      newValue ? JSON.stringify(newValue) : null
    );
  } catch (err) {
    console.error('Audit log error:', err);
  }
}

module.exports = { logAudit };
