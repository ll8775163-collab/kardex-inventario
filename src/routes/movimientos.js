const express = require('express');
const { db, newId } = require('../db');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// Reporte de movimientos, con filtros opcionales por tipo, usuario y merma.
// Siempre acotado al cliente del token — nunca a lo que venga en la query.
router.get('/', (req, res) => {
  const { tipo, usuarioId, soloMerma } = req.query;
  let sql = `
    SELECT m.fecha, m.tipo, u.nombre AS usuario, p.nombre AS producto, p.unidad,
           mi.cantidad, mi.observacion_merma
    FROM movimiento_items mi
    JOIN movimientos m ON m.id = mi.movimiento_id
    JOIN usuarios u ON u.id = m.usuario_id
    JOIN productos p ON p.id = mi.producto_id
    WHERE m.cliente_id = ?
  `;
  const params = [req.user.clienteId];

  if (tipo) { sql += ' AND m.tipo = ?'; params.push(tipo); }
  if (usuarioId) { sql += ' AND m.usuario_id = ?'; params.push(usuarioId); }
  if (soloMerma === 'true') { sql += " AND mi.observacion_merma IS NOT NULL AND mi.observacion_merma != ''"; }
  sql += ' ORDER BY m.fecha DESC';

  res.json(db.prepare(sql).all(...params));
});

// Registrar un despacho a cliente o un abastecimiento a la tienda principal:
// ambos restan stock. items: [{ productoId, cantidad, observacionMerma }]
router.post('/salida', (req, res) => {
  const { tipo, items } = req.body;
  if (!['despacho', 'abastecimiento'].includes(tipo) || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Indica un tipo válido y al menos un ítem.' });
  }

  try {
    const movimientoId = registrarMovimiento(req.user.clienteId, req.user.sub, tipo, items, { validarStock: true });
    res.status(201).json({ id: movimientoId });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Registrar un ingreso de mercadería: suma stock. Si un ítem trae
// productoNuevo en vez de productoId, primero crea el producto en el
// catálogo del cliente y luego usa ese id.
router.post('/ingreso', (req, res) => {
  const { items } = req.body;
  if (!Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: 'Agrega al menos un ítem a la carga.' });
  }

  const resolverItems = db.transaction(() => {
    return items.map((it) => {
      if (it.productoId) return it;
      const { nombre, unidad } = it.productoNuevo || {};
      if (!nombre || !unidad) throw new Error('Cada producto nuevo necesita nombre y unidad.');
      const productoId = newId();
      db.prepare(
        `INSERT INTO productos (id, cliente_id, nombre, unidad, precio, stock_actual)
         VALUES (?, ?, ?, ?, 0, 0)`
      ).run(productoId, req.user.clienteId, nombre, unidad);
      return { ...it, productoId };
    });
  });

  try {
    const itemsResueltos = resolverItems();
    const movimientoId = registrarMovimiento(req.user.clienteId, req.user.sub, 'ingreso', itemsResueltos, { validarStock: false });
    res.status(201).json({ id: movimientoId });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Crea el movimiento, sus líneas, y ajusta el stock — todo en una sola
// transacción: si algo falla (ej. stock insuficiente), no queda nada a medias.
function registrarMovimiento(clienteId, usuarioId, tipo, items, { validarStock }) {
  const signo = tipo === 'ingreso' ? 1 : -1;

  const ejecutar = db.transaction(() => {
    const movimientoId = newId();
    db.prepare('INSERT INTO movimientos (id, cliente_id, usuario_id, tipo) VALUES (?, ?, ?, ?)').run(
      movimientoId, clienteId, usuarioId, tipo
    );

    for (const item of items) {
      const producto = db
        .prepare('SELECT * FROM productos WHERE id = ? AND cliente_id = ?')
        .get(item.productoId, clienteId);
      if (!producto) throw new Error(`Producto no encontrado en tu catálogo: ${item.productoId}`);

      const nuevoStock = producto.stock_actual + signo * item.cantidad;
      if (validarStock && nuevoStock < 0) {
        throw new Error(`Stock insuficiente para "${producto.nombre}" (disponible: ${producto.stock_actual}).`);
      }

      db.prepare('UPDATE productos SET stock_actual = ? WHERE id = ?').run(nuevoStock, producto.id);
      db.prepare(
        `INSERT INTO movimiento_items (id, movimiento_id, producto_id, cantidad, observacion_merma)
         VALUES (?, ?, ?, ?, ?)`
      ).run(newId(), movimientoId, producto.id, item.cantidad, item.observacionMerma || null);
    }

    return movimientoId;
  });

  return ejecutar();
}

module.exports = router;
