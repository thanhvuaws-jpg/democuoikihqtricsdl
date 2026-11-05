/* Bản web tĩnh của demo – chỉ HTML/CSS/JS, KHÔNG có máy chủ.
 *
 * Tệp này nạp ngay sau chung.js và thay hàm goiApi(): thay vì gọi API FastAPI → MySQL, trang đọc kết quả
 * đã chạy THẬT trên MySQL 9.6 / InnoDB và được ghi sẵn trong thư mục du-lieu/ (tạo bằng
 * _cong-cu/ghi_du_lieu.py). Mỗi kết quả là một tệp du-lieu/<khóa>.js, chỉ tải khi cần.
 * Các ô nhập tự do (số khách, số ghế…) được đổi thành danh sách các cấu hình đã ghi sẵn.
 */
(() => {
  const KHO = (window.DU_LIEU = window.DU_LIEU || {});
  const dang_tai = {};

  // Các cấu hình đã ghi sẵn – phải khớp với _cong-cu/ghi_du_lieu.py
  const QUY_MO = [[6, 3], [10, 5], [20, 10], [40, 20], [60, 30]];   // tab 2: [số khách, số ghế]
  const QUY_MO_CO_MUC = 10;                                          // chỉ quy mô này có đủ 4 mức cô lập
  const THINK_DAT_VE = 100;
  const SO_SANH = [[10, 5], [20, 10], [40, 20]];                     // tab 4: [số khách, số ghế]
  const SO_SANH_THINK = 80, SO_SANH_LAN = 3;
  const KHAO_SAT = ["5, 10, 20, 40", "5, 10, 20, 40, 60"];
  const KHAO_SAT_THINK = 50;

  const tenMuc = m => (m ? m.replace(/ /g, "_") : "mac_dinh");

  /* ---------------------------------------------------------------- đọc dữ liệu đã ghi */
  function taiDuLieu(khoa) {
    if (khoa in KHO) return Promise.resolve(KHO[khoa]);
    if (!dang_tai[khoa]) {
      dang_tai[khoa] = new Promise((xong, loi) => {
        const s = document.createElement("script");
        s.src = `du-lieu/${khoa}.js`;
        s.onload = () => (khoa in KHO ? xong(KHO[khoa]) : loi(new Error(`Tệp dữ liệu ${khoa} bị lỗi.`)));
        s.onerror = () => {
          delete dang_tai[khoa];
          s.remove();
          loi(new Error("Bản web chưa có sẵn kết quả cho cấu hình này."));
        };
        document.head.appendChild(s);
      });
    }
    return dang_tai[khoa];
  }

  function khoaCua(url, than = {}) {
    switch (url) {
      case "/api/thong-tin": return "thong-tin";
      case "/api/xung-dot": return "xung-dot";
      case "/api/xung-dot/chay": return `xung-dot/${than.ma}_${than.loai}`;
      case "/api/thi-nghiem": return "thi-nghiem";
      case "/api/thi-nghiem/chay": return `thi-nghiem/${than.ma}_${tenMuc(than.muc_co_lap)}`;
      case "/api/thi-nghiem/ma-tran": return "ma-tran";
      case "/api/chay":
        return `dat-ve/${than.che_do}_${than.so_khach}_${than.ton_kho}_${than.think_ms}_${tenMuc(than.muc_co_lap)}`;
      case "/api/so-sanh": return `so-sanh/${than.so_khach}_${than.ton_kho}_${than.think_ms}_${than.so_lan}`;
      case "/api/khao-sat": return `khao-sat/${than.cac_muc.join("-")}_${than.think_ms}`;
      default: throw new Error(`Bản web không hỗ trợ ${url}`);
    }
  }

  const cho = ms => new Promise(r => setTimeout(r, ms));

  /* ---------------------------------------------------------------- màn hình MySQL: CSDL giả lập trong trình duyệt
   * Không có MySQL nên "dữ liệu hiện tại" là trạng thái cuối của lần phát lại gần nhất (đã chạy thật và ghi sẵn);
   * nút Reset đưa về dữ liệu ban đầu đã ghi; ô SELECT chỉ hiểu câu đơn giản trên ba bảng đó. */
  const sao = o => JSON.parse(JSON.stringify(o));
  let csdl_web = null;          // {trang_thai, khoa, cho}

  async function csdlHienTai() {
    if (!csdl_web) csdl_web = sao(await taiDuLieu("csdl-ban-dau"));
    return csdl_web;
  }

  function capNhatSauPhatLai(kq) {
    if (!csdl_web || !kq || !kq.nhat_ky || !kq.nhat_ky.length) return;
    const cuoi = kq.nhat_ky[kq.nhat_ky.length - 1].trang_thai || {};
    for (const [bang, t] of Object.entries(cuoi)) {
      csdl_web.trang_thai[bang] = sao({ ...t, moi_nhat: t.da_commit });
    }
    csdl_web.khoa = [];
    csdl_web.cho = [];
  }

  const CHI_DOC = /^(SELECT|SHOW|DESCRIBE|DESC|EXPLAIN|WITH)\b/i;
  const CAM = /\bFOR\s+(UPDATE|SHARE)\b|\bLOCK\s+IN\s+SHARE\s+MODE\b|\bINTO\b|\bSLEEP\s*\(|\bGET_LOCK\s*\(/i;

  async function truyVanWeb(sql) {
    const cau = String(sql || "").trim().replace(/;+\s*$/, "").trim();
    if (!cau) throw new Error("Hãy nhập một câu lệnh, ví dụ: SELECT * FROM chuyen_bay");
    if (cau.includes(";")) throw new Error("Mỗi lần chỉ chạy một câu lệnh.");
    if (!CHI_DOC.test(cau) || CAM.test(cau)) {
      throw new Error("Ô này chỉ để xem dữ liệu: chỉ cho phép SELECT / SHOW / DESCRIBE / EXPLAIN (không FOR UPDATE, không INTO).");
    }
    const t0 = performance.now();
    const db = await csdlHienTai();
    const m = cau.match(/^SELECT\s+(.+?)\s+FROM\s+([\w.]+)(?:\s+WHERE\s+(.+?))?(?:\s+ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?)?$/i);
    const khong_ho_tro = { sql: cau, loi: { ma: 0, thong_diep: "Bản web không có MySQL: chỉ hiểu câu dạng SELECT cột | * FROM bảng "
      + "[WHERE cột = giá trị AND …] [ORDER BY cột]. Chạy bản đầy đủ (khoi-dong.bat) để gõ câu bất kỳ." } };
    if (!m) return khong_ho_tro;
    const ten_bang = m[2].toLowerCase();
    if (ten_bang === "performance_schema.data_locks" || ten_bang === "performance_schema.data_lock_waits") {
      const cot = m[1].trim() === "*" ? ["object_name", "index_name", "lock_type", "lock_mode", "lock_status", "lock_data"]
        : m[1].split(",").map(c => c.trim());
      return { sql: cau, cot, dong: [], so_dong: 0, thoi_gian_ms: 0.1, cat_bot: false };
    }
    const t = db.trang_thai[ten_bang];
    if (!t) return { sql: cau, loi: { ma: 1146, thong_diep: `Table 'demo_dongthoi.${m[2]}' doesn't exist` } };
    let dong = sao(t.da_commit);
    const tat_ca_cot = Object.keys(dong[0] || {});
    if (m[3]) {
      const dk = m[3].split(/\s+AND\s+/i).map(x => x.match(/^(\w+)\s*(=|>|<|>=|<=|<>|!=)\s*'?([^']*?)'?$/));
      if (dk.some(x => !x)) return khong_ho_tro;
      dong = dong.filter(d => dk.every(([, c, op, v]) => {
        const a = d[c], b = typeof a === "number" ? Number(v) : v;
        return { "=": a == b, ">": a > b, "<": a < b, ">=": a >= b, "<=": a <= b, "<>": a != b, "!=": a != b }[op];
      }));
    }
    if (m[4]) {
      const c = m[4], g = (m[5] || "").toUpperCase() === "DESC" ? -1 : 1;
      dong.sort((x, y) => (x[c] > y[c] ? g : x[c] < y[c] ? -g : 0));
    }
    const cot = m[1].trim() === "*" ? tat_ca_cot : m[1].split(",").map(c => c.trim().split(/\s+AS\s+/i).pop());
    const goc = m[1].trim() === "*" ? tat_ca_cot : m[1].split(",").map(c => c.trim().split(/\s+AS\s+/i)[0]);
    if (goc.some(c => !tat_ca_cot.includes(c))) {
      const sai = goc.find(c => !tat_ca_cot.includes(c));
      return { sql: cau, loi: { ma: 1054, thong_diep: `Unknown column '${sai}' in 'field list'` } };
    }
    dong = dong.map(d => Object.fromEntries(cot.map((c, i) => [c, d[goc[i]]])));
    return { sql: cau, cot, dong, so_dong: dong.length, thoi_gian_ms: Math.round((performance.now() - t0) * 10) / 10,
             cat_bot: false };
  }

  window.goiApi = async (url, than) => {
    if (url === "/api/csdl/hien-tai") return sao(await csdlHienTai());
    if (url === "/api/csdl/dat-lai") {
      csdl_web = sao(await taiDuLieu("csdl-ban-dau"));
      await cho(250);
      return sao(csdl_web);
    }
    if (url === "/api/csdl/truy-van") return truyVanWeb(than && than.sql);
    if (url === "/api/thu-tuc") return sao(await taiDuLieu("thu-tuc"));
    if (url === "/api/xung-dot/chay") {
      await csdlHienTai();
      const kq = await taiDuLieu(khoaCua(url, than));
      await cho(350);
      capNhatSauPhatLai(kq);
      return sao(kq);
    }
    const khoa = khoaCua(url, than);
    // chờ một nhịp ngắn để người xem thấy trạng thái "đang tải" như khi chạy thật
    const [d] = await Promise.all([taiDuLieu(khoa), cho(than === undefined ? 0 : 350)]);
    return JSON.parse(JSON.stringify(d));   // trả bản sao: giao diện có thể sửa đối tượng nhận được
  };

  const chayCoGoc = window.chayCo;
  window.chayCo = (nut, o_trang_thai, thong_bao, viec) =>
    chayCoGoc(nut, o_trang_thai, "Đang tải kết quả đã chạy trên MySQL…", viec);

  window.addEventListener("da-nap-thong-tin", () => {
    const o = document.getElementById("tt-may-chu");
    if (o) o.insertAdjacentHTML("beforeend", " · <b>bản web: kết quả đã ghi sẵn</b>");
  });

  /* ---------------------------------------------------------------- đổi ô nhập tự do thành lựa chọn có sẵn
   * Chạy ngay khi nạp (trước các tệp tab-*.js) để các tab gắn sự kiện vào đúng phần tử mới. */
  function thanhChon(id, lua_chon, mac_dinh) {
    const cu = document.getElementById(id);
    if (!cu) return null;
    const moi = document.createElement("select");
    moi.id = id;
    moi.innerHTML = lua_chon.map(([gt, nhan]) => `<option value="${gt}">${nhan}</option>`).join("");
    moi.value = String(mac_dinh);
    cu.replaceWith(moi);
    return moi;
  }

  function coDinh(id, gia_tri, ghi_chu) {
    const o = document.getElementById(id);
    if (!o) return null;
    o.value = gia_tri;
    o.readOnly = true;
    o.classList.add("o-co-dinh");
    o.title = ghi_chu;
    return o;
  }

  function ghiChu(id_o, noi_dung) {
    const o = document.getElementById(id_o);
    const hang = o && o.closest(".o")?.parentElement;
    if (hang) hang.insertAdjacentHTML("afterend", `<p class="ghi-chu-web">${noi_dung}</p>`);
  }

  // tab 2 – nhiều khách đặt vé
  const dv_khach = thanhChon("dv-so-khach", QUY_MO.map(([k]) => [k, `${k} khách`]), 10);
  const dv_ghe = coDinh("dv-ton-kho", 5, "Bản web: số ghế đi theo số khách (bằng một nửa)");
  coDinh("dv-think", THINK_DAT_VE, "Bản web: thời gian cân nhắc cố định 100 ms");
  function dongBoDatVe() {
    const k = +dv_khach.value;
    dv_ghe.value = QUY_MO.find(([x]) => x === k)[1];
    const muc = document.getElementById("dv-muc");
    if (muc) {
      muc.disabled = k !== QUY_MO_CO_MUC;
      if (muc.disabled) muc.value = "";
    }
  }
  if (dv_khach && dv_ghe) {
    dv_khach.addEventListener("change", dongBoDatVe);
    window.addEventListener("da-nap-thong-tin", () => setTimeout(dongBoDatVe));
    ghiChu("dv-so-khach", "Bản web chỉ có các cấu hình đã chạy sẵn: số ghế bằng một nửa số khách, cân nhắc 100 ms; "
      + "chọn mức cô lập khác mặc định ở quy mô 10 khách.");
  }

  // tab 4 – so sánh hiệu năng và khảo sát chịu tải
  const ss_khach = thanhChon("ss-so-khach", SO_SANH.map(([k]) => [k, `${k} khách`]), 10);
  const ss_ghe = coDinh("ss-ton-kho", 5, "Bản web: số ghế đi theo số khách (bằng một nửa)");
  coDinh("ss-think", SO_SANH_THINK, "Bản web: cân nhắc cố định 80 ms");
  coDinh("ss-lan", SO_SANH_LAN, "Bản web: lặp cố định 3 lần");
  if (ss_khach && ss_ghe) {
    ss_khach.addEventListener("change", () => {
      ss_ghe.value = SO_SANH.find(([x]) => x === +ss_khach.value)[1];
    });
  }
  thanhChon("ks-muc", KHAO_SAT.map(s => [s, s]), KHAO_SAT[0]);
  coDinh("ks-think", KHAO_SAT_THINK, "Bản web: cân nhắc cố định 50 ms");

  // tab 1 – nút chạy lại chỉ phát lại kết quả đã ghi
  const nut = document.getElementById("xd-chay-lai");
  if (nut) {
    nut.textContent = "↻ Phát lại kết quả";
    nut.title = "Bản web: phát lại kết quả đã chạy thật trên MySQL";
  }
  // màn hình MySQL: không có CSDL thật nên bàn điều khiển chạy trên dữ liệu đã ghi; phpMyAdmin chỉ có ở bản chạy trên máy
  const phu_bdk = document.getElementById("xd-bdk-phu");
  if (phu_bdk) phu_bdk.textContent = "bản web: dữ liệu đã ghi từ MySQL thật · chỉ hiểu SELECT đơn giản";
  const pma = document.getElementById("xd-mo-pma");
  if (pma) {
    pma.classList.add("tat");
    pma.removeAttribute("href");
    pma.textContent = "🗄 phpMyAdmin: chỉ có ở bản chạy trên máy";
    pma.insertAdjacentHTML("afterend", `<p class="ghi-chu-web" style="flex-basis:100%">Bản web không có MySQL. Tải mã nguồn
      tại <a href="https://github.com/thanhvuaws-jpg/hequantricosodemodongthoi" target="_blank" rel="noopener">GitHub</a>,
      chạy <code>khoi-dong.bat</code> rồi mở <code>http://localhost:8081</code> để tự chạy các thủ tục dưới đây trên CSDL thật.</p>`);
  }
})();
