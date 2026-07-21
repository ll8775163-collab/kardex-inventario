# Kardex

Sistema de inventario multi-cliente (multi-tenant): backend con
autenticación por usuario/contraseña (bcrypt + JWT) y el frontend servido
desde el mismo servidor, así que **todo el sistema es una sola URL** — la
compartes con tus colegas del almacén y cada uno entra con su propio ID y
contraseña.

Cada negocio que se registra es un "cliente" aislado: sus productos,
usuarios y movimientos nunca se mezclan con los de otro, aunque compartan
el mismo servidor y base de datos.

## Cómo funciona la seguridad de contraseñas

- Las contraseñas **nunca** se guardan en texto plano. `bcrypt.hash()`
  genera un hash de un solo sentido (ver `src/auth.js`). Ni tú ni nadie con
  acceso a la base de datos puede leer la contraseña original.
- Al iniciar sesión se compara con `bcrypt.compare()` — no se "desencripta"
  nada, bcrypt no es reversible por diseño.
- Cada usuario recibe un **JWT** al iniciar sesión, con su id, el
  `clienteId` al que pertenece y su rol. El servidor nunca confía en un
  `clienteId` que venga del body o la URL, solo en el que viene del token.

## Cómo trabajan varios colegas al mismo tiempo

No hace falta que cada quien tenga su propia copia del sistema: todos abren
la **misma URL** en su celular, tablet o computadora, e inician sesión con
su propio ID y contraseña. Tú, como admin, eres quien crea esos accesos
desde la pantalla "Usuarios" (máximo 5 almaceneros).

Las pantallas de Dashboard, Catálogo, Usuarios y Reportes se **refrescan
solas cada 6 segundos** mientras están abiertas, así que si un almacenero
registra un despacho, el admin ve el stock actualizado casi al instante sin
recargar la página. Esto es "casi tiempo real" por sondeo (polling) — para
una cuadrilla pequeña de almacén es más que suficiente y no requiere
infraestructura extra. Si más adelante necesitas actualización instantánea
(por ejemplo con decenas de usuarios simultáneos), el siguiente paso sería
sumar WebSockets, pero no es necesario para empezar.

## Instalación local

```bash
npm install
cp .env.example .env
# Edita .env y pon un JWT_SECRET real y largo. Puedes generar uno con:
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
npm run dev
```

Esto levanta todo (API + interfaz web) en `http://localhost:3000` y crea
automáticamente un archivo `kardex.db` (SQLite) la primera vez que corre —
no necesitas instalar Postgres para probar esto en tu computadora. Abre esa
URL en el navegador: ahí mismo verás el login de Kardex.

## Publicarlo en internet para compartirlo con tu equipo

Para que tus colegas del almacén entren desde sus propios celulares o
computadoras, necesitas subir este servidor a un hosting con una URL
pública. Como es una sola app de Node (API + frontend juntos), sirve
cualquier hosting que corra Node.js. Una opción simple y con capa gratuita:

**Render.com (Web Service)**
1. Sube esta carpeta a un repositorio de GitHub.
2. En Render, crea un "Web Service" nuevo apuntando a ese repositorio.
3. Build command: `npm install` — Start command: `npm start`.
4. En "Environment", agrega la variable `JWT_SECRET` con un valor largo y
   aleatorio (nunca subas tu `.env` real a GitHub — `.gitignore` ya lo
   excluye).
5. Agrega un **Persistent Disk** montado en `/opt/render/project/src` (o la
   ruta del proyecto) para que el archivo `kardex.db` no se borre cada vez
   que Render reinicia el servicio. Sin esto, perderías los datos en cada
   despliegue.
6. Al terminar, Render te da una URL pública (algo como
   `https://kardex-tu-negocio.onrender.com`) — esa es la que compartes con
   tu equipo.

Alternativas equivalentes: Railway, Fly.io, o un VPS propio con PM2 +
Nginx. El código no cambia, solo el lugar donde corre.

Si tu equipo va a crecer bastante (muchos clientes, mucho volumen), en
algún momento conviene migrar de SQLite a Postgres — ya tienes el esquema
listo en `db/schema.postgres.sql`, solo faltaría cambiar `src/db.js` por un
cliente `pg`.

## Compartir accesos con tu equipo

1. Tú te registras una sola vez como admin, desde la pestaña "Crear
   negocio" del login (esto crea tu negocio y tu cuenta).
2. Ya dentro, ve a **Usuarios → Agregar almacenero**, crea un ID y
   contraseña para cada colega (hasta 5).
3. Comparte esas credenciales por un canal privado (WhatsApp directo,
   en persona, etc. — evita grupos abiertos). Cada quien entra con su
   propio usuario y contraseña en la misma URL pública.
4. Si alguien deja el equipo, elimínalo desde esa misma pantalla — su
   acceso se corta al instante.

## Endpoints principales

| Método | Ruta | Quién | Qué hace |
|---|---|---|---|
| POST | `/api/auth/registro` | público | Crea un cliente nuevo (negocio) y su usuario admin |
| POST | `/api/auth/login` | público | Devuelve un JWT si el usuario/contraseña son correctos |
| GET | `/api/usuarios` | autenticado | Lista los usuarios del cliente actual |
| POST | `/api/usuarios` | admin | Crea un almacenero (máximo 5 por cliente) |
| DELETE | `/api/usuarios/:id` | admin | Elimina un almacenero |
| GET | `/api/productos` | autenticado | Lista el catálogo del cliente actual |
| POST | `/api/productos` | admin | Crea un producto |
| PUT/DELETE | `/api/productos/:id` | admin | Edita o elimina un producto |
| POST | `/api/productos/importar` | admin | Crea/actualiza productos en lote (usado tras leer un Excel/CSV/PDF en el navegador) |
| POST | `/api/movimientos/salida` | autenticado | Registra un despacho o abastecimiento (resta stock) |
| POST | `/api/movimientos/ingreso` | autenticado | Registra un ingreso de mercadería (suma stock) |
| GET | `/api/movimientos` | autenticado | Reporte filtrable de movimientos |

## Probar rápido con curl

```bash
# 1. Registrar tu negocio y usuario admin
curl -X POST http://localhost:3000/api/auth/registro \
  -H "Content-Type: application/json" \
  -d '{"nombreNegocio":"Vidriería Central","nombreAdmin":"Ana Torres","usuario":"ana","password":"unaClaveSegura123"}'
# copia el "token" de la respuesta

# 2. Crear un producto (reemplaza TOKEN)
curl -X POST http://localhost:3000/api/productos \
  -H "Content-Type: application/json" -H "Authorization: Bearer TOKEN" \
  -d '{"nombre":"Vaso vidrio 300ml","categoria":"Vidrio","unidad":"caja","precio":35,"stockInicial":40}'

# 3. Iniciar sesión de nuevo más tarde
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"usuario":"ana","password":"unaClaveSegura123"}'
```

## Pasar a producción

1. Ejecuta `db/schema.postgres.sql` en tu instancia de Postgres (opcional,
   solo si migras desde SQLite — ver sección de despliegue arriba).
2. Si migras, cambia `src/db.js` por un cliente de `pg` en vez de
   `better-sqlite3` (las consultas SQL son prácticamente las mismas).
3. Pon `JWT_SECRET` como variable de entorno segura en tu hosting, nunca en
   el código ni en un `.env` subido a git.
4. Sirve el backend detrás de HTTPS (Render, Railway y similares lo dan por
   defecto) — sin eso, el token y las contraseñas viajan legibles por la
   red aunque estén bien manejados en el servidor.

