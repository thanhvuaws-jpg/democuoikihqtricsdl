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

  window.goiApi = async (url, than) => {
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
})();
