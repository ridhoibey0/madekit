require("dotenv").config();
const path = require("node:path");
const express = require("express");
const db = require("./db");

const PORT = process.env.PORT || 3000;
const ADMIN_USER = process.env.ADMIN_USER || "admin";
const ADMIN_PASS = process.env.ADMIN_PASS || "";
const FINANCE_USER = process.env.FINANCE_USER || "";
const FINANCE_PASS = process.env.FINANCE_PASS || "";

const app = express();
app.use(express.json());

function basicAuthMiddleware(user, pass, realm) {
  return (req, res, next) => {
    const auth = req.headers.authorization || "";
    const [scheme, encoded] = auth.split(" ");
    if (scheme === "Basic" && encoded) {
      const [u, p] = Buffer.from(encoded, "base64").toString().split(":");
      if (u === user && p === pass) return next();
    }
    res.set("WWW-Authenticate", `Basic realm="${realm}"`);
    res.status(401).send("Login diperlukan.");
  };
}

// /api/keuangan/* SENGAJA dilewatin di sini (bukan dicek ADMIN_USER/PASS di
// gate ini) -- soalnya HTTP Basic Auth cuma ngirim SATU pasang kredensial per
// request. Kalau gate ini dipaksa jalan juga buat /api/keuangan/*, begitu
// browser ngirim kredensial FINANCE (buat lolos gate finance di bawah), gate
// umum ini bakal nolak duluan karena itu bukan ADMIN_USER/PASS -> muter terus
// ga pernah lolos. Jadi /api/keuangan/* dikasih gate SENDIRI yang independen
// (lihat di bawah), sementara semua halaman/API lain tetap wajib login admin
// biasa dulu buat bisa masuk ke web-nya sama sekali.
if (ADMIN_PASS) {
  app.use((req, res, next) => {
    if (req.path.startsWith("/api/keuangan")) return next();
    basicAuthMiddleware(ADMIN_USER, ADMIN_PASS, "Pengambilan Barang")(req, res, next);
  });
} else {
  console.warn(
    "[WARNING] ADMIN_PASS belum di-set di .env -> web ini TIDAK dilindungi password. " +
    "Jangan dipakai untuk deploy publik seperti ini."
  );
}

// Gate KHUSUS /api/keuangan/* -- realm-nya beda ("Keuangan"), jadi browser
// munculin prompt login TERPISAH dari login admin biasa. Independen total
// dari ADMIN_USER/PASS: siapa pun yang tahu FINANCE_USER/PASS bisa akses ini
// (asal udah lolos login admin biasa buat muat halaman web-nya duluan).
if (FINANCE_PASS) {
  app.use("/api/keuangan", basicAuthMiddleware(FINANCE_USER, FINANCE_PASS, "Keuangan"));
} else {
  console.warn(
    "[WARNING] FINANCE_PASS belum di-set di .env -> /api/keuangan/* TIDAK punya proteksi " +
    "tambahan (cuma kepake password admin biasa)."
  );
}

app.use(express.static(path.join(__dirname, "public")));

function rowToItem(row) {
  return {
    id: row.id,
    nama: row.nama,
    fakultas: row.fakultas,
    jurusan: row.jurusan,
    paket: row.paket,
    statusBayar: row.status_bayar,
    hargaJual: row.harga_jual,
    jumlahBayar: row.jumlah_bayar,
    sisaBayar: row.sisa_bayar,
    metodeBayar: row.metode_bayar,
    noWhatsapp: row.no_whatsapp,
    catatanPenjualan: row.catatan_penjualan,
    waktuPelunasan: row.waktu_pelunasan,
    sudahAmbil: !!row.sudah_ambil,
    waktuAmbil: row.waktu_ambil,
    catatanPengambilan: row.catatan_pengambilan || "",
    refundEligible: !!row.refund_eligible,
    refundNominal: row.refund_nominal,
    refundSudahTransfer: !!row.refund_sudah_transfer,
    refundCatatan: row.refund_catatan || "",
  };
}

app.get("/api/items", (req, res) => {
  const q = (req.query.q || "").trim();
  let rows;
  if (q) {
    rows = db
      .prepare(`SELECT * FROM items WHERE nama_norm LIKE ? ORDER BY nama COLLATE NOCASE`)
      .all(`%${q.toLowerCase().trim()}%`);
  } else {
    rows = db.prepare(`SELECT * FROM items ORDER BY nama COLLATE NOCASE`).all();
  }
  res.json(rows.map(rowToItem));
});

