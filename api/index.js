const app = require('../server');

module.exports = (req, res) => {
  // Ensure req.url retains the /api prefix for Express routing if a proxy or rewrite rewrote the path
  if (req.url && !req.url.startsWith('/api')) {
    req.url = '/api' + (req.url.startsWith('/') ? req.url : '/' + req.url);
  }
  return app(req, res);
};
