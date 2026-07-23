// Extract patient_id from X-Patient-Id header or query param
// Default to 1 (primary patient) for backwards compatibility
function patientIdMiddleware(req, _res, next) {
  const fromHeader = req.headers['x-patient-id'];
  const fromQuery = req.query.patient_id;
  const id = parseInt(fromHeader || fromQuery, 10);
  req.patientId = id > 0 ? id : 1;
  next();
}

module.exports = { patientIdMiddleware };
