const express = require('express');
const { db, newId } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const UNIDADES = ['unidad', 'caja'];

router.get('/', (req, res) => {
  const filas = db.prepare('SELECT * FROM productos WHERE cliente_id = ? ORDER BY nombre').all(req.user.clienteId);
  res.json(filas);
});

router.post('/', requireRole('admin'), (req, res) => {
  const { sku, nombre, categoria, unidad, precio, stockInicial } = req.body;
  if (!nombre || !UNIDADES.includes(unidad)) {
    return res.status(400).json({ error: `Falta el nombre o la unidad debe ser una de: ${UNIDADES.join(', ')}.` });
  }
  const id = newId();
  db.prepare(
    `INSERT INTO productos (id, cliente_id, sku, nombre, categoria, unidad, precio, stock_actual)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, req.user.clienteId, sku || null, nombre, categoria || null, unidad, precio || 0, stockInicial || 0);
  res.status(201).json({ id });
});

router.put('/:id', requireRole('admin'), (req, res) => {
  const { nombre, categoria, unidad, precio } = req.body;
  const resultado = db
    .prepare(
      `UPDATE productos SET nombre = ?, categoria = ?, unidad = ?, precio = ?
       WHERE id = ? AND cliente_id = ?`
    )
    .run(nombre, categoria, unidad, precio, req.params.id, req.user.clienteId);
  if (resultado.changes === 0) return res.status(404).json({ error: 'Producto no encontrado en tu catálogo.' });
  res.json({ ok: true });
});

router.delete('/:id', requireRole('admin'), (req, res) => {
  const resultado = db
    .prepare('DELETE FROM productos WHERE id = ? AND cliente_id = ?')
    .run(req.params.id, req.user.clienteId);
  if (resultado.changes === 0) return res.status(404).json({ error: 'Producto no encontrado en tu catálogo.' });
  res.status(204).end();
});

// Importación masiva desde Excel/CSV/PDF: el archivo se parsea en el
// navegador (con SheetJS o pdf.js) y aquí solo llega la lista ya
// estructurada. Si el SKU o el nombre ya existen para este cliente, se
// actualiza ese producto; si no, se crea uno nuevo. Todo en una sola
// transacción para no dejar una importación a medias si algo falla.
router.post('/importar', requireRole('admin'), (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Envía al menos un producto para importar.' });
  }
  if (!items.every((it) => typeof it.nombre === 'string' && it.nombre.trim())) {
    return res.status(400).json({ error: 'Cada fila necesita al menos un nombre de producto.' });
  }

  let creados = 0;
  let actualizados = 0;

  const ejecutar = db.transaction(() => {
    for (const it of items) {
      const unidad = UNIDADES.includes(it.unidad) ? it.unidad : 'unidad';
      const existente = it.sku
        ? db.prepare('SELECT id FROM productos WHERE cliente_id = ? AND sku = ?').get(req.user.clienteId, it.sku)
        : db.prepare('SELECT id FROM productos WHERE cliente_id = ? AND lower(nombre) = lower(?)').get(req.user.clienteId, it.nombre);

      if (existente) {
        db.prepare(
          `UPDATE productos SET nombre = ?, categoria = ?, unidad = ?,
             precio = COALESCE(?, precio), stock_actual = ?
           WHERE id = ? AND cliente_id = ?`
        ).run(it.nombre, it.categoria || null, unidad, it.precio || null, it.stock || 0, existente.id, req.user.clienteId);
        actualizados++;
      } else {
        db.prepare(
          `INSERT INTO productos (id, cliente_id, sku, nombre, categoria, unidad, precio, stock_actual)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        ).run(newId(), req.user.clienteId, it.sku || null, it.nombre, it.categoria || null, unidad, it.precio || 0, it.stock || 0);
        creados++;
      }
    }
  });
  ejecutar();

  res.status(200).json({ creados, actualizados });
});

module.exports = router;
