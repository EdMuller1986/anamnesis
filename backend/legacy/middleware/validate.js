function required(field) {
  return (req, res, next) => {
    const val = req.body[field];
    if (val === undefined || val === null || (typeof val === 'string' && val.trim() === '')) {
      return res.status(400).json({ error: `Поле "${field}" обязательно` });
    }
    next();
  };
}

function isIn(field, values) {
  return (req, res, next) => {
    const val = req.body[field];
    if (val !== undefined && val !== null && !values.includes(val)) {
      return res.status(400).json({ error: `Поле "${field}" должно быть одним из: ${values.join(', ')}` });
    }
    next();
  };
}

function maxLength(field, max) {
  return (req, res, next) => {
    const val = req.body[field];
    if (val && typeof val === 'string' && val.length > max) {
      return res.status(400).json({ error: `Поле "${field}" не должно превышать ${max} символов` });
    }
    next();
  };
}

function validate(...middlewares) {
  return (req, res, next) => {
    let i = 0;
    function run() {
      if (i >= middlewares.length) return next();
      middlewares[i++](req, res, run);
    }
    run();
  };
}

module.exports = { required, isIn, maxLength, validate };
