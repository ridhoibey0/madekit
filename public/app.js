let allItems = [];
let currentItem = null;

const listEl = document.getElementById("list");
const summaryEl = document.getElementById("summary");
const fakultasListEl = document.getElementById("fakultas-list");
const paketListEl = document.getElementById("paket-list");
const matrixWrapEl = document.getElementById("matrix-wrap");
const searchEl = document.getElementById("search");
const filterFakultasEl = document.getElementById("filterFakultas");
const filterStatusEl = document.getElementById("filterStatus");
const filterRefundEl = document.getElementById("filterRefund");
const filterCountEl = document.getElementById("filter-count");
const rowTemplate = document.getElementById("row-template");
const modalBodyTemplate = document.getElementById("modal-body-template");

const modalOverlay = document.getElementById("modal-overlay");
const modalNama = document.getElementById("modal-nama");
const modalSub = document.getElementById("modal-sub");
const modalBadge = document.getElementById("modal-badge");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");
const modalSaving = document.getElementById("modal-saving");

let debounceTimer = null;
let savingCount = 0; // bisa lebih dari 1 request nyusul (misal blur textarea pas checkbox lain lagi kesave)

// Ngunci seluruh modal (disable input, kasih spinner "Menyimpan...") pas ada
// request PATCH/POST lagi jalan, biar admin ga spam klik banyak aksi sekaligus
// buat 1 orang yang sama sebelum request sebelumnya kelar.
function setModalSaving(isSaving) {
  savingCount += isSaving ? 1 : -1;
  const saving = savingCount > 0;
  modalSaving.hidden = !saving;
  modalBody.classList.toggle("saving", saving);
}

async function withSaving(fn) {
  setModalSaving(true);
  try {
    return await fn();
  } finally {
    setModalSaving(false);
  }
}

function formatRupiah(n) {
  if (n === null || n === undefined) return "-";
  return "Rp" + Number(n).toLocaleString("id-ID");
}

function formatWaktu(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  return d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
}

// ---------- tabs ----------
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add("active");
  });
});

// ---------- load ----------
async function loadAllItems() {
  const res = await fetch("/api/items");
  allItems = await res.json();
  populateFakultasFilter();
  renderDashboard();
  renderTable();
}

// Dipakai bareng banyak admin sekaligus -> tiap browser cuma nge-load data
// sekali pas dibuka, jadi kalau ga di-poll, layar admin lain bisa ketinggalan
// (misal masih kelihatan "Belum ambil" padahal admin lain udah nandain, jadi
// resiko 1 orang di-approach 2 admin). Poll berkala biar semua browser tetap
// sinkron otomatis tanpa perlu reload manual.
//
// Item yang lagi dibuka di modal SENGAJA tidak di-render ulang di sini (cuma
// data mentahnya yang di-update in-place) supaya admin yang lagi ngetik
// catatan ga keganggu/ke-reset teksnya di tengah jalan. Data terbarunya bakal
// kepakai begitu modal itu ditutup & dibuka lagi.
const POLL_INTERVAL_MS = 15000;

async function pollRefresh() {
  try {
    const res = await fetch("/api/items");
    if (!res.ok) return;
    const fresh = await res.json();
    const byId = new Map(allItems.map((i) => [i.id, i]));

    for (const f of fresh) {
      const existing = byId.get(f.id);
      if (existing) {
        Object.assign(existing, f);
        byId.delete(f.id);
      } else {
        allItems.push(f);
      }
    }
    // sisa di byId berarti baris yang udah ga ada lagi di server (jarang terjadi)
    if (byId.size > 0) {
      allItems = allItems.filter((i) => !byId.has(i.id));
    }

    populateFakultasFilter();
    renderDashboard();
    renderTable();
  } catch {
    // koneksi kepending sebentar (misal WiFi event rame) -> coba lagi di poll berikutnya
  }
}

setInterval(pollRefresh, POLL_INTERVAL_MS);

function populateFakultasFilter() {
  const current = filterFakultasEl.value;
  const fakultasSet = new Set(allItems.map((i) => i.fakultas).filter(Boolean));
  const options = ["<option value=\"\">Semua Fakultas</option>"];
  for (const f of [...fakultasSet].sort()) {
    options.push(`<option value="${f}">${f}</option>`);
  }
  filterFakultasEl.innerHTML = options.join("");
  filterFakultasEl.value = current;
}

