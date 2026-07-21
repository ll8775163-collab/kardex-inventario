// Conexión a PostgreSQL. En Render, crea una base de datos Postgres y copia
// su "Internal Database URL" en la variable de entorno DATABASE_URL de este
// servicio (pestaña Environment). El esquema de referencia también vive en
// db/schema.postgres.sql, pero este módulo lo crea automáticamente al
// arrancar (CREATE TABLE IF NOT EXISTS), así que no hace falta ejecutarlo
// a mano la primera vez.

const { Pool } = require('pg');
const crypto = require('crypto');

if (!process.env.DATABASE_URL) {
  throw new Error('Configura DATABASE_URL en tus variables de entorno antes de arrancar el servidor.');
}

// Render (y la mayoría de proveedores de Postgres en la nube) exigen SSL,
// pero con un certificado que Node no reconoce como "de confianza" por
// defecto. rejectUnauthorized:false evita ese rechazo sin tener que
// instalar el certificado manualmente.
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL.includes('localhost') ? false : { rejectUnauthorized: false },
});

// Crea las tablas si todavía no existen. Se llama una vez al arrancar el
// servidor (ver server.js). Usamos ids generados en la aplicación
// (newId(), abajo) en vez de defaults de Postgres, así no dependemos de
// la extensión pgcrypto.
async function init() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS clientes (
      id UUID PRIMARY KEY,
      nombre_negocio TEXT NOT NULL,
      plan TEXT NOT NULL DEFAULT 'basico',
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS usuarios (
      id UUID PRIMARY KEY,
      cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      nombre TEXT NOT NULL,
      usuario TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      rol TEXT NOT NULL CHECK (rol IN ('admin','almacenero')),
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS productos (
      id UUID PRIMARY KEY,
      cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      sku TEXT,
      nombre TEXT NOT NULL,
      categoria TEXT,
      unidad TEXT NOT NULL CHECK (unidad IN ('unidad','caja')),
      precio NUMERIC(12,2) NOT NULL DEFAULT 0,
      stock_actual INTEGER NOT NULL DEFAULT 0,
      creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (cliente_id, sku)
    );

    CREATE TABLE IF NOT EXISTS movimientos (
      id UUID PRIMARY KEY,
      cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
      usuario_id UUID NOT NULL REFERENCES usuarios(id),
      tipo TEXT NOT NULL CHECK (tipo IN ('despacho','abastecimiento','ingreso')),
      fecha TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    CREATE TABLE IF NOT EXISTS movimiento_items (
      id UUID PRIMARY KEY,
      movimiento_id UUID NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
      producto_id UUID NOT NULL REFERENCES productos(id),
      cantidad INTEGER NOT NULL CHECK (cantidad > 0),
      observacion_merma TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_usuarios_cliente ON usuarios(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_productos_cliente ON productos(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_movimientos_cliente ON movimientos(cliente_id);
    CREATE INDEX IF NOT EXISTS idx_movimiento_items_movimiento ON movimiento_items(movimiento_id);
  `);
}

function newId() {
  return crypto.randomUUID();
}

module.exports = { pool, newId, init };