app.get("/api/summary", (req, res) => {
  const total = db.prepare(`SELECT COUNT(*) c FROM items`).get().c;
  const sudahAmbil = db.prepare(`SELECT COUNT(*) c FROM items WHERE sudah_ambil = 1`).get().c;
  const lunas = db.prepare(`SELECT COUNT(*) c FROM items WHERE status_bayar = 'LUNAS'`).get().c;
  const refundEligible = db.prepare(`SELECT COUNT(*) c FROM items WHERE refund_eligible = 1`).get().c;
  const refundTransfer = db
    .prepare(`SELECT COUNT(*) c FROM items WHERE refund_eligible = 1 AND refund_sudah_transfer = 1`)
    .get().c;
  const refundTotalNominal =
    db.prepare(`SELECT COALESCE(SUM(refund_nominal), 0) s FROM items WHERE refund_eligible = 1`).get()
      .s || 0;

  res.json({
    total,
    sudahAmbil,
    belumAmbil: total - sudahAmbil,
    lunas,
    belumLunas: total - lunas,
    refundEligible,
    refundTransfer,
    refundBelumTransfer: refundEligible - refundTransfer,
    refundTotalNominal,
  });
});

const ALLOWED_FIELDS = {
  sudahAmbil: "sudah_ambil",
  catatanPengambilan: "catatan_pengambilan",
  refundEligible: "refund_eligible",
  refundNominal: "refund_nominal",
  refundSudahTransfer: "refund_sudah_transfer",
  refundCatatan: "refund_catatan",
};

app.patch("/api/items/:id", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: "Tidak ditemukan" });

  const sets = [];
  const values = [];

  for (const [key, column] of Object.entries(ALLOWED_FIELDS)) {
    if (!(key in req.body)) continue;
    let value = req.body[key];
    if (key === "sudahAmbil" || key === "refundEligible" || key === "refundSudahTransfer") {
      value = value ? 1 : 0;
    }
    if (key === "refundNominal") {
      value = value === "" || value === null || value === undefined ? null : Math.round(Number(value));
    }
    sets.push(`${column} = ?`);
    values.push(value);
  }

  // waktu_ambil otomatis: keisi pas pertama kali ditandai sudah ambil, kosong lagi kalau di-uncheck.
  if ("sudahAmbil" in req.body) {
    sets.push("waktu_ambil = ?");
    values.push(req.body.sudahAmbil ? new Date().toISOString() : null);
  }

  if (sets.length === 0) return res.json(rowToItem(item));

  values.push(id);
  db.prepare(`UPDATE items SET ${sets.join(", ")} WHERE id = ?`).run(...values);

  const updated = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
  res.json(rowToItem(updated));
});

app.post("/api/items/:id/pelunasan", (req, res) => {
  const id = Number(req.params.id);
  const item = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
  if (!item) return res.status(404).json({ error: "Tidak ditemukan" });

  const nominal = Math.round(Number(req.body.nominal));
  if (!Number.isFinite(nominal) || nominal <= 0) {
    return res.status(400).json({ error: "Nominal pembayaran tidak valid" });
  }

  const jumlahBayarBaru = (item.jumlah_bayar || 0) + nominal;
  const sisaBayarBaru = Math.max(0, (item.sisa_bayar || 0) - nominal);
  const statusBaru = sisaBayarBaru <= 0 ? "LUNAS" : "DP";
  const waktu = new Date().toISOString();

  db.prepare("BEGIN").run();
  try {
    db.prepare(`
      UPDATE items SET jumlah_bayar = ?, sisa_bayar = ?, status_bayar = ?, waktu_pelunasan = ?
      WHERE id = ?
    `).run(jumlahBayarBaru, sisaBayarBaru, statusBaru, waktu, id);

    db.prepare(`
      INSERT INTO payments (item_id, nominal, jumlah_bayar_setelah, waktu)
      VALUES (?, ?, ?, ?)
    `).run(id, nominal, jumlahBayarBaru, waktu);

    db.prepare("COMMIT").run();
  } catch (err) {
    db.prepare("ROLLBACK").run();
    throw err;
  }

  const updated = db.prepare(`SELECT * FROM items WHERE id = ?`).get(id);
  res.json(rowToItem(updated));
});

