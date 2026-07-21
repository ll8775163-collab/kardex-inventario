// Base de datos local en SQLite, para que puedas levantar el backend sin
// instalar Postgres aparte. La estructura es la misma que db/schema.postgres.sql
// — cuando despliegues en producción, migra a Postgres usando ese archivo y
// cambia este módulo por el driver de "pg". El resto del código (rutas,
// autenticación) no debería cambiar, porque no usa SQL específico de SQLite.

const Database = require('better-sqlite3');
const path = require('path');
const crypto = require('crypto');

const db = new Database(path.join(__dirname, '..', 'kardex.db'));
db.pragma('foreign_keys = ON');

db.exec(`
// --- Migración: si "productos" ya existía con sku NOT NULL (versión anterior),
// la recreamos permitiendo sku nulo, sin perder los datos.
const skuInfo = db.prepare("PRAGMA table_info(productos)").all().find((c) => c.name === 'sku');
if (skuInfo && skuInfo.notnull) {
  db.exec(`
    ALTER TABLE productos RENAME TO productos_old;
    CREATE TABLE productos (
      id TEXT PRIMARY KEY,
      cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      sku TEXT,
      nombre TEXT NOT NULL,
      categoria TEXT,
      unidad TEXT NOT NULL CHECK (unidad IN ('unidad','caja')),
      precio REAL NOT NULL DEFAULT 0,
      stock_actual INTEGER NOT NULL DEFAULT 0,
      creado_en TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(cliente_id, sku)
    );
    INSERT INTO productos SELECT * FROM productos_old;
    DROP TABLE productos_old;
  `);
}
function newId() {
  return crypto.randomUUID();
}

module.exports = { db, newId };
