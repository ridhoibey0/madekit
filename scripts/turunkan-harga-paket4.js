// Koreksi harga PAKET 4 dari Rp65.000 -> Rp55.000, sesuai perubahan harga hari-H.
// Aman dijalankan langsung ke database production yang udah ada progress
// pengambilan -- SAMA SEKALI tidak nyentuh sudah_ambil/catatan_pengambilan,
// dan tidak butuh migrasi skema (kolom refund udah ada dari awal).
//
// Logikanya disatukan pakai satu rumus buat semua orang PAKET 4 (baik yang
// udah LUNAS maupun yang masih DP di harga lama):
//   overpaid = jumlah_bayar - HARGA_BARU
//   - overpaid > 0  -> udah bayar lebih dari cukup di harga baru -> status
//                      jadi LUNAS, sisa 0, dan kelebihannya (overpaid) ditandai
//                      buat direfund. Ini otomatis mencakup 2 kasus:
//                      1) yang udah LUNAS di harga lama (bayar 65rb) -> overpaid
//                         tepat 10rb, sama kayak yang diminta.
//                      2) yang masih DP tapi udah bayar deket harga baru
//                         (misal udah bayar 58rb) -> overpaid 3rb, ikut
//                         direfund + statusnya ikut lunas, bukan cuma
//                         dianggap "pas".
//   - overpaid <= 0 -> masih DP di harga baru juga -> sisa_bayar dikurangi
//                      supaya pas sama harga baru, TIDAK ada refund.
//
// waktu_pelunasan ditandai buat baris yang disentuh script ini (walau
// statusnya tetep DP), soalnya itu satu-satunya penanda yang dipakai
// `npm run import` buat TIDAK menimpa balik jumlah/sisa bayar & status
// dari angka lama di Excel kalau nanti di-reimport (lihat import.js).
// Kalau Excel-nya sendiri juga dikoreksi harganya, ini tetap konsisten;
// kalau Excel belum sempat dikoreksi, koreksi di database tetap kepakai.
const db = require("../db");

const PAKET = "PAKET 4";
const HARGA_LAMA = 65000;
const HARGA_BARU = 55000;
const CATATAN = `Refund selisih harga ${PAKET} turun dari Rp${HARGA_LAMA.toLocaleString("id-ID")} ke Rp${HARGA_BARU.toLocaleString("id-ID")}`;

function main() {
  const rows = db
    .prepare(`SELECT * FROM items WHERE paket = ? AND harga_jual = ?`)
    .all(PAKET, HARGA_LAMA);

  if (rows.length === 0) {
    console.log(`Tidak ada baris ${PAKET} dengan harga_jual = ${HARGA_LAMA} (mungkin sudah pernah dijalankan).`);
    return;
  }

  const updateStmt = db.prepare(`
    UPDATE items SET
      harga_jual = ?, sisa_bayar = ?, status_bayar = ?, waktu_pelunasan = ?,
      refund_eligible = ?, refund_nominal = ?, refund_catatan = ?
    WHERE id = ?
  `);

  let jadiLunasDenganRefund = 0;
  let jadiLunasPasSama = 0;
  let tetapDpSisaDikurangi = 0;

  db.prepare("BEGIN").run();
  try {
    for (const row of rows) {
      const overpaid = row.jumlah_bayar - HARGA_BARU;
      const now = new Date().toISOString();

      if (overpaid >= 0) {
        // Udah bayar pas atau lebih dari harga baru -> LUNAS, sisa 0.
        if (overpaid > 0) {
          const refundNominalBaru = (row.refund_nominal || 0) + overpaid;
          const catatanBaru = row.refund_catatan
            ? `${row.refund_catatan} | ${CATATAN} (Rp${overpaid.toLocaleString("id-ID")})`
            : `${CATATAN} (Rp${overpaid.toLocaleString("id-ID")})`;
          updateStmt.run(HARGA_BARU, 0, "LUNAS", now, 1, refundNominalBaru, catatanBaru, row.id);
          jadiLunasDenganRefund++;
        } else {
          updateStmt.run(
            HARGA_BARU, 0, "LUNAS", now,
            row.refund_eligible, row.refund_nominal, row.refund_catatan,
            row.id
          );
          jadiLunasPasSama++;
        }
      } else {
        const sisaBaru = -overpaid; // HARGA_BARU - jumlah_bayar
        updateStmt.run(
          HARGA_BARU, sisaBaru, row.status_bayar, now,
          row.refund_eligible, row.refund_nominal, row.refund_catatan,
          row.id
        );
        tetapDpSisaDikurangi++;
      }
    }
    db.prepare("COMMIT").run();
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }

  console.log(`Paket                         : ${PAKET}`);
  console.log(`Harga lama -> baru            : Rp${HARGA_LAMA.toLocaleString("id-ID")} -> Rp${HARGA_BARU.toLocaleString("id-ID")}`);
  console.log(`Total baris diproses          : ${rows.length}`);
  console.log(`Jadi LUNAS + ditandai refund  : ${jadiLunasDenganRefund}`);
  console.log(`Jadi LUNAS pas (tanpa refund) : ${jadiLunasPasSama}`);
  console.log(`Tetap DP, sisa bayar dikurangi: ${tetapDpSisaDikurangi}`);
}

main();
