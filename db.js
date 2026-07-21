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
  CREATE TABLE IF NOT EXISTS clientes (
    id TEXT PRIMARY KEY,
    nombre_negocio TEXT NOT NULL,
    plan TEXT NOT NULL DEFAULT 'basico',
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS usuarios (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    nombre TEXT NOT NULL,
    usuario TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    rol TEXT NOT NULL CHECK (rol IN ('admin','almacenero')),
    creado_en TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS productos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    sku TEXT NOT NULL,
    nombre TEXT NOT NULL,
    categoria TEXT,
    unidad TEXT NOT NULL CHECK (unidad IN ('unidad','caja')),
    precio REAL NOT NULL DEFAULT 0,
    stock_actual INTEGER NOT NULL DEFAULT 0,
    creado_en TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(cliente_id, sku)
  );

  CREATE TABLE IF NOT EXISTS movimientos (
    id TEXT PRIMARY KEY,
    cliente_id TEXT NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
    usuario_id TEXT NOT NULL REFERENCES usuarios(id),
    tipo TEXT NOT NULL CHECK (tipo IN ('despacho','abastecimiento','ingreso')),
    fecha TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS movimiento_items (
    id TEXT PRIMARY KEY,
    movimiento_id TEXT NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
    producto_id TEXT NOT NULL REFERENCES productos(id),
    cantidad INTEGER NOT NULL CHECK (cantidad > 0),
    observacion_merma TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_usuarios_cliente ON usuarios(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_productos_cliente ON productos(cliente_id);
  CREATE INDEX IF NOT EXISTS idx_movimientos_cliente ON movimientos(cliente_id);
`);

function newId() {
  return crypto.randomUUID();
}

module.exports = { db, newId };
