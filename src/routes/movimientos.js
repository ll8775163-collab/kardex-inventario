const express = require('express');
const { pool, newId } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

// Reporte de movimientos, con filtros opcionales por tipo, usuario y merma.
// Siempre acotado al cliente del token — nunca a lo que venga en la query.
router.get('/', ah(async (req, res) => {
  const { tipo, usuarioId, soloMerma } = req.query;
  let sql = `
    SELECT m.fecha, m.tipo, u.nombre AS usuario, p.nombre AS producto, p.unidad,
           mi.cantidad, mi.observacion_merma
    FROM movimiento_items mi
    JOIN movimientos m ON m.id = mi.movimiento_id
    JOIN usuarios u ON u.id = m.usuario_id
    JOIN productos p ON p.id = mi.producto_id
    WHERE m.cliente_id = $1
  `;
  const params = [req.user.clienteId];

  if (tipo) { params.push(tipo); sql += ` AND m.tipo = $${params.length}`; }
  if (usuarioId) { params.push(usuarioId); sql += ` AND m.usuario_id = $${params.length}`; }
  if (soloMerma === 'true') { sql += " AND mi.observacion_merma IS NOT NULL AND mi.observacion_merma != ''"; }
  sql += ' ORDER BY m.fecha DESC';

  const { rows } = await pool.query(sql, params);
  res.json(rows);
}));

// Registrar un despacho a cliente o un abastecimiento a la tienda principal:
// ambos restan stock. items: [{ productoId, cantidad, observacionMerma }]
router.post('/salida', ah(async (req, res) => {
  const { tipo, items } = req.body;
  if (!['despacho', 'abastecimiento'].includes(tipo) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Indica un tipo válido y al menos un ítem.' });
  }

  try {
    const movimientoId = await registrarMovimiento(req.user.clienteId, req.user.sub, tipo, items, { validarStock: true });
    res.status(201).json({ id: movimientoId });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
}));

// Registrar un ingreso de mercadería: suma stock. Si un ítem trae
// productoNuevo en vez de productoId, primero crea el producto en el
// catálogo del cliente y luego usa ese id.
router.post('/ingreso', ah(async (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un ítem a la carga.' });
  }

  const client = await pool.connect();
  let itemsResueltos;
  try {
    await client.query('BEGIN');
    itemsResueltos = [];
    for (const it of items) {
      if (it.productoId) {
        itemsResueltos.push(it);
        continue;
      }
      const { nombre, unidad } = it.productoNuevo || {};
      if (!nombre || !unidad) throw new Error('Cada producto nuevo necesita nombre y unidad.');
      const productoId = newId();
      await client.query(
        `INSERT INTO productos (id, cliente_id, nombre, unidad, precio, stock_actual)
         VALUES ($1, $2, $3, $4, 0, 0)`,
        [productoId, req.user.clienteId, nombre, unidad]
      );
      itemsResueltos.push({ ...it, productoId });
    }
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    client.release();
    return res.status(409).json({ error: err.message });
  }
  client.release();

  try {
    const movimientoId = await registrarMovimiento(req.user.clienteId, req.user.sub, 'ingreso', itemsResueltos, { validarStock: false });
    res.status(201).json({ id: movimientoId });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
}));

// Crea el movimiento, sus líneas, y ajusta el stock — todo en una sola
// transacción: si algo falla (ej. stock insuficiente), no queda nada a medias.
async function registrarMovimiento(clienteId, usuarioId, tipo, items, { validarStock }) {
  const signo = tipo === 'ingreso' ? 1 : -1;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const movimientoId = newId();
    await client.query(
      'INSERT INTO movimientos (id, cliente_id, usuario_id, tipo) VALUES ($1, $2, $3, $4)',
      [movimientoId, clienteId, usuarioId, tipo]
    );

    for (const item of items) {
      const { rows } = await client.query(
        'SELECT * FROM productos WHERE id = $1 AND cliente_id = $2',
        [item.productoId, clienteId]
      );
      const producto = rows[0];
      if (!producto) throw new Error(`Producto no encontrado en tu catálogo: ${item.productoId}`);

      const nuevoStock = producto.stock_actual + signo * item.cantidad;
      if (validarStock && nuevoStock < 0) {
        throw new Error(`Stock insuficiente para "${producto.nombre}" (disponible: ${producto.stock_actual}).`);
      }

      await client.query('UPDATE productos SET stock_actual = $1 WHERE id = $2', [nuevoStock, producto.id]);
      await client.query(
        `INSERT INTO movimiento_items (id, movimiento_id, producto_id, cantidad, observacion_merma)
         VALUES ($1, $2, $3, $4, $5)`,
        [newId(), movimientoId, producto.id, item.cantidad, item.observacionMerma || null]
      );
    }

    await client.query('COMMIT');
    return movimientoId;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = router;
