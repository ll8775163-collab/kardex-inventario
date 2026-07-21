const express = require('express');
const { pool, newId } = require('../db');
const { hashPassword } = require('../auth');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Lista los usuarios del cliente que está haciendo la petición — nunca de
// otro cliente, aunque alguien intente pasar otro id por la URL o el body.
router.get('/', ah(async (req, res) => {
  const { rows } = await pool.query(
    'SELECT id, nombre, usuario, rol FROM usuarios WHERE cliente_id = $1',
    [req.user.clienteId]
  );
  res.json(rows);
}));

// Solo el admin de ese cliente puede crear almaceneros, y solo hasta 5.
router.post('/', requireRole('admin'), ah(async (req, res) => {
  const { nombre, usuario, password } = req.body;
  if (!nombre || !usuario || !password || password.length < 8) {
    return res.status(400).json({ error: 'Completa nombre, ID de usuario y una contraseña de al menos 8 caracteres.' });
  }

  const { rows: existentes } = await pool.query('SELECT id FROM usuarios WHERE usuario = $1', [usuario.toLowerCase()]);
  if (existentes.length > 0) {
    return res.status(409).json({ error: 'Ese ID de usuario ya está en uso.' });
  }

  const { rows: conteo } = await pool.query(
    "SELECT COUNT(*) AS total FROM usuarios WHERE cliente_id = $1 AND rol = 'almacenero'",
    [req.user.clienteId]
  );
  if (parseInt(conteo[0].total, 10) >= 5) {
    return res.status(409).json({ error: 'Ya existen 5 almaceneros registrados en esta cuenta.' });
  }

  const id = newId();
  const passwordHash = await hashPassword(password);
  await pool.query(
    `INSERT INTO usuarios (id, cliente_id, nombre, usuario, password_hash, rol)
     VALUES ($1, $2, $3, $4, $5, 'almacenero')`,
    [id, req.user.clienteId, nombre, usuario.toLowerCase(), passwordHash]
  );

  res.status(201).json({ id, nombre, usuario: usuario.toLowerCase(), rol: 'almacenero' });
}));

// Eliminar un almacenero — verificando que pertenezca al mismo cliente que
// hace la petición, para que un admin no pueda borrar usuarios ajenos.
router.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  const resultado = await pool.query(
    "DELETE FROM usuarios WHERE id = $1 AND cliente_id = $2 AND rol = 'almacenero'",
    [req.params.id, req.user.clienteId]
  );
  if (resultado.rowCount === 0) {
    return res.status(404).json({ error: 'Usuario no encontrado en tu cuenta.' });
  }
  res.status(204).end();
}));

module.exports = router;
