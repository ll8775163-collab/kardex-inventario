const express = require('express');
const { db, newId } = require('../db');
const { hashPassword, verifyPassword, signToken } = require('../auth');

const router = express.Router();

// Registro de un nuevo cliente (negocio) de la plataforma: crea el tenant
// y su primer usuario admin en una sola operación.
router.post('/registro', async (req, res) => {
  const { nombreNegocio, nombreAdmin, usuario, password } = req.body;

  if (!nombreNegocio || !nombreAdmin || !usuario || !password || password.length < 8) {
    return res.status(400).json({
      error: 'Completa nombre del negocio, nombre del admin, usuario y una contraseña de al menos 8 caracteres.',
    });
  }

  const yaExiste = db.prepare('SELECT id FROM usuarios WHERE usuario = ?').get(usuario.toLowerCase());
  if (yaExiste) {
    return res.status(409).json({ error: 'Ese ID de usuario ya está en uso.' });
  }

  const clienteId = newId();
  const usuarioId = newId();
  const passwordHash = await hashPassword(password);

  const insertar = db.transaction(() => {
    db.prepare('INSERT INTO clientes (id, nombre_negocio) VALUES (?, ?)').run(clienteId, nombreNegocio);
    db.prepare(
      `INSERT INTO usuarios (id, cliente_id, nombre, usuario, password_hash, rol)
       VALUES (?, ?, ?, ?, ?, 'admin')`
    ).run(usuarioId, clienteId, nombreAdmin, usuario.toLowerCase(), passwordHash);
  });
  insertar();

  const token = signToken({ id: usuarioId, cliente_id: clienteId, rol: 'admin' });
  res.status(201).json({ token, usuario: { id: usuarioId, nombre: nombreAdmin, rol: 'admin' } });
});

// Login: válido tanto para el admin como para los almaceneros de cualquier
// cliente — el usuario es único en toda la plataforma, así que no hace
// falta pedir "a qué empresa perteneces" en un campo aparte.
router.post('/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ error: 'Ingresa tu ID de usuario y contraseña.' });
  }

  const fila = db.prepare('SELECT * FROM usuarios WHERE usuario = ?').get(usuario.toLowerCase());

  // Mismo mensaje de error tanto si el usuario no existe como si la
  // contraseña es incorrecta — así no revelamos si un ID de usuario existe.
  const credencialesInvalidas = () => res.status(401).json({ error: 'ID de usuario o contraseña incorrectos.' });

  if (!fila) return credencialesInvalidas();

  const passwordOk = await verifyPassword(password, fila.password_hash);
  if (!passwordOk) return credencialesInvalidas();

  const token = signToken(fila);
  res.json({ token, usuario: { id: fila.id, nombre: fila.nombre, rol: fila.rol } });
});

module.exports = router;
