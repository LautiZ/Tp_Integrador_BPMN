import { run } from "./db.js";

export async function initDb() {
  try {
    console.log("Creando tabla habitaciones...");
    await run(`CREATE TABLE IF NOT EXISTS habitaciones (
      id INTEGER PRIMARY KEY,
      ocupada BOOLEAN DEFAULT 0,
      descripcion VARCHAR(255) DEFAULT NULL,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )`);

    // Insertar algunos datos de prueba
    console.log("Insertando datos de prueba...");
    await run(
      "INSERT OR IGNORE INTO habitaciones (id, ocupada, descripcion) VALUES (1, 0, 'Habitación individual con vista al jardín')"
    );
    await run(
      "INSERT OR IGNORE INTO habitaciones (id, ocupada, descripcion) VALUES (2, 0, 'Habitación doble con balcón')"
    );
    await run(
      "INSERT OR IGNORE INTO habitaciones (id, ocupada, descripcion) VALUES (3, 1, 'Suite ejecutiva')"
    );
    await run(
      "INSERT OR IGNORE INTO habitaciones (id, ocupada, descripcion) VALUES (4, 0, 'Habitación familiar')"
    );
    console.log("Datos de prueba insertados.");
  } catch (err) {
    console.error("Error inicializando DB:", err);
    throw err;
  }
}

// Si se ejecuta este archivo directamente, inicializa la DB
async function main() {
  await initDb();
  process.exit(0);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
