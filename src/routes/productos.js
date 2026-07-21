const express = require('express');
const { pool, newId } = require('../db');
const { requireAuth, requireRole } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const UNIDADES = ['unidad', 'caja'];

router.get('/', ah(async (req, res) => {
  const { rows } = await pool.query('SELECT * FROM productos WHERE cliente_id = $1 ORDER BY nombre', [req.user.clienteId]);
  res.json(rows);
}));

router.post('/', requireRole('admin'), ah(async (req, res) => {
  const { sku, nombre, categoria, unidad, precio, stockInicial } = req.body;
  if (!nombre || !UNIDADES.includes(unidad)) {
    return res.status(400).json({ error: `Falta el nombre o la unidad debe ser una de: ${UNIDADES.join(', ')}.` });
  }
  const id = newId();
  await pool.query(
    `INSERT INTO productos (id, cliente_id, sku, nombre, categoria, unidad, precio, stock_actual)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [id, req.user.clienteId, sku || null, nombre, categoria || null, unidad, precio || 0, stockInicial || 0]
  );
  res.status(201).json({ id });
}));

router.put('/:id', requireRole('admin'), ah(async (req, res) => {
  const { nombre, categoria, unidad, precio } = req.body;
  const resultado = await pool.query(
    `UPDATE productos SET nombre = $1, categoria = $2, unidad = $3, precio = $4
     WHERE id = $5 AND cliente_id = $6`,
    [nombre, categoria, unidad, precio, req.params.id, req.user.clienteId]
  );
  if (resultado.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado en tu catálogo.' });
  res.json({ ok: true });
}));

router.delete('/:id', requireRole('admin'), ah(async (req, res) => {
  const resultado = await pool.query(
    'DELETE FROM productos WHERE id = $1 AND cliente_id = $2',
    [req.params.id, req.user.clienteId]
  );
  if (resultado.rowCount === 0) return res.status(404).json({ error: 'Producto no encontrado en tu catálogo.' });
  res.status(204).end();
}));

// Importación masiva desde Excel/CSV/PDF: el archivo se parsea en el
// navegador (con SheetJS o pdf.js) y aquí solo llega la lista ya
// estructurada. Si el SKU o el nombre ya existen para este cliente, se
// actualiza ese producto; si no, se crea uno nuevo. Todo en una sola
// transacción para no dejar una importación a medias si algo falla.
router.post('/importar', requireRole('admin'), ah(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Envía al menos un producto para importar.' });
  }
  if (!items.every((it) => typeof it.nombre === 'string' && it.nombre.trim())) {
    return res.status(400).json({ error: 'Cada fila necesita al menos un nombre de producto.' });
  }

  let creados = 0;
  let actualizados = 0;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const it of items) {
      const unidad = UNIDADES.includes(it.unidad) ? it.unidad : 'unidad';
      const existenteRes = it.sku
        ? await client.query('SELECT id FROM productos WHERE cliente_id = $1 AND sku = $2', [req.user.clienteId, it.sku])
        : await client.query('SELECT id FROM productos WHERE cliente_id = $1 AND lower(nombre) = lower($2)', [req.user.clienteId, it.nombre]);
      const existente = existenteRes.rows[0];

      if (existente) {
        await client.query(
          `UPDATE productos SET nombre = $1, categoria = $2, unidad = $3,
             precio = COALESCE($4, precio), stock_actual = $5
           WHERE id = $6 AND cliente_id = $7`,
          [it.nombre, it.categoria || null, unidad, it.precio || null, it.stock || 0, existente.id, req.user.clienteId]
        );
        actualizados++;
      } else {
        await client.query(
          `INSERT INTO productos (id, cliente_id, sku, nombre, categoria, unidad, precio, stock_actual)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [newId(), req.user.clienteId, it.sku || null, it.nombre, it.categoria || null, unidad, it.precio || 0, it.stock || 0]
        );
        creados++;
      }
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }

  res.status(200).json({ creados, actualizados });
}));

module.exports = router;
