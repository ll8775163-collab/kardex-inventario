-- Esquema de referencia para producción (PostgreSQL).
-- El servidor de ejemplo en src/db.js usa SQLite para que puedas correrlo
-- sin instalar una base de datos aparte, pero la estructura es la misma.
-- Cuando pases a producción, ejecuta este archivo en tu instancia de Postgres.

CREATE EXTENSION IF NOT EXISTS "pgcrypto"; -- para gen_random_uuid()

CREATE TABLE clientes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  nombre_negocio TEXT NOT NULL,
  plan TEXT NOT NULL DEFAULT 'basico',
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usuarios (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  nombre TEXT NOT NULL,
  usuario TEXT NOT NULL UNIQUE,        -- ID de login, único en toda la plataforma
  password_hash TEXT NOT NULL,         -- nunca se guarda la contraseña en texto plano
  rol TEXT NOT NULL CHECK (rol IN ('admin', 'almacenero')),
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Un cliente no puede tener más de 5 almaceneros: se valida en la aplicación
-- (a nivel de base de datos se podría reforzar con un trigger si se quiere
-- una segunda capa de seguridad).

CREATE TABLE productos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  sku TEXT,
  nombre TEXT NOT NULL,
  categoria TEXT,
  unidad TEXT NOT NULL CHECK (unidad IN ('unidad', 'caja')),
  precio NUMERIC(12,2) NOT NULL DEFAULT 0,
  stock_actual INTEGER NOT NULL DEFAULT 0,
  creado_en TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (cliente_id, sku)
);

CREATE TABLE movimientos (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id UUID NOT NULL REFERENCES clientes(id) ON DELETE CASCADE,
  usuario_id UUID NOT NULL REFERENCES usuarios(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('despacho', 'abastecimiento', 'ingreso')),
  fecha TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE movimiento_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  movimiento_id UUID NOT NULL REFERENCES movimientos(id) ON DELETE CASCADE,
  producto_id UUID NOT NULL REFERENCES productos(id),
  cantidad INTEGER NOT NULL CHECK (cantidad > 0),
  observacion_merma TEXT
);

CREATE INDEX idx_usuarios_cliente ON usuarios(cliente_id);
CREATE INDEX idx_productos_cliente ON productos(cliente_id);
CREATE INDEX idx_movimientos_cliente ON movimientos(cliente_id);
CREATE INDEX idx_movimiento_items_movimiento ON movimiento_items(movimiento_id);
