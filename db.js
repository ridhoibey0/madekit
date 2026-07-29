const path = require("node:path");
const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");

const DATA_DIR = path.join(__dirname, "data");
const DB_PATH = path.join(DATA_DIR, "pengambilan.db");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);

// WAL biar reader ga keblokir sama writer, busy_timeout biar kalau ada 2 proses
// nabrak (misal npm run import dijalanin bareng server-nya jalan) SQLite nunggu
// & retry dulu sebentar, bukan langsung lempar error "database is locked".
db.exec(`PRAGMA journal_mode = WAL`);
db.exec(`PRAGMA busy_timeout = 5000`);

db.exec(`
  CREATE TABLE IF NOT EXISTS items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_row INTEGER,
    nama TEXT NOT NULL,
    nama_norm TEXT NOT NULL DEFAULT '',
    fakultas TEXT,
    jurusan TEXT,
    paket TEXT,
    status_bayar TEXT,
    harga_jual INTEGER,
    jumlah_bayar INTEGER,
    sisa_bayar INTEGER,
    metode_bayar TEXT,
    no_whatsapp TEXT,
    catatan_penjualan TEXT,
    waktu_pelunasan TEXT,

    sudah_ambil INTEGER NOT NULL DEFAULT 0,
    waktu_ambil TEXT,
    catatan_pengambilan TEXT DEFAULT '',

    refund_eligible INTEGER NOT NULL DEFAULT 0,
    refund_nominal INTEGER,
    refund_sudah_transfer INTEGER NOT NULL DEFAULT 0,
    refund_catatan TEXT DEFAULT '',

    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migrasi ringan buat db yang sudah dibuat sebelum kolom-kolom ini ditambahkan.
const existingColumns = new Set(
  db.prepare(`PRAGMA table_info(items)`).all().map((c) => c.name)
);
const maybeAddColumn = (name, ddl) => {
  if (!existingColumns.has(name)) db.exec(`ALTER TABLE items ADD COLUMN ${ddl}`);
};
maybeAddColumn("harga_jual", "harga_jual INTEGER");
maybeAddColumn("waktu_pelunasan", "waktu_pelunasan TEXT");
maybeAddColumn("source_row", "source_row INTEGER");
db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_items_source_row ON items(source_row)`);

module.exports = db;
