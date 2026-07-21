const { verifyToken } = require('../auth');

// Exige un JWT válido en el header Authorization y adjunta la info del
// usuario (id, clienteId, rol) a req.user para que las rutas la usen.
function requireAuth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return res.status(401).json({ error: 'Falta el token de sesión.' });
  }
  try {
    req.user = verifyToken(token);
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Sesión inválida o expirada.' });
  }
}

// Restringe una ruta a ciertos roles (ej: solo 'admin').
// Se usa después de requireAuth, que ya validó el token.
function requireRole(...rolesPermitidos) {
  return (req, res, next) => {
    if (!rolesPermitidos.includes(req.user.rol)) {
      return res.status(403).json({ error: 'No tienes permiso para esta acción.' });
    }
    next();
  };
}

module.exports = { requireAuth, requireRole };