app.get("/api/payments", (req, res) => {
  const rows = db
    .prepare(
      `SELECT p.id, p.item_id, i.nama, p.nominal, p.jumlah_bayar_setelah, p.waktu
       FROM payments p JOIN items i ON i.id = p.item_id
       ORDER BY p.waktu DESC`
    )
    .all();
  res.json(
    rows.map((r) => ({
      id: r.id,
      itemId: r.item_id,
      nama: r.nama,
      nominal: r.nominal,
      jumlahBayarSetelah: r.jumlah_bayar_setelah,
      waktu: r.waktu,
    }))
  );
});

function rowToExpense(row) {
  return {
    id: row.id,
    tanggal: row.tanggal,
    namaBahan: row.nama_bahan,
    qty: row.qty,
    satuan: row.satuan,
    hargaSatuan: row.harga_satuan,
    total: row.total,
    catatan: row.catatan,
    waktu: row.waktu,
  };
}

app.get("/api/keuangan/summary", (req, res) => {
  const totalPemasukan =
    db.prepare(`SELECT COALESCE(SUM(jumlah_bayar), 0) s FROM items`).get().s || 0;
  const totalRefundTransfer =
    db
      .prepare(
        `SELECT COALESCE(SUM(refund_nominal), 0) s FROM items WHERE refund_eligible = 1 AND refund_sudah_transfer = 1`
      )
      .get().s || 0;
  const totalRefundBelumTransfer =
    db
      .prepare(
        `SELECT COALESCE(SUM(refund_nominal), 0) s FROM items WHERE refund_eligible = 1 AND refund_sudah_transfer = 0`
      )
      .get().s || 0;
  const totalPengeluaran =
    db.prepare(`SELECT COALESCE(SUM(total), 0) s FROM expenses`).get().s || 0;

  const saldoKas = totalPemasukan - totalRefundTransfer - totalPengeluaran;
  const saldoSetelahSemuaRefund = saldoKas - totalRefundBelumTransfer;

  res.json({
    totalPemasukan,
    totalRefundTransfer,
    totalRefundBelumTransfer,
    totalPengeluaran,
    saldoKas,
    saldoSetelahSemuaRefund,
  });
});

app.get("/api/keuangan/expenses", (req, res) => {
  const rows = db.prepare(`SELECT * FROM expenses ORDER BY waktu DESC`).all();
  res.json(rows.map(rowToExpense));
});

app.post("/api/keuangan/expenses", (req, res) => {
  const tanggal = String(req.body.tanggal || "").trim();
  const namaBahan = String(req.body.namaBahan || "").trim();
  const qty = Math.round(Number(req.body.qty));
  const satuan = String(req.body.satuan || "").trim();
  const hargaSatuan = Math.round(Number(req.body.hargaSatuan) || 0);
  const catatan = String(req.body.catatan || "").trim();
  // Total SENGAJA boleh beda dari qty * hargaSatuan (niru sheet aslinya yang
  // suka ada pembulatan/diskon pas checkout) -- kalau dikosongkan baru
  // di-default ke qty * hargaSatuan.
  const totalInput = req.body.total === "" || req.body.total === undefined ? null : Math.round(Number(req.body.total));

  if (!tanggal) return res.status(400).json({ error: "Tanggal wajib diisi" });
  if (!namaBahan) return res.status(400).json({ error: "Nama bahan wajib diisi" });
  if (!Number.isFinite(qty) || qty <= 0) return res.status(400).json({ error: "Qty tidak valid" });
  const total = totalInput !== null && Number.isFinite(totalInput) ? totalInput : qty * hargaSatuan;
  if (!Number.isFinite(total) || total < 0)
    return res.status(400).json({ error: "Total tidak valid" });

  const waktu = new Date().toISOString();

  const result = db
    .prepare(
      `INSERT INTO expenses (tanggal, nama_bahan, qty, satuan, harga_satuan, total, catatan, waktu)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(tanggal, namaBahan, qty, satuan, hargaSatuan, total, catatan, waktu);

  const created = db.prepare(`SELECT * FROM expenses WHERE id = ?`).get(result.lastInsertRowid);
  res.status(201).json(rowToExpense(created));
});

app.delete("/api/keuangan/expenses/:id", (req, res) => {
  const id = Number(req.params.id);
  const existing = db.prepare(`SELECT id FROM expenses WHERE id = ?`).get(id);
  if (!existing) return res.status(404).json({ error: "Tidak ditemukan" });
  db.prepare(`DELETE FROM expenses WHERE id = ?`).run(id);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Pengambilan app jalan di http://localhost:${PORT}`);
});
