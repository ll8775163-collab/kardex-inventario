require('dotenv').config();
const path = require('path');
const express = require('express');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/auth', require('./routes/auth'));
app.use('/api/usuarios', require('./routes/usuarios'));
app.use('/api/productos', require('./routes/productos'));
app.use('/api/movimientos', require('./routes/movimientos'));

app.get('/api/salud', (req, res) => res.json({ ok: true }));

// Si la ruta empieza con /api/ y ninguna de las de arriba la manejó, es un
// 404 real de la API. Respondemos JSON (nunca HTML) para que el frontend
// siempre pueda leer response.error en vez de fallar al parsear la página
// de error por defecto de Express.
app.use('/api', (req, res) => {
  res.status(404).json({ error: `Ruta de API no encontrada: ${req.method} ${req.originalUrl}` });
});

// Sirve el frontend (public/index.html) desde el mismo servicio, así el
// despliegue es una sola URL: la API y la interfaz viven juntas y no hay
// que lidiar con CORS entre dos hosts distintos.
app.use(express.static(path.join(__dirname, '..', 'public')));
app.get('*', (req, res, next) => {
  if (req.path.startsWith('/api/')) return next();
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

// Manejador de errores: si algo lanza una excepción no controlada en una
// ruta, esto evita que el servidor se caiga y evita filtrar detalles
// internos (stack traces) al cliente.
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Ocurrió un error inesperado en el servidor.' });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Kardex backend escuchando en http://localhost:${PORT}`));
