/* Tiện ích dùng chung cho cả ba tab */
const $ = (s, goc = document) => goc.querySelector(s);
const $$ = (s, goc = document) => [...goc.querySelectorAll(s)];
const esc = s => String(s ?? "").replace(/[&<>"']/g,
  c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const so = (n, chu_so = 0) => Number(n).toLocaleString("vi-VN",
  { minimumFractionDigits: chu_so, maximumFractionDigits: chu_so });

const MAU_CHE_DO = {
  khong_khoa: "#dc2626", bi_quan: "#2563eb", lac_quan: "#d97706", nguyen_tu: "#16a34a",
};
const TEN_NGAN = {
  khong_khoa: "Không khóa", bi_quan: "Khóa bi quan", lac_quan: "Khóa lạc quan", nguyen_tu: "UPDATE nguyên tử",
};

const THONG_TIN = { che_do: {}, muc_co_lap: [] };

async function goiApi(url, than) {
  const tuy_chon = than === undefined ? {} : {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(than),
  };
  let r;
  try { r = await fetch(url, tuy_chon); }
  catch { throw new Error("Không gọi được máy chủ – ứng dụng có đang chạy không?"); }
  let d = null;
  try { d = await r.json(); } catch { /* phản hồi không phải JSON */ }
  if (!r.ok) {
    let chi_tiet = d && d.detail;
    if (Array.isArray(chi_tiet)) chi_tiet = chi_tiet.map(x => `${(x.loc || []).slice(-1)[0]}: ${x.msg}`).join("; ");
    throw new Error(chi_tiet || `Lỗi máy chủ (${r.status})`);
  }
  return d;
}

/** Chạy một thao tác dài: khóa nút, hiện trạng thái, bắt lỗi. */
async function chayCo(nut, o_trang_thai, thong_bao, viec) {
  const cac_nut = $$("button[data-khoa-khi-chay]");
  cac_nut.forEach(b => b.disabled = true);
  nut.disabled = true;
  o_trang_thai.className = "trang-thai dang-chay";
  o_trang_thai.textContent = thong_bao;
  const t0 = performance.now();
  try {
    await viec();
    o_trang_thai.className = "trang-thai";
    o_trang_thai.textContent = `Xong sau ${so((performance.now() - t0) / 1000, 1)} giây`;
  } catch (e) {
    o_trang_thai.className = "trang-thai loi";
    o_trang_thai.textContent = e.message;
  } finally {
    cac_nut.forEach(b => b.disabled = false);
    nut.disabled = false;
  }
}

/* ---------- hộp chú thích khi rê chuột ---------- */
const hop = () => $("#hop-thoai");
function hienHop(ev, html) {
  const h = hop();
  h.innerHTML = html;
  h.style.display = "block";
  const r = h.getBoundingClientRect();
  let x = ev.clientX + 14, y = ev.clientY + 16;
  if (x + r.width > innerWidth - 8) x = ev.clientX - r.width - 14;
  if (y + r.height > innerHeight - 8) y = ev.clientY - r.height - 12;
  h.style.left = Math.max(8, x) + "px";
  h.style.top = Math.max(8, y) + "px";
}
function anHop() { hop().style.display = "none"; }

/* ---------- chuyển tab ---------- */
function chonTab(ten) {
  $$(".tab button").forEach(b => b.classList.toggle("dang-chon", b.dataset.tab === ten));
  $$("main > section").forEach(s => s.hidden = s.id !== "tab-" + ten);
  if (location.hash !== "#" + ten) history.replaceState(null, "", "#" + ten);
  window.dispatchEvent(new CustomEvent("doi-tab", { detail: ten }));
}
$$(".tab button").forEach(b => b.addEventListener("click", () => chonTab(b.dataset.tab)));

/* ---------- ẩn / hiện thanh trên cùng ----------
   Thanh trên dính ở đầu màn hình nên khi cuộn xuống xem lịch giao tác nó che mất một phần.
   Trạng thái được nhớ trong trình duyệt của người xem. */
function datAnDau(an) {
  document.body.classList.toggle("an-dau", an);
  $("#nut-hien-dau").hidden = !an;
  if (!an) doCaoDau();
  try { localStorage.setItem("an-dau", an ? "1" : "0"); } catch { /* bỏ qua */ }
}
// khung CSDL dính ngay dưới thanh trên, nên cần biết thanh trên cao bao nhiêu
function doCaoDau() {
  document.documentElement.style.setProperty("--cao-dau", $("header").offsetHeight + "px");
}
// thanh trên đổi chiều cao khi dòng thông tin MySQL nạp xong hoặc khi đổi cỡ cửa sổ
new ResizeObserver(doCaoDau).observe($("header"));
$("#nut-an-dau").addEventListener("click", () => datAnDau(true));
$("#nut-hien-dau").addEventListener("click", () => datAnDau(false));

/* ---------- biểu đồ cột ---------- */
/**
 * @param {Array<{nhan:string, gt:number, mau:string, min?:number, max?:number, chu?:string}>} du_lieu
 */
function bieuDoCot(du_lieu, { don_vi = "", chu_so = 0 } = {}) {
  const W = 320, H = 190, trai = 8, phai = 8, tren = 20, duoi = 40;
  const cao_ve = H - tren - duoi;
  const gia_tri_max = Math.max(1e-9, ...du_lieu.map(d => Math.max(d.gt, d.max ?? d.gt)));
  const khoang = (W - trai - phai) / du_lieu.length;
  const rong_cot = Math.min(46, khoang * 0.56);
  const y = v => tren + cao_ve - (v / gia_tri_max) * cao_ve;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  s += `<line x1="${trai}" y1="${tren + cao_ve}" x2="${W - phai}" y2="${tren + cao_ve}" stroke="#d0d5dd"/>`;
  du_lieu.forEach((d, i) => {
    const cx = trai + khoang * (i + 0.5);
    const x = cx - rong_cot / 2;
    const h = Math.max(d.gt > 0 ? 1.5 : 0, tren + cao_ve - y(d.gt));
    s += `<rect x="${x}" y="${tren + cao_ve - h}" width="${rong_cot}" height="${h}" rx="3" fill="${d.mau}"/>`;
    if (d.min !== undefined && d.max !== undefined && d.max > d.min) {
      s += `<line x1="${cx}" y1="${y(d.max)}" x2="${cx}" y2="${y(d.min)}" stroke="#344054" stroke-width="1.2"/>
            <line x1="${cx - 5}" y1="${y(d.max)}" x2="${cx + 5}" y2="${y(d.max)}" stroke="#344054" stroke-width="1.2"/>
            <line x1="${cx - 5}" y1="${y(d.min)}" x2="${cx + 5}" y2="${y(d.min)}" stroke="#344054" stroke-width="1.2"/>`;
    }
    const nhan_gt = d.chu ?? (so(d.gt, chu_so) + don_vi);
    const y_chu = Math.min(y(d.max ?? d.gt), y(d.gt)) - 6;
    s += `<text x="${cx}" y="${y_chu}" text-anchor="middle" font-size="11.5" font-weight="600" fill="#1b1f24">${esc(nhan_gt)}</text>`;
    const dong = d.nhan.split(" ");
    const giua = Math.ceil(dong.length / 2);
    [dong.slice(0, giua).join(" "), dong.slice(giua).join(" ")].filter(Boolean).forEach((t, j) =>
      s += `<text x="${cx}" y="${tren + cao_ve + 15 + j * 13}" text-anchor="middle" font-size="11" fill="#667085">${esc(t)}</text>`);
  });
  return s + `</svg>`;
}

/* ---------- biểu đồ đường ---------- */
/**
 * @param {number[]} xs  giá trị trục hoành
 * @param {Array<{ten:string, mau:string, ys:number[]}>} chuoi
 */
function bieuDoDuong(xs, chuoi, { nhan_x = "", don_vi = "" } = {}) {
  const W = 620, H = 280, trai = 52, phai = 16, tren = 14, duoi = 52;
  const rong = W - trai - phai, cao = H - tren - duoi;
  const x_min = Math.min(...xs), x_max = Math.max(...xs);
  const y_max = Math.max(1, ...chuoi.flatMap(c => c.ys));
  const buoc = Math.pow(10, Math.floor(Math.log10(y_max))) * (y_max / Math.pow(10, Math.floor(Math.log10(y_max))) > 5 ? 2 : 1);
  const tran = Math.ceil(y_max / buoc) * buoc;
  const X = v => trai + (x_max === x_min ? rong / 2 : ((v - x_min) / (x_max - x_min)) * rong);
  const Y = v => tren + cao - (v / tran) * cao;
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img">`;
  for (let v = 0; v <= tran + 1e-9; v += buoc) {
    s += `<line x1="${trai}" y1="${Y(v)}" x2="${W - phai}" y2="${Y(v)}" stroke="${v === 0 ? "#d0d5dd" : "#f0f1f3"}"/>
          <text x="${trai - 8}" y="${Y(v) + 4}" text-anchor="end" font-size="11" fill="#667085">${so(v)}</text>`;
  }
  xs.forEach(v => s += `<text x="${X(v)}" y="${tren + cao + 17}" text-anchor="middle" font-size="11" fill="#667085">${v}</text>`);
  s += `<text x="${trai + rong / 2}" y="${H - 12}" text-anchor="middle" font-size="11.5" fill="#344054">${esc(nhan_x)}</text>`;
  s += `<text x="14" y="${tren + cao / 2}" text-anchor="middle" font-size="11.5" fill="#344054" transform="rotate(-90 14 ${tren + cao / 2})">${esc(don_vi)}</text>`;
  chuoi.forEach(c => {
    const d = c.ys.map((v, i) => `${i ? "L" : "M"}${X(xs[i])},${Y(v)}`).join("");
    s += `<path d="${d}" fill="none" stroke="${c.mau}" stroke-width="2.4" stroke-linejoin="round"/>`;
    c.ys.forEach((v, i) => s += `<circle cx="${X(xs[i])}" cy="${Y(v)}" r="3.6" fill="#fff" stroke="${c.mau}" stroke-width="2">
      <title>${esc(c.ten)} – ${xs[i]} khách: ${so(v)} ${esc(don_vi)}</title></circle>`);
  });
  return s + `</svg>`;
}

/* ---------- giải nghĩa các loại khóa của InnoDB ---------- */
function yNghiaKhoa(loai_khoa, che_do) {
  if (loai_khoa === "TABLE") {
    return { IX: "Ý định ghi ở mức bảng – báo trước sẽ khóa X một số dòng",
             IS: "Ý định đọc có khóa ở mức bảng – báo trước sẽ khóa S một số dòng" }[che_do] || "Khóa mức bảng";
  }
  const bang = {
    "X,REC_NOT_GAP": "Khóa ghi trên đúng một bản ghi (record lock)",
    "S,REC_NOT_GAP": "Khóa đọc trên đúng một bản ghi (record lock)",
    "X": "Next-key lock: khóa ghi bản ghi + khoảng trống ngay trước nó",
    "S": "Next-key lock: khóa đọc bản ghi + khoảng trống ngay trước nó",
    "X,GAP": "Gap lock: chỉ khóa khoảng trống, không cho chèn vào",
    "S,GAP": "Gap lock: chỉ khóa khoảng trống, không cho chèn vào",
    "X,GAP,INSERT_INTENTION": "Xin chèn vào một khoảng trống (insert intention)",
    "X,INSERT_INTENTION": "Xin chèn vào một khoảng trống (insert intention)",
  };
  return bang[che_do] || "";
}

function bangKhoa(khoa, { cot_ten = "phien", ten_cot = "Phiên", co_moc = false } = {}) {
  if (!khoa.length) return "";
  return `<table><tr>${co_moc ? "<th>Mốc</th>" : ""}<th>${ten_cot}</th><th>Bảng</th><th>Chỉ mục</th><th>Loại</th>
    <th>Chế độ khóa</th><th>Trạng thái</th><th>Dữ liệu</th><th>Ý nghĩa</th></tr>`
    + khoa.map(k => `<tr class="${k.trang_thai === "WAITING" ? "cho-khoa" : ""}">
      ${co_moc ? `<td class="so-lieu">${so(k.moc, 0)} ms</td>` : ""}
      <td><b>${esc(k[cot_ten])}</b></td><td><code>${esc(k.bang)}</code></td>
      <td>${esc(k.chi_muc || "—")}</td><td>${esc(k.loai_khoa)}</td>
      <td><code>${esc(k.che_do_khoa)}</code></td>
      <td>${k.trang_thai === "WAITING" ? '<b style="color:var(--do)">WAITING</b>' : esc(k.trang_thai)}</td>
      <td>${esc(k.du_lieu ?? "—")}</td>
      <td style="color:var(--mo)">${esc(yNghiaKhoa(k.loai_khoa, k.che_do_khoa))}</td></tr>`).join("")
    + `</table>`;
}

function chuGiaiChuoi(chuoi) {
  return `<div class="chu-giai" style="margin-top:6px">${chuoi.map(c =>
    `<span><i class="o-mau" style="background:${c.mau}"></i>${esc(c.ten)}</span>`).join("")}</div>`;
}

/* ---------- khởi động ---------- */
async function napThongTin() {
  try {
    const d = await goiApi("/api/thong-tin");
    const m = d.may_chu;
    THONG_TIN.che_do = d.che_do;
    THONG_TIN.muc_co_lap = d.muc_co_lap;
    $("#tt-may-chu").innerHTML =
      `MySQL ${esc(m.phien_ban)} · storage engine của các bảng: <b>${esc(m.engine_bang || m.engine)}</b>`
      + ` · mức cô lập mặc định: ${esc(m.muc_co_lap)}`
      + ` · innodb_lock_wait_timeout = ${esc(m.han_cho_khoa)} s`
      + ` · phát hiện deadlock: ${m.phat_hien_deadlock ? "bật" : "tắt"}`;
    window.dispatchEvent(new CustomEvent("da-nap-thong-tin", { detail: d }));
  } catch (e) {
    $("#tt-may-chu").innerHTML = `<span style="color:var(--do)">Chưa kết nối được MySQL: ${esc(e.message)}</span>`;
  }
}

window.addEventListener("DOMContentLoaded", () => {
  // Máy chủ chỉ cho chạy một kịch bản mỗi lúc, nên khi một nút chạy thì khóa hết các nút chạy khác
  ["#dv-chay", "#cl-chay", "#cl-ma-tran", "#ss-chay", "#ks-chay", "#xd-chay-lai"]
    .forEach(s => $(s) && $(s).setAttribute("data-khoa-khi-chay", ""));
  const tab = location.hash.slice(1);
  chonTab(["xungdot", "datve", "colap", "sosanh"].includes(tab) ? tab : "xungdot");
  napThongTin();
  let an_dau = false;
  try { an_dau = localStorage.getItem("an-dau") === "1"; } catch { /* bỏ qua */ }
  datAnDau(an_dau);
  doCaoDau();
});
