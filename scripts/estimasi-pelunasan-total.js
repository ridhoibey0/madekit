// Alat bantu DIAGNOSTIK SAJA (read-only, tidak mengubah database apa pun) --
// buat estimasi berapa TOTAL yang udah kekumpul dari pelunasan lewat web ini
// sejauh ini, buat kasus kayak "riwayat pembayaran baru mulai dicatat hari
// ini, tapi web-nya udah jalan dari kemarin, jadi pelunasan-pelunasan
// sebelumnya ga ke-log satu-satu".
//
// Caranya: jumlah_bayar di database CUMA berubah lewat 2 jalan -- (1) angka
// awal pas import dari Excel, atau (2) lewat POST /api/items/:id/pelunasan.
// Jadi kalau kita bandingin jumlah_bayar di database SEKARANG vs kolom
// "Jumlah Bayar" di file Excel yang ASLINYA dipakai buat import pertama kali,
// selisihnya (kalau positif) itu kira-kira jumlah yang udah dibayar lewat
// web -- walau ga bisa dipisah lagi "kemarin" vs "hari ini" karena ga ada
// jejak tanggalnya (baru mulai dicatat per-transaksi mulai dari sekarang,
// lihat scripts/../server.js endpoint /pelunasan yang nulis ke tabel
// `payments`).
//
// SYARAT biar hasilnya valid: file Excel yang dipakai di sini HARUS masih
// sama kayak yang dipakai pas `npm run import` PERTAMA KALI (kolom "Jumlah
// Bayar" belum diubah manual buat baris yang sudah ada). Kalau ragu, anggap
// angka ini sebagai ESTIMASI, bukan angka pasti -- dan mulai sekarang,
// gunakan panel "Riwayat Pembayaran" di Dashboard buat angka yang akurat per
// transaksi ke depannya.
const path = require("node:path");
const XLSX = require("xlsx");
const db = require("../db");

const SRC = process.argv[2] || path.join(__dirname, "..", "Made Kit.xlsx");
const SHEET_NAME = "Penjualan";

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
  const rows = XLSX.utils.sheet_to_json(ws, { range: 1, defval: "" });

  const findStmt = db.prepare(`SELECT nama, jumlah_bayar FROM items WHERE source_row = ?`);

  let totalEstimasi = 0;
  let jumlahOrangBayar = 0;
  const anomali = [];
  const detail = [];

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const nama = String(row["Nama"] || "").trim();
    if (!nama) continue;

    const item = findStmt.get(i);
    if (!item) continue; // baris baru yang belum ke-import, dilewati

    const jumlahBayarExcel = toIntOrNull(row["Jumlah Bayar"]) || 0;
    const selisih = item.jumlah_bayar - jumlahBayarExcel;

    if (selisih > 0) {
      totalEstimasi += selisih;
      jumlahOrangBayar++;
      detail.push({ nama: item.nama, selisih });
    } else if (selisih < 0) {
      anomali.push({ nama: item.nama, excel: jumlahBayarExcel, db: item.jumlah_bayar });
    }
  }

  console.log(`Sumber Excel pembanding : ${SRC}`);
  console.log(`Orang yang kebayar lewat web (estimasi) : ${jumlahOrangBayar}`);
  console.log(`Total estimasi terkumpul                : Rp${totalEstimasi.toLocaleString("id-ID")}`);
  console.log("");
  console.log("Rincian per orang:");
  for (const d of detail.sort((a, b) => b.selisih - a.selisih)) {
    console.log(`  ${d.nama.padEnd(35)} Rp${d.selisih.toLocaleString("id-ID")}`);
  }

  if (anomali.length > 0) {
    console.log("");
    console.log(`PERLU DICEK MANUAL (${anomali.length} baris, jumlah_bayar di database lebih KECIL dari Excel -- kemungkinan Excel diedit manual belakangan, bukan lewat web):`);
    for (const a of anomali) {
      console.log(`  ${a.nama.padEnd(35)} Excel: Rp${a.excel.toLocaleString("id-ID")}  DB: Rp${a.db.toLocaleString("id-ID")}`);
    }
  }

  console.log("");
  console.log("CATATAN: ini estimasi kumulatif dari awal (tidak bisa dipisah kemarin vs hari");
  console.log("ini karena belum ada log per transaksi sebelum sekarang). Mulai sekarang,");
  console.log("angka harian yang akurat ada di panel 'Riwayat Pembayaran' di Dashboard.");
}

main();
