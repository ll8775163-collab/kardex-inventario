// Todo lo relacionado a contraseñas y sesiones vive acá, en un solo lugar,
// para que sea fácil de auditar: nada en el resto del código toca contraseñas
// en texto plano ni firma tokens por su cuenta.

const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');

const SALT_ROUNDS = parseInt(process.env.BCRYPT_SALT_ROUNDS || '12', 10);
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRES_IN = '8h';

if (!JWT_SECRET || JWT_SECRET.startsWith('cambia_esto')) {
  // Falla rápido en vez de correr con un secreto de ejemplo — si alguien
  // olvida configurar .env, mejor que el servidor no arranque a que emita
  // tokens firmados con un secreto público que está en este repo.
  throw new Error('Configura JWT_SECRET en tu archivo .env antes de arrancar el servidor.');
}

// Convierte una contraseña en texto plano en un hash irreversible.
// bcrypt genera un "salt" distinto en cada llamada, así que dos usuarios con
// la misma contraseña terminan con hashes distintos — esto es automático,
// no hay que guardar el salt aparte.
async function hashPassword(plainPassword) {
  return bcrypt.hash(plainPassword, SALT_ROUNDS);
}

// Compara una contraseña en texto plano contra un hash guardado.
// Nunca se "deshace" el hash para comparar — bcrypt vuelve a hashear el
// intento con el mismo salt y compara los resultados.
async function verifyPassword(plainPassword, hash) {
  return bcrypt.compare(plainPassword, hash);
}

// El token lleva solo lo mínimo necesario para identificar y autorizar al
// usuario en cada request: su id, a qué cliente (tenant) pertenece, y su rol.
// Nunca metas la contraseña o su hash dentro del token.
function signToken(usuario) {
  return jwt.sign(
    { sub: usuario.id, clienteId: usuario.cliente_id, rol: usuario.rol },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRES_IN }
  );
}

function verifyToken(token) {
  return jwt.verify(token, JWT_SECRET);
}

module.exports = { hashPassword, verifyPassword, signToken, verifyToken };