// ---------- dashboard ----------
function renderDashboard() {
  const total = allItems.length;
  const sudahAmbil = allItems.filter((i) => i.sudahAmbil).length;
  const lunas = allItems.filter((i) => i.statusBayar === "LUNAS").length;
  const refundEligible = allItems.filter((i) => i.refundEligible);
  const refundTransfer = refundEligible.filter((i) => i.refundSudahTransfer).length;
  const refundTotalNominal = refundEligible.reduce((sum, i) => sum + (i.refundNominal || 0), 0);

  summaryEl.innerHTML = `
    <div class="stat"><b>${total}</b><span>Total</span></div>
    <div class="stat ok"><b>${sudahAmbil}</b><span>Sudah ambil</span></div>
    <div class="stat warn"><b>${total - sudahAmbil}</b><span>Belum ambil</span></div>
    <div class="stat ok"><b>${lunas}</b><span>Lunas</span></div>
    <div class="stat warn"><b>${total - lunas}</b><span>Belum lunas</span></div>
    <div class="stat"><b>${refundEligible.length}</b><span>Ada refund</span></div>
    <div class="stat warn"><b>${refundEligible.length - refundTransfer}</b><span>Refund belum transfer</span></div>
    <div class="stat"><b>${formatRupiah(refundTotalNominal)}</b><span>Total nominal refund</span></div>
  `;

  renderMatrix();

  const byPaket = new Map();
  for (const item of allItems) {
    const key = item.paket || "Satuan";
    if (!byPaket.has(key)) byPaket.set(key, { total: 0, sudahAmbil: 0 });
    const g = byPaket.get(key);
    g.total++;
    if (item.sudahAmbil) g.sudahAmbil++;
  }
  const paketRows = [...byPaket.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  paketListEl.innerHTML = paketRows
    .map(
      ([paket, g]) => `
      <tr>
        <td>${paket}</td>
        <td class="num">${g.total}</td>
        <td class="num">${g.sudahAmbil}</td>
        <td class="num">${g.total - g.sudahAmbil}</td>
      </tr>`
    )
    .join("");

  const byFakultas = new Map();
  for (const item of allItems) {
    const key = item.fakultas || "(kosong)";
    if (!byFakultas.has(key)) byFakultas.set(key, { total: 0, sudahAmbil: 0, belumLunas: 0 });
    const g = byFakultas.get(key);
    g.total++;
    if (item.sudahAmbil) g.sudahAmbil++;
    if (item.statusBayar !== "LUNAS") g.belumLunas++;
  }
  const rows = [...byFakultas.entries()].sort((a, b) => b[1].total - a[1].total);
  fakultasListEl.innerHTML = rows
    .map(
      ([fakultas, g]) => `
      <tr>
        <td>${fakultas}</td>
        <td class="num">${g.total}</td>
        <td class="num">${g.sudahAmbil}</td>
        <td class="num">${g.total - g.sudahAmbil}</td>
        <td class="num">${g.belumLunas}</td>
      </tr>`
    )
    .join("");
}

function renderMatrix() {
  const paketSet = new Set(allItems.map((i) => i.paket || "Satuan"));
  const paketCols = [...paketSet].sort((a, b) => a.localeCompare(b));
  const fakultasSet = new Set(allItems.map((i) => i.fakultas || "(kosong)"));
  const fakultasRows = [...fakultasSet].sort((a, b) => a.localeCompare(b));

  // pivot[fakultas][paket] = { total, sisa }
  const pivot = new Map();
  for (const item of allItems) {
    const f = item.fakultas || "(kosong)";
    const p = item.paket || "Satuan";
    if (!pivot.has(f)) pivot.set(f, new Map());
    const row = pivot.get(f);
    if (!row.has(p)) row.set(p, { total: 0, sisa: 0 });
    const cell = row.get(p);
    cell.total++;
    if (!item.sudahAmbil) cell.sisa++;
  }

  const cellHtml = (sisa, total) =>
    total === 0
      ? `<td class="matrix-cell-zero">–</td>`
      : sisa === 0
      ? `<td class="matrix-cell-zero">0</td>`
      : `<td>${sisa}</td>`;

  const headerRow = `<tr><th>Fakultas</th>${paketCols
    .map((p) => `<th>${p}</th>`)
    .join("")}<th class="total-col">Total</th></tr>`;

  const bodyRows = fakultasRows
    .map((f) => {
      const row = pivot.get(f) || new Map();
      let rowSisa = 0;
      const cells = paketCols
        .map((p) => {
          const cell = row.get(p) || { total: 0, sisa: 0 };
          rowSisa += cell.sisa;
          return cellHtml(cell.sisa, cell.total);
        })
        .join("");
      return `<tr><td>${f}</td>${cells}<td class="total-col">${rowSisa}</td></tr>`;
    })
    .join("");

  const colTotals = paketCols.map((p) => {
    let sum = 0;
    for (const f of fakultasRows) sum += (pivot.get(f)?.get(p)?.sisa) || 0;
    return sum;
  });
  const grandTotal = colTotals.reduce((a, b) => a + b, 0);
  const totalRow = `<tr class="total-row"><td>Total</td>${colTotals
    .map((s) => `<td>${s}</td>`)
    .join("")}<td class="total-col">${grandTotal}</td></tr>`;

  matrixWrapEl.innerHTML = `
    <table class="matrix-table">
      <thead>${headerRow}</thead>
      <tbody>${bodyRows}${totalRow}</tbody>
    </table>
  `;
}

// ---------- table + filters ----------
function getFilteredItems() {
  const q = searchEl.value.trim().toLowerCase();
  const fakultas = filterFakultasEl.value;
  const status = filterStatusEl.value;
  const refund = filterRefundEl.value;

  return allItems.filter((item) => {
    if (q && !item.nama.toLowerCase().includes(q)) return false;
    if (fakultas && item.fakultas !== fakultas) return false;
    if (status === "sudah" && !item.sudahAmbil) return false;
    if (status === "belum" && item.sudahAmbil) return false;
    if (refund === "ada" && !item.refundEligible) return false;
    if (refund === "belum-transfer" && !(item.refundEligible && !item.refundSudahTransfer)) return false;
    if (refund === "sudah-transfer" && !(item.refundEligible && item.refundSudahTransfer)) return false;
    return true;
  });
}

function renderTable() {
  const filtered = getFilteredItems();
  filterCountEl.textContent = `Menampilkan ${filtered.length} dari ${allItems.length}`;

  listEl.innerHTML = "";
  if (filtered.length === 0) {
    listEl.innerHTML = `<tr><td colspan="3" class="hint">Tidak ada data.</td></tr>`;
    return;
  }
  const frag = document.createDocumentFragment();
  for (const item of filtered) {
    frag.appendChild(renderRow(item));
  }
  listEl.appendChild(frag);
}

function renderRow(item) {
  const node = rowTemplate.content.cloneNode(true);
  const row = node.querySelector(".item-row");
  row.dataset.id = item.id;
  row.classList.toggle("done", item.sudahAmbil);

  node.querySelector(".nama").textContent = item.nama;
  node.querySelector(".sub").textContent =
    [item.paket, item.fakultas, item.jurusan].filter(Boolean).join(" · ");

  const badge = node.querySelector(".status-badge");
  badge.textContent = item.statusBayar || "-";
  badge.classList.add(item.statusBayar === "LUNAS" ? "badge-ok" : "badge-warn");

  const refundPill = node.querySelector(".refund-pill");
  if (item.refundEligible) {
    refundPill.hidden = false;
    refundPill.textContent = item.refundSudahTransfer ? "Refund ✓" : "Refund";
    refundPill.classList.add(item.refundSudahTransfer ? "badge-ok" : "badge-refund");
  }

  const pill = node.querySelector(".ambil-pill");
  pill.textContent = item.sudahAmbil ? "Sudah" : "Belum";
  pill.classList.add(item.sudahAmbil ? "badge-ok" : "badge-warn");
  pill.classList.add("badge");

  row.addEventListener("click", () => openModal(item));

  return node;
}

[searchEl, filterFakultasEl, filterStatusEl, filterRefundEl].forEach((el) => {
  const evt = el === searchEl ? "input" : "change";
  el.addEventListener(evt, () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(renderTable, el === searchEl ? 150 : 0);
  });
});

