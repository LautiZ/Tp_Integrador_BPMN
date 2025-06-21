import express from "express";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import sqlite3 from "sqlite3";
import { initDb } from "./src/utils/initDb.js";
import { all, run } from "./src/utils/db.js";

const app = express();
const PORT = process.env.PORT || 3000;

const __dirname = dirname(fileURLToPath(import.meta.url));
initDb();
// Servir archivos estáticos (como index.html)
app.use(express.static(__dirname));
// Servir la carpeta src como estática para el frontend.js
app.use("/src", express.static(join(__dirname, "src")));

// Inicializar la base de datos SQLite (archivo local)
const db = new sqlite3.Database("database.sqlite", (err) => {
  if (err) {
    console.error("Error al conectar con SQLite:", err.message);
  } else {
    console.log("Conectado a la base de datos SQLite.");
  }
});

app.get("/", (req, res) => {
  res.sendFile(join(__dirname, "index.html"));
});

app.get("/api/habitaciones-disponibles", async (req, res) => {
  try {
    console.log("Consultando habitaciones disponibles...");
    const disponibles = await all(
      "SELECT * FROM habitaciones WHERE ocupada = 0"
    );
    console.log("Resultado:", disponibles);
    res.json(disponibles);
  } catch (err) {
    console.error("Error en consulta SQL:", err);
    res.status(500).json({ error: err.message });
  }
});

app.post("/api/reservar-habitacion/:id", async (req, res) => {
  try {
    let id = req.params.id;
    const respuesta = await run(
      "UPDATE habitaciones SET ocupada = 1 WHERE id = ? ",
      [id]
    );
    console.log("Resultado:", respuesta);
    res.json(respuesta);
  } catch (err) {
    console.error("Error en consulta SQL:", err);
    res.status(500).json({ error: err.message });
  }
});

// Endpoint de prueba para verificar la conexión a SQLite
app.get("/api/test-sqlite", (req, res) => {
  db.get("SELECT sqlite_version() as version", (err, row) => {
    if (err) {
      res.status(500).json({ error: err.message });
    } else {
      res.json({ sqlite_version: row.version });
    }
  });
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
