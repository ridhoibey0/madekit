// Import data penjualan dari Made Kit.xlsx (sheet "Penjualan") ke database lokal.
// Aman dijalankan berkali-kali: tiap baris Excel dicocokkan pakai POSISI barisnya
// (source_row), bukan nama/paket/harga -- soalnya nama+paket+harga bisa sama persis
// kalau ada orang yang beli 2x paket yang sama dengan harga yang sama, dan kalau
// dicocokkan dari situ 2 pembelian itu keanggep 1 baris yang sama (data hilang).
// Konsekuensinya: kalau baris di Excel-nya disisipkan/dihapus/diurutkan ulang di
// TENGAH data (bukan cuma nambah baris baru di bawah), pencocokannya bisa meleset.
// Status "sudah ambil" & refund manual TIDAK pernah ditimpa reimport. Kalau baris itu
// sudah pernah dilunasi lewat web, angka jumlah/sisa bayar & status juga TIDAK ditimpa
// lagi oleh angka lama dari Excel.
const path = require("node:path");
const XLSX = require("xlsx");
const db = require("../db");

const SRC = process.argv[2] || path.join(__dirname, "..", "Made Kit.xlsx");
const SHEET_NAME = "Penjualan";

function normalizeName(name) {
  if (!name) return "";
  return String(name)
    .toLowerCase()
    .trim()
    .replace(/\s+/g, " ")
    .replace(/[^a-z ]/g, "")
    .trim();
}

function toIntOrNull(v) {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}

function main() {
  const wb = XLSX.readFile(SRC);
  const ws = wb.Sheets[SHEET_NAME];
  if (!ws) {
    console.error(`Sheet "${SHEET_NAME}" tidak ditemukan di ${SRC}`);
    process.exit(1);
  }

  // Baris ke-2 (index 1) di Excel adalah header, sama seperti header=1 di pandas.
  const rows = XLSX.utils.sheet_to_json(ws, { range: 1, defval: "" });

  const findStmt = db.prepare(
    `SELECT id, waktu_pelunasan FROM items WHERE source_row = ?`
  );
  const insertStmt = db.prepare(`
    INSERT INTO items
      (source_row, nama, nama_norm, fakultas, jurusan, paket, status_bayar, harga_jual,
       jumlah_bayar, sisa_bayar, metode_bayar, no_whatsapp, catatan_penjualan)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  // Update penuh dipakai kalau belum pernah ada pelunasan lewat web ini.
  const updateFullStmt = db.prepare(`
    UPDATE items SET
      nama = ?, fakultas = ?, jurusan = ?, paket = ?, status_bayar = ?, harga_jual = ?,
      jumlah_bayar = ?, sisa_bayar = ?, metode_bayar = ?, no_whatsapp = ?, catatan_penjualan = ?
    WHERE id = ?
  `);
  // Kalau sudah pernah ada pelunasan dicatat lewat web, jangan timpa status/jumlah/sisa
  // bayar pakai angka lama dari Excel -- cukup update data non-pembayaran.
  const updateMetaOnlyStmt = db.prepare(`
    UPDATE items SET
      nama = ?, fakultas = ?, jurusan = ?, paket = ?, harga_jual = ?,
      metode_bayar = ?, no_whatsapp = ?, catatan_penjualan = ?
    WHERE id = ?
  `);

  let inserted = 0;
  let updated = 0;
  let updatedMetaOnly = 0;
  let skipped = 0;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nama = String(row["Nama"] || "").trim();
    if (!nama) {
      skipped++;
      continue;
    }
    const sourceRow = i; // posisi baris ini di antara baris-baris data Excel (stabil selama cuma nambah di bawah)
    const namaNorm = normalizeName(nama);
    const paket = String(row["Paket"] || "").trim().toUpperCase();
    const statusBayar = String(row["Status"] || "").trim().toUpperCase();
    const hargaJual = toIntOrNull(row["Harga Jual"]);
    const jumlahBayar = toIntOrNull(row["Jumlah Bayar"]);
    const sisaBayar = toIntOrNull(row["Sisa Bayar"]);
    const fakultas = String(row["Fakultas"] || "").trim();
    const jurusan = String(row["Jurusan"] || "").trim();
    const metode = String(row["Metode"] || "").trim();
    const noWa = String(row["No WhatsApp"] || "").trim();
    const catatan = String(row["Catatan"] || "").trim();

    const existing = findStmt.get(sourceRow);
    if (existing && existing.waktu_pelunasan) {
      updateMetaOnlyStmt.run(
        nama, fakultas, jurusan, paket, hargaJual, metode, noWa, catatan, existing.id
      );
      updatedMetaOnly++;
    } else if (existing) {
      updateFullStmt.run(
        nama, fakultas, jurusan, paket, statusBayar, hargaJual, jumlahBayar,
        sisaBayar, metode, noWa, catatan, existing.id
      );
      updated++;
    } else {
      insertStmt.run(
        sourceRow, nama, namaNorm, fakultas, jurusan, paket, statusBayar, hargaJual,
        jumlahBayar, sisaBayar, metode, noWa, catatan
      );
      inserted++;
    }
  }

  console.log(`Sumber              : ${SRC}`);
  console.log(`Baris dibaca        : ${rows.length}`);
  console.log(`Baru ditambah       : ${inserted}`);
  console.log(`Di-update           : ${updated}`);
  console.log(`Update data saja    : ${updatedMetaOnly} (sudah pernah pelunasan lewat web, angka bayar tidak ditimpa)`);
  console.log(`Dilewati            : ${skipped} (nama kosong)`);
}

main();