// ---------- API helpers ----------
async function patchItem(id, body) {
  return withSaving(async () => {
    const res = await fetch(`/api/items/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    return res.json();
  });
}

function applyUpdate(updated) {
  Object.assign(currentItem, updated);
  renderTable();
  renderDashboard();
}

// ---------- modal ----------
function openModal(item) {
  currentItem = item;

  modalNama.textContent = item.nama;
  modalSub.textContent = [item.paket, item.fakultas, item.jurusan].filter(Boolean).join(" · ");
  modalBadge.textContent = item.statusBayar || "-";
  modalBadge.classList.remove("badge-ok", "badge-warn");
  modalBadge.classList.add(item.statusBayar === "LUNAS" ? "badge-ok" : "badge-warn");

  modalBody.innerHTML = "";
  modalBody.appendChild(modalBodyTemplate.content.cloneNode(true));

  setupModalCatatanPenjualan();
  setupModalPelunasan();
  setupModalAmbil();
  setupModalCatatanDanRefund();

  modalOverlay.classList.add("open");
}

function closeModal() {
  if (modalDirty && !confirm("Ada perubahan yang belum disimpan. Tutup tanpa menyimpan?")) {
    return;
  }
  modalOverlay.classList.remove("open");
  currentItem = null;
  modalDirty = false;
}

modalClose.addEventListener("click", closeModal);
modalOverlay.addEventListener("click", (e) => {
  if (e.target === modalOverlay) closeModal();
});
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && modalOverlay.classList.contains("open")) closeModal();
});

function setupModalCatatanPenjualan() {
  const el = modalBody.querySelector(".catatan-penjualan");
  if (currentItem.catatanPenjualan) {
    el.textContent = `Catatan penjualan: ${currentItem.catatanPenjualan}`;
  } else {
    el.remove();
  }
}

function setupModalPelunasan() {
  const box = modalBody.querySelector(".pelunasan-box");
  if (currentItem.statusBayar === "LUNAS") {
    box.remove();
    return;
  }
  const info = box.querySelector(".sisa-bayar-info");
  const numPelunasan = box.querySelector(".num-pelunasan");
  const btnPelunasan = box.querySelector(".btn-pelunasan");

  const renderInfo = () => {
    info.textContent = `Masih DP · sudah bayar ${formatRupiah(currentItem.jumlahBayar)}${
      currentItem.hargaJual ? ` dari ${formatRupiah(currentItem.hargaJual)}` : ""
    } · sisa ${formatRupiah(currentItem.sisaBayar)}`;
  };
  renderInfo();
  numPelunasan.value = currentItem.sisaBayar ?? "";

  btnPelunasan.addEventListener("click", async () => {
    const nominal = Number(numPelunasan.value);
    if (!Number.isFinite(nominal) || nominal <= 0) {
      alert("Isi nominal pembayaran yang valid dulu.");
      return;
    }
    btnPelunasan.disabled = true;
    try {
      const { res, updated } = await withSaving(async () => {
        const r = await fetch(`/api/items/${currentItem.id}/pelunasan`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ nominal }),
        });
        return { res: r, updated: r.ok ? await r.json() : null };
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        alert(err.error || "Gagal menyimpan pembayaran.");
        return;
      }
      applyUpdate(updated);
      modalBadge.textContent = currentItem.statusBayar;
      modalBadge.classList.remove("badge-ok", "badge-warn");
      modalBadge.classList.add(currentItem.statusBayar === "LUNAS" ? "badge-ok" : "badge-warn");
      if (currentItem.statusBayar === "LUNAS") {
        box.remove();
      } else {
        renderInfo();
        numPelunasan.value = currentItem.sisaBayar ?? "";
      }
    } finally {
      btnPelunasan.disabled = false;
    }
  });
}

function setupModalAmbil() {
  const statusEl = modalBody.querySelector(".ambil-status");
  const btnToggle = modalBody.querySelector(".btn-ambil-toggle");
  const confirmBox = modalBody.querySelector(".ambil-confirm");
  const confirmText = modalBody.querySelector(".ambil-confirm-text");
  const btnYes = modalBody.querySelector(".btn-ambil-yes");
  const btnCancel = modalBody.querySelector(".btn-ambil-cancel");

  const renderStatus = () => {
    statusEl.textContent = currentItem.sudahAmbil
      ? `Sudah diambil: ${formatWaktu(currentItem.waktuAmbil)}`
      : "Belum diambil";
    statusEl.classList.toggle("ok", currentItem.sudahAmbil);
    btnToggle.textContent = currentItem.sudahAmbil ? "Batalkan Pengambilan" : "Tandai Sudah Ambil";
    btnToggle.classList.toggle("btn-danger", currentItem.sudahAmbil);
    confirmBox.hidden = true;
    btnToggle.hidden = false;
  };
  renderStatus();

  btnToggle.addEventListener("click", () => {
    const pendingMark = !currentItem.sudahAmbil;
    confirmText.textContent = pendingMark
      ? `Yakin ${currentItem.nama} sudah ambil barang sekarang?`
      : `Yakin batalkan tanda sudah ambil untuk ${currentItem.nama}?`;
    btnToggle.hidden = true;
    confirmBox.hidden = false;
  });

  btnCancel.addEventListener("click", () => {
    confirmBox.hidden = true;
    btnToggle.hidden = false;
  });

  btnYes.addEventListener("click", async () => {
    const pendingMark = !currentItem.sudahAmbil;
    btnYes.disabled = true;
    try {
      const updated = await patchItem(currentItem.id, { sudahAmbil: pendingMark });
      applyUpdate(updated);
      renderStatus();
    } finally {
      btnYes.disabled = false;
    }
  });
}

// Catatan pengambilan & refund SENGAJA tidak auto-save per field (beda dari
// pelunasan/tandai-ambil yang punya tombol aksi sendiri) -- soalnya field di
// sini ada 5 (catatan, 3 refund, catatan refund) dan kalau tiap 1 field
// berubah langsung nge-hit API sendiri-sendiri, jadi banyak banget request
// pas admin lagi ngisi beberapa field berurutan. Makanya digabung: diedit
// bebas dulu, baru dikirim sekali lewat tombol "Simpan Perubahan".
let modalDirty = false;

function setupModalCatatanDanRefund() {
  const txt = modalBody.querySelector(".txt-catatan-ambil");
  const chkRefundEligible = modalBody.querySelector(".chk-refund-eligible");
  const refundBox = modalBody.querySelector(".refund-box");
  const numRefundNominal = modalBody.querySelector(".num-refund-nominal");
  const chkRefundTransfer = modalBody.querySelector(".chk-refund-transfer");
  const txtRefundCatatan = modalBody.querySelector(".txt-refund-catatan");
  const saveStatus = modalBody.querySelector(".save-status");
  const btnSave = modalBody.querySelector(".btn-save");

  txt.value = currentItem.catatanPengambilan;
  chkRefundEligible.checked = currentItem.refundEligible;
  if (currentItem.refundEligible) refundBox.open = true;
  numRefundNominal.value = currentItem.refundNominal ?? "";
  chkRefundTransfer.checked = currentItem.refundSudahTransfer;
  txtRefundCatatan.value = currentItem.refundCatatan;

  modalDirty = false;
  const markDirty = () => {
    modalDirty = true;
    btnSave.disabled = false;
    saveStatus.textContent = "Ada perubahan belum disimpan";
    saveStatus.className = "save-status dirty";
  };
  [txt, chkRefundEligible, numRefundNominal, chkRefundTransfer, txtRefundCatatan].forEach((el) => {
    el.addEventListener("input", markDirty);
    el.addEventListener("change", markDirty);
  });

  btnSave.addEventListener("click", async () => {
    const updated = await patchItem(currentItem.id, {
      catatanPengambilan: txt.value,
      refundEligible: chkRefundEligible.checked,
      refundNominal: numRefundNominal.value,
      refundSudahTransfer: chkRefundTransfer.checked,
      refundCatatan: txtRefundCatatan.value,
    });
    applyUpdate(updated);
    modalDirty = false;
    btnSave.disabled = true;
    saveStatus.textContent = "Tersimpan";
    saveStatus.className = "save-status saved";
  });
}

loadAllItems();
