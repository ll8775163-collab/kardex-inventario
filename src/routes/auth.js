const express = require('express');
const { pool, newId } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../auth');

const router = express.Router();

// Envuelve handlers async: si la promesa rechaza, el error se manda a
// next(err) para que lo capture el middleware de errores de server.js.
// Express 4 no hace esto automáticamente con funciones async.
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Registro de un nuevo cliente (negocio) de la plataforma: crea el tenant
// y su primer usuario admin en una sola operación.
router.post('/registro', ah(async (req, res) => {
  const { nombreNegocio, nombreAdmin, usuario, password } = req.body;

  if (!nombreNegocio || !nombreAdmin || !usuario || !password || password.length < 8) {
    return res.status(400).json({
      error: 'Completa nombre del negocio, nombre del admin, usuario y una contraseña de al menos 8 caracteres.',
    });
  }

  const { rows: existentes } = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario.toLowerCase()]);
  if (existentes.length > 0) {
    return res.status(409).json({ error: 'Ese ID de usuario ya está en uso.' });
  }

  const clienteId = newId();
  const usuarioId = newId();
  const passwordHash = await hashPassword(password);

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('INSERT INTO clientes (id, nombre_negocio) VALUES ($1, $2)', [clienteId, nombreNegocio]);
    await client.query(
      `INSERT INTO usuarios (id, cliente_id, nombre, usuario, password_hash, rol)
       VALUES ($1, $2, $3, $4, $5, 'admin')`,
      [usuarioId, clienteId, nombreAdmin, usuario.toLowerCase(), passwordHash]
    );
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  const token = signToken({ id: usuarioId, cliente_id: clienteId, rol: 'admin' });
  res.status(201).json({ token, usuario: { id: usuarioId, nombre: nombreAdmin, rol: 'admin' } });
}));

// Login: válido tanto para el admin como para los almaceneros de cualquier
// cliente — el usuario es único en toda la plataforma, así que no hace
// falta pedir "a qué empresa perteneces" en un campo aparte.
router.post('/login', ah(async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Ingresa tu ID de usuario y contraseña.' });
  }

  const { rows } = await pool.query('SELECT * FROM usuarios WHERE usuario = $1', [usuario.toLowerCase()]);
  const fila = rows[0];

  // Mismo mensaje de error tanto si el usuario no existe como si la
  // contraseña es incorrecta — así no revelamos si un ID de usuario existe.
  const credencialesInvalidas = () => res.status(401).json({ error: 'ID de usuario o contraseña incorrectos.' });

  if (!fila) return credencialesInvalidas();

  const passwordOk = await verifyPassword(password, fila.password_hash);
  if (!passwordOk) return credencialesInvalidas();

  const token = signToken(fila);
  res.json({ token, usuario: { id: fila.id, nombre: fila.nombre, rol: fila.rol } });
}));

module.exports = router;
