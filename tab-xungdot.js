/* Tab 1 – 5 xung đột, mỗi xung đột một kịch bản SAI và một kịch bản ĐÚNG.
 *
 * Kịch bản được chạy thật trên MySQL (POST /api/xung-dot/chay). Máy chủ trả về nhật ký
 * từng sự kiện, kèm ảnh chụp dữ liệu (đã commit / mới nhất) và bảng khóa sau mỗi sự kiện.
 * Ở đây chỉ PHÁT LẠI dữ liệu đó – không có gì được giả lập.
 *
 * Màn hình gồm:
 *   - "lịch giao tác": bảng 2 cột T₁ (phiên A) | T₂ (phiên B), thời gian chạy từ trên xuống,
 *     thanh dọc cạnh mỗi cột cho biết giao tác đang mở / đang bị chặn;
 *   - "cơ sở dữ liệu": nội dung bảng + khóa tại thời điểm đang xem;
 *   - chuỗi ký hiệu lịch r₁(X) w₂(X)… và lời giải thích từng bước bằng ngôn ngữ thường.
 */
(() => {
  let DS = {};
  let ma = "mat_cap_nhat";
  let loai = "sai";
  const bo_nho = {};          // "ma:loai" -> kết quả đã chạy
  let kq = null;              // kết quả đang phát
  let khung = 0;              // 0 = trạng thái ban đầu; i = ngay sau sự kiện thứ i
  let toc_do = 1;
  let dang_phat = false;
  let hen = null;
  let luot_hoat_hinh = 0;     // tăng mỗi khi đổi khung, để hủy hoạt hình cũ còn dở
  let THU_TUC = null;         // thủ tục T1/T2 để tự chạy trên phpMyAdmin (GET /api/thu-tuc)
  let che_do_xem = "mysql";   // "mysql" = hai cửa sổ dòng lệnh + màn hình dưới CSDL; "lich" = lịch giao tác 2 cột
  try { if (localStorage.getItem("xd-che-do") === "lich") che_do_xem = "lich"; } catch { /* mặc định */ }

  const TEN_PHIEN = { A: "Quầy vé A", B: "App di động B" };
  const khoaBN = (m, l) => `${m}:${l}`;
  const N = () => (kq ? kq.nhat_ky.length : 0);
  const lenhCua = sql => (sql || "").trim().split(/\s+/)[0].toUpperCase();
  const manHinhHep = () => matchMedia("(max-width: 1080px)").matches;
  const kia = p => (p === "A" ? "B" : "A");

  const TU_KHOA = /\b(SET SESSION TRANSACTION ISOLATION LEVEL|START TRANSACTION|SELECT|FROM|WHERE|FOR UPDATE|FOR SHARE|UPDATE|SET|INSERT INTO|DELETE|VALUES|COMMIT|ROLLBACK|AND|OR|ORDER BY|GROUP BY|LIMIT|COUNT|SHOW|DESCRIBE|EXPLAIN|JOIN|ON|AS)\b/g;
  const toMauSql = sql => esc(sql).replace(TU_KHOA, '<span class="tk">$1</span>');

  /* ------------------------------------------------------------ nạp & chọn */
  async function nap() {
    try {
      const d = await goiApi("/api/xung-dot");
      DS = d.xung_dot;
      veDanhSach();
      chon(ma, loai);
      goiApi("/api/thu-tuc").then(t => { THU_TUC = t; veThuTuc(); })
        .catch(e => { $("#xd-pma").innerHTML = `<div class="ket-luan trung">Không tải được thủ tục: ${esc(e.message)}</div>`; });
    } catch (e) {
      $("#xd-loi-dan").textContent = "Không tải được danh sách xung đột: " + e.message;
    }
  }

  function veDanhSach() {
    $("#xd-ds").innerHTML = Object.entries(DS).map(([m, x]) => {
      const s = bo_nho[khoaBN(m, "sai")], d = bo_nho[khoaBN(m, "dung")];
      return `<button class="the-xd ${m === ma ? "dang-chon" : ""}" data-ma="${m}" data-khoa-khi-chay>
        <span style="display:flex;gap:8px;align-items:center"><span class="so-xd">${x.so}</span><b>${esc(x.ten)}</b></span>
        <i>${esc(x.ten_en)}</i>
        <span class="cham"><span class="${s ? "da-sai" : ""}">${s ? "✗ sai · đã chạy" : "sai"}</span>
          <span class="${d ? "da-dung" : ""}">${d ? "✓ đúng · đã chạy" : "đúng"}</span></span></button>`;
    }).join("");
    $$("#xd-ds .the-xd").forEach(b => b.addEventListener("click", () => {
      if (b.dataset.ma !== ma) chon(b.dataset.ma, "sai");
    }));
  }

  async function chon(m, l, chay_lai = false) {
    dungPhat();
    ma = m; loai = l;
    veDanhSach();
    const x = DS[ma];
    const kb = x.kich_ban[loai];
    $("#xd-ten").textContent = `${x.so}. ${x.ten} (${x.ten_en})`;
    $("#xd-van-de").textContent = x.van_de;
    $$("#xd-chon-kb button").forEach(b => {
      b.classList.toggle("dang-chon", b.dataset.loai === loai);
      b.querySelector("span").textContent = x.kich_ban[b.dataset.loai].tieu_de;
    });
    $("#xd-cach-lam").innerHTML = `<b>${loai === "sai" ? "Cách làm SAI" : "Cách làm ĐÚNG"}:</b> ${esc(kb.cach_lam)}
      &nbsp;·&nbsp; Mức cô lập của cả hai phiên: <code>${esc(kb.muc_co_lap)}</code>`;
    veSoSanh();
    veMaNguon();
    veThuTuc();

    const da_co = bo_nho[khoaBN(ma, loai)];
    if (da_co && !chay_lai) {
      kq = da_co; khung = 0; veKhung(); phat(); return;
    }
    kq = null; khung = 0;
    veTinh(x);
    await chayCo($("#xd-chay-lai"), $("#xd-trang-thai"), "Đang chạy trên MySQL…", async () => {
      const r = await goiApi("/api/xung-dot/chay", { ma, loai });
      bo_nho[khoaBN(r.ma, r.loai)] = r;
      if (r.ma === ma && r.loai === loai) { kq = r; khung = 0; veKhung(); phat(); }
    });
    veDanhSach();
    veSoSanh();
  }

  /** Trong lúc chờ MySQL chạy kịch bản. */
  function veTinh(x) {
    for (const s of ["#xd-tien-do", "#xd-lich", "#xd-giai-thich", "#xd-ket-luan", "#xd-lop"]) $(s).innerHTML = "";
    $("#xd-dem").textContent = "";
    $("#xd-loi-dan").innerHTML = `<span class="phu-ld">Đang chạy kịch bản trên MySQL…</span>`;
    $("#xd-lich-gt").innerHTML = `<div class="lgt-cho">Đang chạy hai phiên A và B trên MySQL 9.6…</div>`;
    for (const p of ["A", "B"]) {
      $(`#xd-term-${p}`).innerHTML = dauTerm(`Phiên ${p} · ${TEN_PHIEN[p]}`, "mysql -u root demo_dongthoi", "", "")
        + `<div class="term-than"><div class="t-ra t-cho"><span class="t-xoay"></span> đang chạy kịch bản trên MySQL 9.6…</div></div>`;
    }
    $("#xd-qs").innerHTML = dauTerm("🗄 Dưới CSDL", "đang chờ kết quả…", "", "") + `<div class="term-than"></div>`;
    $("#xd-csdl").innerHTML = `<div class="dau-p"><b>🗄️ CSDL Trung Tâm SkyRoute – MySQL 9.6 InnoDB Engine</b></div>
      <div class="than"><div class="hang-doi trong">Bảng: ${x.bang.map(b => `<code>${esc(b)}</code>`).join(", ")}</div></div>`;
  }

  /* ------------------------------------------------------------ phát lại */
  function phat() {
    if (!kq) return;
    if (khung >= N()) { khung = 0; veKhung(); }
    dang_phat = true;
    $("#xd-phat").textContent = "⏸ Dừng";
    lichBuocTiep();
  }
  function lichBuocTiep() {
    clearTimeout(hen);
    if (!dang_phat || !kq) return;
    if (khung >= N()) { dungPhat(); return; }
    const truoc = khung > 0 ? kq.nhat_ky[khung - 1] : null;
    const cho = khung === 0 ? 1000 : (truoc.loai === "bi_chan" || truoc.ket_qua?.loi) ? 3200 : 2300;
    hen = setTimeout(() => { toi(khung + 1, true); lichBuocTiep(); }, cho / toc_do);
  }
  function dungPhat() {
    dang_phat = false;
    clearTimeout(hen);
    $("#xd-phat").textContent = "▶ Phát hoạt hình";
  }
  function toi(k, hoat_hinh = false) {
    if (!kq) return;
    khung = Math.max(0, Math.min(N(), k));
    veKhung(hoat_hinh);
  }

  $("#xd-phat").addEventListener("click", () => (dang_phat ? dungPhat() : phat()));
  $("#xd-dau").addEventListener("click", () => { dungPhat(); toi(0); });
  $("#xd-lui").addEventListener("click", () => { dungPhat(); toi(khung - 1); });
  $("#xd-tien").addEventListener("click", () => { dungPhat(); toi(khung + 1, true); });
  $("#xd-cuoi").addEventListener("click", () => { dungPhat(); toi(N()); });
  $("#xd-chay-lai").addEventListener("click", () => chon(ma, loai, true));
  $$("#xd-chon-kb button").forEach(b => b.setAttribute("data-khoa-khi-chay", ""));
  $$("#xd-chon-kb button").forEach(b => b.addEventListener("click", () => {
    if (b.dataset.loai !== loai || !kq) chon(ma, b.dataset.loai);
  }));
  $$("#xd-toc-do button").forEach(b => b.addEventListener("click", () => {
    toc_do = +b.dataset.v;
    $$("#xd-toc-do button").forEach(x => x.classList.toggle("dang-chon", x === b));
    if (dang_phat) lichBuocTiep();
  }));
  document.addEventListener("keydown", ev => {
    if ($("#tab-xungdot").hidden || !kq) return;
    if (["INPUT", "SELECT", "TEXTAREA", "SUMMARY"].includes(document.activeElement?.tagName)) return;
    const viec = {
      ArrowRight: () => { dungPhat(); toi(khung + 1, true); },
      ArrowLeft: () => { dungPhat(); toi(khung - 1); },
      Home: () => { dungPhat(); toi(0); },
      End: () => { dungPhat(); toi(N()); },
      " ": () => (dang_phat ? dungPhat() : phat()),
    }[ev.key];
    if (viec) { viec(); ev.preventDefault(); }
  });
  window.addEventListener("doi-tab", ev => { if (ev.detail !== "xungdot") dungPhat(); });
  window.addEventListener("resize", () => { if (kq && !$("#tab-xungdot").hidden) veKhung(); });

  /* ------------------------------------------------------------ vẽ một khung */
  function veKhung(hoat_hinh = false) {
    if (!kq) return;
    luot_hoat_hinh++;
    const e = khung > 0 ? kq.nhat_ky[khung - 1] : null;

    $("#xd-tien-do").innerHTML = kq.nhat_ky.map((s, i) => {
      const lop = [i < khung - 1 ? "qua" : "", i === khung - 1 ? "hien" : "",
                   s.loai === "bi_chan" ? "chan" : "", s.ket_qua?.loi ? "loi" : ""].join(" ");
      return `<i class="${lop}" data-k="${i + 1}" title="t${i + 1} · phiên ${esc(s.phien)}: ${esc(s.mo_ta)}"></i>`;
    }).join("");
    $$("#xd-tien-do i").forEach(i => i.addEventListener("click", () => { dungPhat(); toi(+i.dataset.k); }));
    $("#xd-dem").textContent = khung === 0 ? `Chưa chạy · ${N()} bước` : `Thời điểm t${khung} / t${N()}`;
    $("#xd-dau").disabled = $("#xd-lui").disabled = khung === 0;
    $("#xd-tien").disabled = $("#xd-cuoi").disabled = khung === N();

    $("#xd-loi-dan").innerHTML = loiDan(e);
    $("#xd-giai-thich").innerHTML = `<span class="gtb-icon">💡</span><div><b>Chuyện gì vừa xảy ra?</b> ${giaiThich(e)}</div>`;
    $("#xd-lich").innerHTML = veKyHieu();
    $$("#xd-lich .kh-chip").forEach(c => c.addEventListener("click", () => { dungPhat(); toi(+c.dataset.k); }));

    $("#xd-ket-luan").innerHTML = khung === N() ? veKetLuan() : "";
    const nut_kia = $("#xd-sang-kia");
    if (nut_kia) nut_kia.addEventListener("click", () => chon(ma, kq.loai === "sai" ? "dung" : "sai"));

    $("#xd-lop").innerHTML = "";
    if (che_do_xem === "mysql") { veManHinhMysql(e, hoat_hinh); return; }

    $("#xd-san-khau").className = "san-khau-lich " + (kq.loai === "sai" ? "kb-la-sai" : "kb-la-dung");
    $("#xd-lich-gt").innerHTML = veLichGiaoTac(e);
    $("#xd-csdl").innerHTML = veCsdl(e);
    ganChuThich("#xd-san-khau");
    $$("#xd-lich-gt .lgt-dong[data-k]").forEach(d => d.addEventListener("click", () => { dungPhat(); toi(+d.dataset.k); }));

    // giữ dòng đang xem trong tầm nhìn khi bảng dài hơn màn hình
    const dong_hien = $("#xd-lich-gt .lgt-dong.hien");
    if (dong_hien && hoat_hinh) {
      const r = dong_hien.getBoundingClientRect();
      if (r.bottom > innerHeight - 20 || r.top < 150) dong_hien.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    if (hoat_hinh && e) setTimeout(() => hoatHinh(e), 30);
    else veVienCho();
  }

  /** Rê chuột lên các phần tử có data-tip trong vùng goc để xem giải thích. */
  function ganChuThich(goc) {
    $$(`${goc} [data-tip]`).forEach(el => {
      el.addEventListener("mousemove", ev => hienHop(ev, esc(el.dataset.tip).replace(/\n/g, "<br>")));
      el.addEventListener("mouseleave", anHop);
    });
  }

  /* ------------------------------------------------------------ lời dẫn & giải thích */
  function tomTatKetQua(e) {
    const r = e.ket_qua;
    if (!r) return "";
    if (r.loi) return `✗ MySQL trả lỗi ${r.loi.ma}`;
    const lenh = lenhCua(e.sql);
    if (r.dong && r.dong.length) {
      const cot = Object.keys(r.dong[0]);
      if (r.dong.length === 1 && cot.length === 1) return `${cot[0]} = ${r.dong[0][cot[0]]}`;
      return `${r.dong.length} dòng`;
    }
    if (lenh === "SELECT") return "không có dòng nào";
    if (lenh === "UPDATE" && r.so_dong_khop != null) return `Rows matched: ${r.so_dong_khop}, Changed: ${r.so_dong_doi}`;
    if (lenh === "INSERT") return `chèn ${r.so_dong} dòng`;
    if (lenh === "COMMIT") return "ghi nhận vĩnh viễn, nhả mọi khóa";
    if (lenh === "ROLLBACK") return "hủy mọi thay đổi, nhả mọi khóa";
    if (lenh === "START") return "giao tác bắt đầu";
    return "OK";
  }

  function loiDan(e) {
    if (!e) return `<span class="phu-ld">t0 · Trạng thái ban đầu – chưa phiên nào chạy. Bấm ▶ Phát hoạt hình, hoặc dùng phím ← → để đi từng bước.</span>`;
    const tien_to = { bi_chan: "⏳ BỊ CHẶN · ", xong_sau_chan: "▶ ĐƯỢC CHẠY TIẾP · ", hoan: "⏸ HOÃN · ",
                      bo_qua: "BỎ QUA · " }[e.loai]
      || (e.ket_qua?.loi?.ten === "deadlock" ? "✗ DEADLOCK · " : e.ket_qua?.loi ? "✗ LỖI · " : "");
    let phu = "";
    if (e.loai === "bi_chan") phu = "câu lệnh chưa trả về – đang chờ khóa";
    else if (e.ket_qua?.loi) phu = `${e.ket_qua.loi.ma}: ${e.ket_qua.loi.thong_diep}`;
    else if (e.loai === "xong_sau_chan") phu = `sau ${so(e.ket_qua.thoi_gian_ms)} ms chờ khóa → ${tomTatKetQua(e)}`;
    else if (e.loai !== "hoan") phu = "→ " + tomTatKetQua(e);
    return `<span class="moc-t-ld">t${e.thu_tu}</span><span class="nhan-p ${e.phien}">Phiên ${e.phien}</span>
      <b>${esc(tien_to + e.mo_ta)}</b>${e.ky_hieu ? `<code class="kh-ld">${esc(e.ky_hieu)}</code>` : ""}
      <span class="phu-ld">${esc(phu)}</span>`;
  }

  function dongChuyen(tt, goc) {
    const t = tt && tt.chuyen_bay;
    return t ? t[goc].find(d => d.ma_chuyen === 1) : null;
  }

  /** Giải thích bằng lời thường: bước này có ý nghĩa gì. */
  function giaiThich(e) {
    if (!e) {
      return "Hai phiên A và B là hai kết nối riêng tới cùng một CSDL – như nhân viên ở quầy vé và khách dùng app "
        + "cùng lúc thao tác trên chuyến VN-808. Mỗi phiên sẽ mở một giao tác và chạy lần lượt các câu SQL bên dưới.";
    }
    const P = e.phien, Q = kia(P);
    const lenh = lenhCua(e.sql);
    const r = e.ket_qua || {};
    const kq_ngan = tomTatKetQua(e);
    if (e.ma.startsWith("K")) return `Đây là bước kiểm tra sau khi cả hai giao tác đã kết thúc: ${esc(kq_ngan)}. So con số này với kỳ vọng để biết dữ liệu có đúng không.`;
    if (e.loai === "hoan") {
      return `${P} vẫn đang kẹt ở câu lệnh trước nên <b>chưa gửi được</b> câu này. Một kết nối chỉ chạy một câu lệnh mỗi lúc – câu sau phải đợi câu trước trả về.`;
    }
    if (e.loai === "bi_chan") {
      const ai = (e.cho || []).filter(c => c.phien_cho === P).map(c => c.phien_giu);
      const viec = lenh === "INSERT" ? "chèn dòng mới vào vùng dữ liệu" : lenh === "SELECT" ? "đọc và khóa dữ liệu" : "sửa dữ liệu";
      return `${P} muốn ${viec}, nhưng <b>${ai.length ? "phiên " + ai.join(", ") : "phiên kia"} đang giữ khóa</b> trên đúng chỗ đó. `
        + `InnoDB bắt ${P} đứng chờ – còn ${Q} vẫn chạy tiếp bình thường. Đây chính là cách CSDL "xếp hàng" các giao tác để chúng không giẫm lên nhau.`;
    }
    if (r.loi?.ten === "deadlock") {
      return `${P} cần khóa mà ${Q} đang giữ, trong khi ${Q} lại đang chờ khóa của ${P} → hai bên chờ nhau mãi mãi (<b>deadlock</b>). `
        + `InnoDB phát hiện ngay và chọn ${P} làm "nạn nhân": hủy toàn bộ giao tác của ${P} (lỗi 1213), nhả khóa để ${Q} đi tiếp. Ứng dụng của ${P} phải tự chạy lại.`;
    }
    if (e.loai === "xong_sau_chan") {
      return `${Q} vừa kết thúc và nhả khóa, nên InnoDB cho ${P} chạy tiếp sau ${so(r.thoi_gian_ms)} ms chờ. `
        + `Vì phải đợi, ${P} làm việc trên dữ liệu <b>mới nhất</b>: ${esc(kq_ngan)}.`;
    }
    if (lenh === "START") {
      return `${P} mở giao tác. Từ giờ mọi thay đổi của ${P} chỉ là <b>bản nháp</b> cho tới khi COMMIT; phiên khác có thấy bản nháp đó hay không là do <b>mức cô lập</b> quyết định.`;
    }
    if (lenh === "SELECT") {
      let s = `${P} đọc được <b>${esc(kq_ngan)}</b>.`;
      const c = dongChuyen(e.trang_thai, "da_commit"), m = dongChuyen(e.trang_thai, "moi_nhat");
      const doc = r.dong && r.dong.length === 1 ? r.dong[0].so_ghe_trong : undefined;
      if (doc !== undefined && c && m) {
        if (m.so_ghe_trong !== c.so_ghe_trong && doc === m.so_ghe_trong) {
          s += ` ⚠ Đây là con số <b>chưa commit</b> trong bản nháp của ${Q} – ${P} đang đọc phải dữ liệu có thể bị hủy bỏ (đọc dữ liệu rác).`;
        } else if (m.so_ghe_trong !== c.so_ghe_trong && doc === c.so_ghe_trong) {
          s += ` InnoDB đưa cho ${P} bản <b>đã commit</b> (dựng lại từ undo log), không đưa bản nháp của ${Q} – đó là MVCC.`;
        } else if (doc !== c.so_ghe_trong) {
          s += ` Dù dữ liệu đã commit giờ là ${c.so_ghe_trong}, ${P} vẫn thấy ${doc}: ${P} đọc trên <b>snapshot</b> chụp từ lần đọc đầu tiên của giao tác (MVCC).`;
        }
      }
      if (/FOR UPDATE/i.test(e.sql)) s += ` <b>FOR UPDATE</b> còn đặt khóa ghi lên dữ liệu vừa đọc: ai muốn khóa hoặc sửa nó phải chờ ${P} kết thúc.`;
      return s;
    }
    if (lenh === "UPDATE") {
      let s = `${P} ghi giá trị mới vào InnoDB nhưng <b>chưa commit</b> – đây mới là bản nháp. ${P} giữ khóa X trên dòng đó tới khi kết thúc giao tác.`;
      if (r.so_dong_khop === 0) s = `Câu UPDATE của ${P} không khớp dòng nào (Rows matched: 0) vì điều kiện WHERE không còn đúng – dữ liệu đã bị phiên khác đổi trước.`;
      else if (r.so_dong_khop > r.so_dong_doi) s += ` Lưu ý: MySQL báo <b>Changed: 0</b> vì giá trị mới trùng giá trị đang có – ứng dụng không nhận được tín hiệu nào là vừa ghi đè lên việc của phiên khác.`;
      return s;
    }
    if (lenh === "INSERT") return `${P} chèn một dòng mới. Dòng này chưa commit nên mới chỉ là bản nháp của ${P}.`;
    if (lenh === "COMMIT") {
      const da_huy = kq.nhat_ky.slice(0, khung - 1).some(x => x.phien === P && x.ket_qua?.loi?.ten === "deadlock");
      if (da_huy) return `Giao tác của ${P} đã bị InnoDB hủy từ trước, nên COMMIT này không còn gì để ghi.`;
      let s = `${P} commit: các thay đổi trở thành <b>chính thức</b> và mọi phiên khác đều thấy được; mọi khóa ${P} đang giữ được nhả ra.`;
      const q_dang_cho = Object.values(suKienTheoBuoc(Q)).some(x => x.loai === "bi_chan");
      if (q_dang_cho) {
        s += ` Khóa vừa nhả được InnoDB <b>trao ngay cho ${Q}</b> đang xếp hàng – nhìn bảng CSDL bên phải: khóa giờ đã thuộc về ${Q}. Ở bước kế tiếp, câu lệnh đang chờ của ${Q} sẽ trả kết quả về.`;
      }
      return s;
    }
    if (lenh === "ROLLBACK") return `${P} hủy giao tác: mọi thay đổi nháp bị xóa bỏ, dữ liệu trở về như trước, khóa được nhả. Ai đã lỡ đọc bản nháp đó thì đã đọc phải "dữ liệu rác".`;
    return esc(kq_ngan);
  }

  /* ------------------------------------------------------------ ký hiệu lịch */
  function veKyHieu() {
    const dt = Object.entries(kq.doi_tuong || {}).map(([k, v]) => `<span><b>${esc(k)}</b> = ${esc(v)}</span>`).join("");
    const chips = kq.lich.map(l => {
      const lop = l.thu_tu < khung ? "da" : l.thu_tu === khung ? "hien" : "chua";
      return `<span class="kh-chip ${l.phien} ${lop} ${l.loai === "bi_chan" ? "cho" : ""}" data-k="${l.thu_tu}"
        title="Bước t${l.thu_tu} – bấm để tới">${esc(l.ky_hieu)}${l.loai === "bi_chan" ? " ⏳" : ""}</span>`;
    }).join("");
    return `<div class="kh-dau"><b>Lịch thực thi</b> <span>– viết bằng ký hiệu của giáo trình, theo đúng thứ tự MySQL đã thực hiện</span></div>
      <div class="kh-chuoi">${chips}</div>
      <div class="kh-chu-giai"><span><b>r</b> đọc · <b>w</b> ghi · <b>xl</b> xin khóa ghi · <b>c</b> commit · <b>a</b> hủy (abort)</span>
        <span>chỉ số <b class="A">₁</b> = phiên A (T₁), <b class="B">₂</b> = phiên B (T₂)</span>${dt}</div>`;
  }

  /* ------------------------------------------------------------ lịch giao tác 2 cột */
  /** Trạng thái thanh dọc của mỗi phiên tại từng hàng: "" | "mo" | "cho" (+ "bd" / "kt"). */
  function tinhSong() {
    const ket = [];
    const st = { A: "chua", B: "chua" };
    kq.nhat_ky.forEach(e => {
      const hang = {};
      for (const p of ["A", "B"]) {
        let lop = st[p] === "mo" ? "mo" : st[p] === "cho" ? "cho" : "";
        if (p === e.phien && !e.ma.startsWith("K")) {
          const lenh = lenhCua(e.sql);
          if (lenh === "START" && e.loai !== "hoan") { st[p] = "mo"; lop = "mo bd"; }
          else if (e.loai === "bi_chan") { st[p] = "cho"; lop = "cho"; }
          else if (e.ket_qua?.loi?.ten === "deadlock") { st[p] = "huy"; lop = "mo kt huy"; }
          else if (e.loai === "xong_sau_chan" && ["COMMIT", "ROLLBACK"].includes(lenh)) { st[p] = "dong"; lop = "mo kt"; }
          else if (e.loai === "xong_sau_chan") { st[p] = "mo"; lop = "mo"; }
          else if (e.loai === "xong" && ["COMMIT", "ROLLBACK"].includes(lenh)) {
            lop = st[p] === "mo" ? "mo kt" : ""; st[p] = "dong";
          }
        }
        hang[p] = lop;
      }
      ket.push(hang);
    });
    return ket;
  }

  function suKienTheoBuoc(p) {
    const m = {};
    for (let j = 0; j < khung; j++) {
      const e = kq.nhat_ky[j];
      if (e.phien === p) m[e.ma] = e;
    }
    return m;
  }

  function trangThaiPhien(p) {
    const ds = Object.values(suKienTheoBuoc(p));
    if (ds.some(e => e.loai === "bi_chan")) return ["chan", "⏳ đang chờ khóa"];
    if (!ds.length) return ["", "chưa bắt đầu"];
    let cuoi = null;
    for (let j = 0; j < khung; j++) if (kq.nhat_ky[j].phien === p) cuoi = kq.nhat_ky[j];
    const bi_huy = ds.some(e => e.ket_qua?.loi?.ten === "deadlock");
    const lenh = lenhCua(cuoi.sql);
    if (cuoi.ma.startsWith("K")) return ["xong", "✓ đọc kiểm tra"];
    if (bi_huy) return ["huy", "✗ bị InnoDB hủy"];
    if (lenh === "COMMIT") return ["xong", "✓ đã commit"];
    if (lenh === "ROLLBACK") return ["rb", "↩ đã rollback"];
    return ["mo", "● giao tác đang mở"];
  }

  function nguonCua(e) {
    return (kq.ma_nguon[e.phien] || []).find(d => d.ma === e.ma);
  }

  function ketQuaDong(e) {
    const r = e.ket_qua;
    if (!r) return "";
    let html = "";
    if (e.loai === "xong_sau_chan") {
      html += `<div class="kq-dong tiep">▶ được InnoDB cho chạy tiếp sau ${so(r.thoi_gian_ms)} ms chờ khóa</div>`;
    }
    if (r.loi) {
      return html + `<div class="kq-dong loi-kq">✗ Lỗi ${r.loi.ma}${r.loi.ten === "deadlock" ? " (deadlock)" : ""}: ${esc(r.loi.thong_diep)}</div>`;
    }
    const lenh = lenhCua(e.sql);
    if (r.dong && r.dong.length) {
      const cot = Object.keys(r.dong[0]);
      if (r.dong.length === 1 && cot.length === 1) {
        return html + `<div class="kq-dong">→ <span class="gt-lon">${esc(cot[0])} = ${esc(r.dong[0][cot[0]])}</span></div>`;
      }
      return html + `<div class="kq-dong">→ ${r.dong.length} dòng<table><tr>${cot.map(c => `<th>${esc(c)}</th>`).join("")}</tr>
        ${r.dong.map(d => `<tr>${cot.map(c => `<td>${esc(d[c] ?? "NULL")}</td>`).join("")}</tr>`).join("")}</table></div>`;
    }
    if (lenh === "SELECT") return html + `<div class="kq-dong mo-kq">→ (không có dòng nào)</div>`;
    if (lenh === "UPDATE" && r.so_dong_khop != null) {
      const la = r.so_dong_khop !== r.so_dong_doi || r.so_dong_khop === 0;
      const vi_sao = r.so_dong_khop === 0 ? " – điều kiện WHERE không còn đúng"
        : r.so_dong_khop > r.so_dong_doi ? " – giá trị mới trùng giá trị cũ" : "";
      return html + `<div class="kq-dong ${la ? "canh-bao" : ""}">→ Rows matched: <b>${r.so_dong_khop}</b>,
        Changed: <b>${r.so_dong_doi}</b>${vi_sao}</div>`;
    }
    return html + `<div class="kq-dong mo-kq">→ ${esc(tomTatKetQua(e))}</div>`;
  }

  function oLich(e, da_toi) {
    const d = nguonCua(e);
    let nhan = "";
    if (da_toi) {
      if (e.loai === "bi_chan") nhan += `<span class="the-tt chan">⏳ BỊ CHẶN</span>`;
      else if (e.loai === "xong_sau_chan") nhan += `<span class="the-tt tiep">▶ CHẠY TIẾP</span>`;
      else if (e.loai === "hoan") nhan += `<span class="the-tt hoan">⏸ HOÃN</span>`;
      else if (e.ket_qua?.loi) nhan += `<span class="the-tt loi">✗ LỖI ${e.ket_qua.loi.ma}</span>`;
      if (e.chay_bu && e.loai !== "hoan") nhan += `<span class="the-tt bu">CHẠY BÙ</span>`;
    }
    if (e.ma.startsWith("K")) nhan += `<span class="the-tt kt">KIỂM TRA</span>`;
    if (d?.diem_khac) nhan += `<span class="diem-khac">${kq.loai === "sai" ? "← nguyên nhân" : "← cách sửa"}</span>`;
    const kh = da_toi && e.ky_hieu ? `<code class="kh">${esc(e.ky_hieu)}</code>` : "";
    const sql = e.loai === "hoan" ? (d?.sql || e.sql) : e.sql;
    let ket_qua = "";
    if (da_toi) {
      if (e.loai === "bi_chan") {
        const ai = (e.cho || []).filter(c => c.phien_cho === e.phien).map(c => c.phien_giu);
        ket_qua = `<div class="kq-dong chan-kq">⏳ chưa trả về – đang chờ khóa${ai.length ? ` do phiên ${ai.join(", ")} giữ` : ""}</div>`;
      } else if (e.loai === "hoan") {
        ket_qua = `<div class="kq-dong mo-kq">⏸ chưa gửi được – phiên đang kẹt ở câu lệnh trước</div>`;
      } else {
        ket_qua = ketQuaDong(e);
      }
    }
    return `<div class="o-dau"><span class="ma-buoc">${esc(e.ma)}</span>${kh}${nhan}</div>
      <div class="mo-ta">${esc(e.mo_ta)}</div>
      <div class="sql">${toMauSql(sql)};</div>${ket_qua}`;
  }

  function veLichGiaoTac(e_hien) {
    const song = tinhSong();
    const noi_bat = khung === N() ? new Set(kq.noi_bat) : new Set();
    const dau_cot = p => {
      const [lop_tt, chu_tt] = trangThaiPhien(p);
      return `<div class="lgt-cot ${p}"><div><b>${p === "A" ? "T₁" : "T₂"} · Phiên ${p}</b><span>${TEN_PHIEN[p]}</span></div>
        <span class="tt-phien ${lop_tt}">${chu_tt}</span></div>`;
    };
    const cau_hinh = p => {
      const d = kq.ma_nguon[p][0];
      return `<div class="o-dau"><span class="ma-buoc">⚙</span>${d.diem_khac
        ? `<span class="diem-khac">${kq.loai === "sai" ? "← nguyên nhân" : "← cách sửa"}</span>` : ""}</div>
        <div class="mo-ta">${esc(d.mo_ta)}</div><div class="sql">${toMauSql(d.sql)};</div>`;
    };
    let html = `<div class="lgt-dau"><div class="lgt-t">Thời điểm</div>${dau_cot("A")}${dau_cot("B")}</div>
      <div class="lgt-dong cau-hinh"><div class="lgt-t">t0</div>
        <div class="lgt-o A">${cau_hinh("A")}</div><div class="lgt-o B">${cau_hinh("B")}</div></div>`;
    kq.nhat_ky.forEach((e, i) => {
      const da_toi = i < khung;
      const hien = e_hien && i === khung - 1;
      const lop_o = p => {
        if (!da_toi) return "";
        return "song-" + song[i][p].split(" ").filter(Boolean).join(" song-");
      };
      const o = p => {
        const cua_minh = e.phien === p;
        const lop = [p, cua_minh ? "co" : "", lop_o(p),
                     cua_minh && noi_bat.has(e.ma) && ["xong", "xong_sau_chan"].includes(e.loai) ? "noi-bat" : ""].join(" ");
        return `<div class="lgt-o ${lop}">${cua_minh ? oLich(e, da_toi) : ""}</div>`;
      };
      html += `<div class="lgt-dong ${da_toi ? "" : "chua"} ${hien ? "hien" : ""} ${e.loai}" data-k="${i + 1}">
        <div class="lgt-t">t${i + 1}</div>${o("A")}${o("B")}</div>`;
    });
    return html;
  }

  /* ------------------------------------------------------------ cơ sở dữ liệu */
  const trangThaiKhung = k => (k > 0 ? kq.nhat_ky[k - 1].trang_thai : kq.trang_thai_dau);

  function nhanKhoa(che_do) {
    const phan = che_do.split(",");          // ví dụ "X,REC_NOT_GAP" -> ["X", "REC_NOT_GAP"]
    if (phan.includes("INSERT_INTENTION")) return "xin chèn";
    if (phan.includes("REC_NOT_GAP")) return phan[0];      // khóa đúng một dòng
    if (phan.includes("GAP")) return phan[0] + " gap";     // chỉ khóa khoảng trống
    return phan[0] + "+gap";                               // next-key: dòng + khoảng trống trước nó
  }

  function veChip(ds) {
    if (!ds || !ds.length) return "";
    const nhom = {};
    for (const k of ds) (nhom[`${k.phien}|${k.trang_thai}`] ||= []).push(k);
    return Object.values(nhom).map(g => {
      const p = g[0].phien;
      const cho = g[0].trang_thai === "WAITING";
      const nhan = [...new Set(g.map(k => nhanKhoa(k.che_do_khoa)))].join(" · ");
      const tip = `Phiên ${p} ${cho ? "ĐANG CHỜ" : "đang giữ"}:\n` + g.map(k =>
        `• ${k.che_do_khoa} trên chỉ mục ${k.chi_muc} (${k.du_lieu}) – ${yNghiaKhoa(k.loai_khoa, k.che_do_khoa)}`).join("\n");
      return `<span class="chip ${p} ${cho ? "cho" : ""}" data-tip="${esc(tip)}">${cho ? "⏳" : "🔒"} ${p} ${esc(nhan)}</span>`;
    }).join("");
  }

  function khoaChinhCuaKhoa(k) {
    const dl = String(k.du_lieu ?? "");
    if (dl.includes("supremum")) return "∞";
    return dl.split(", ").pop().replace(/^'(.*)'$/, "$1");
  }

  function veBangDb(ten, t, t_truoc, khoa) {
    if (!t) return "";
    const pk = t.khoa_chinh;
    const commit = new Map(t.da_commit.map(d => [String(d[pk]), d]));
    const truoc = t_truoc ? new Map(t_truoc.moi_nhat.map(d => [String(d[pk]), d])) : null;
    const cot = Object.keys(t.moi_nhat[0] || t.da_commit[0] || {});
    const khoa_dong = {};
    for (const k of khoa) {
      if (k.loai_khoa !== "RECORD" || k.bang !== ten) continue;
      (khoa_dong[khoaChinhCuaKhoa(k)] ||= []).push(k);
    }
    const dang_chen = khoa.find(k => k.bang === ten && k.trang_thai === "WAITING" && k.che_do_khoa.includes("INSERT_INTENTION"));

    let html = `<div class="bang-db"><div class="ten-bang">${esc(ten)}</div><table><tr>
      ${cot.map(c => `<th>${esc(c)}</th>`).join("")}<th>Khóa</th></tr>`;
    for (const d of t.moi_nhat) {
      const key = String(d[pk]);
      const c = commit.get(key);
      const moi = !c;
      const co_khoa = !!khoa_dong[key];
      html += `<tr class="${moi ? "dong-moi" : ""} ${co_khoa ? "co-khoa" : ""}">` + cot.map((col, i) => {
        const v = d[col];
        const doi = truoc && (!truoc.get(key) || truoc.get(key)[col] !== v);
        let o;
        if (c && c[col] !== v) {
          o = `<span class="gt-cu" title="giá trị đã commit">${esc(c[col] ?? "NULL")}</span><span class="gt-moi">${esc(v ?? "NULL")}</span>`;
        } else {
          o = esc(v ?? "NULL");
        }
        if (i === 0 && moi) {
          const tip = dang_chen
            ? `Phiên ${dang_chen.phien} đang chèn dở dòng này: InnoDB đã ghi nó vào chỉ mục chính (PRIMARY), nhưng còn kẹt ở chỉ mục ${dang_chen.chi_muc} vì phải chờ gap lock. Đọc ở READ UNCOMMITTED đã thấy được dòng này.`
            : "Dòng mới chèn, chưa commit. InnoDB không tạo khóa tường minh cho dòng mới chèn (khóa ngầm – implicit lock): mã giao tác được ghi ngay trong dòng, nên data_locks không liệt kê.";
          o += `<span class="the-cc" data-tip="${esc(tip)}">${dang_chen ? `${esc(dang_chen.phien)} đang chèn dở` : "chưa commit"}</span>`;
        } else if (i === 0 && c && cot.some(cc => c[cc] !== d[cc])) {
          o += `<span class="the-cc" data-tip="Dòng đã bị sửa nhưng chưa commit. Giá trị gạch ngang là bản đã commit – thứ các giao tác khác thấy ở READ COMMITTED trở lên; giá trị tô vàng là bản nháp mới nhất trong InnoDB.">chưa commit</span>`;
        }
        return `<td class="${doi ? "vua-doi" : ""}">${o}</td>`;
      }).join("") + `<td>${veChip(khoa_dong[key])}</td></tr>`;
    }
    for (const [key, c] of commit) {
      if (!t.moi_nhat.some(d => String(d[pk]) === key)) {
        html += `<tr>${cot.map(col => `<td><s>${esc(c[col] ?? "NULL")}</s></td>`).join("")}<td><span class="the-cc">đã xóa, chưa commit</span></td></tr>`;
      }
    }
    if (khoa_dong["∞"]) {
      html += `<tr><td colspan="${cot.length}" style="color:var(--mo)">∞ – khoảng trống sau dòng cuối cùng</td><td>${veChip(khoa_dong["∞"])}</td></tr>`;
    }
    return html + `</table></div>`;
  }

  function veCsdl(e) {
    const tt = trangThaiKhung(khung);
    const tt_truoc = khung > 0 ? trangThaiKhung(khung - 1) : null;
    const khoa = e ? (e.khoa || []) : [];
    const cho = e ? (e.cho || []) : [];
    const so_khoa = khoa.filter(k => k.loai_khoa === "RECORD").length;
    let html = `<div class="dau-p"><b>🗄️ CSDL Trung Tâm SkyRoute – MySQL 9.6 InnoDB Engine</b>
      <span class="tt-phien ${so_khoa ? "mo" : ""}">${so_khoa ? `${so_khoa} khóa dòng` : "không có khóa"}</span></div>
      <div class="than"><div class="csdl-moc">Dữ liệu tại thời điểm <b>t${khung}</b></div>`;
    for (const ten of kq.bang) html += veBangDb(ten, tt[ten], tt_truoc ? tt_truoc[ten] : null, khoa);
    html += cho.length
      ? cho.map(c => `<div class="hang-doi">⏳ <span><b>Phiên ${esc(c.phien_cho)}</b> đang chờ khóa do <b>phiên ${esc(c.phien_giu)}</b> giữ</span></div>`).join("")
      : `<div class="hang-doi trong">Không có phiên nào phải chờ khóa</div>`;
    html += `<div class="chu-thich-db">
      <span><span class="gt-cu">7</span><span class="gt-moi">0</span> đã commit → bản nháp</span>
      <span><span class="chip A">🔒 A X</span> đang giữ khóa</span>
      <span><span class="chip B cho" style="animation:none">⏳ B X</span> đang chờ</span></div>`;
    return html + `</div>`;
  }

  /* ------------------------------------------------------------ màn hình MySQL
   * Mỗi phiên là một cửa sổ dòng lệnh `mysql>`: câu SQL được gõ vào, rồi kết quả MySQL trả về hiện ra
   * đúng định dạng của mysql client. Bên dưới là "màn hình dưới CSDL": nội dung bảng và data_locks
   * ngay sau bước đang xem (ảnh chụp thật từ InnoDB). */
  const dai = s => [...String(s)].length;
  const chuO = v => (v === null || v === undefined ? "NULL" : String(v));
  const laSo = v => typeof v === "number";
  const giay = ms => `(${(Math.max(0, ms || 0) / 1000).toFixed(2)} sec)`;
  const SQLSTATE = { 1205: "HY000", 1213: "40001", 1062: "23000", 1064: "42000", 1146: "42S02", 1054: "42S22", 3024: "HY000" };
  const soDong = n => `${n} row${n === 1 ? "" : "s"}`;
  const loiMysql = l => `<span class="t-loi">ERROR ${esc(l.ma)} (${SQLSTATE[l.ma] || "HY000"}): ${esc(l.thong_diep)}</span>`;

  /** Bảng kết quả kiểu mysql client.  hang: [{o: [{t, so, lop}], lop, duoi}] – `duoi` là ghi chú sau dòng. */
  function bangAscii(cot, hang) {
    const w = cot.map((c, i) => Math.max(dai(c), ...hang.map(h => dai(h.o[i].t))));
    const ke = "+" + w.map(x => "-".repeat(x + 2)).join("+") + "+";
    const dau = "|" + cot.map((c, i) => ` ${esc(c)}${" ".repeat(w[i] - dai(c))} `).join("|") + "|";
    const than = hang.map(h => {
      const o = h.o.map((x, i) => {
        const dem = " ".repeat(w[i] - dai(x.t));
        const noi = x.so ? dem + esc(x.t) : esc(x.t) + dem;
        return " " + (x.lop ? `<span class="${x.lop}">${noi}</span>` : noi) + " ";
      }).join("|");
      return `<span class="${h.lop || ""}">|${o}|</span>${h.duoi || ""}`;
    });
    return `<span class="t-bang">${[ke, dau, ke, ...than, ke].join("\n")}</span>`;
  }

  const bangTuDong = (cot, dong) => bangAscii(cot, dong.map(d => ({ o: cot.map(c => ({ t: chuO(d[c]), so: laSo(d[c]) })) })));

  /** Kết quả mysql client in ra cho một câu lệnh đã chạy xong. */
  function ketQuaMysql(e) {
    const r = e.ket_qua || {};
    if (r.loi) return loiMysql(r.loi);
    const lenh = lenhCua(e.sql);
    if (["SELECT", "SHOW", "WITH"].includes(lenh)) {
      const ds = r.dong || [];
      if (!ds.length) return `Empty set ${giay(r.thoi_gian_ms)}`;
      return `${bangTuDong(Object.keys(ds[0]), ds)}\n${soDong(ds.length)} in set ${giay(r.thoi_gian_ms)}`;
    }
    if (lenh === "UPDATE" || lenh === "DELETE") {
      const n = r.so_dong_doi ?? r.so_dong ?? 0;
      let s = `Query OK, ${soDong(n)} affected ${giay(r.thoi_gian_ms)}`;
      if (lenh === "UPDATE" && r.so_dong_khop != null) {
        const la = r.so_dong_khop !== r.so_dong_doi || r.so_dong_khop === 0;
        s += `\n<span class="${la ? "t-canh" : ""}">Rows matched: ${r.so_dong_khop}  Changed: ${r.so_dong_doi}  Warnings: 0</span>`;
      }
      return s;
    }
    if (lenh === "INSERT") return `Query OK, ${soDong(r.so_dong ?? 1)} affected ${giay(r.thoi_gian_ms)}`;
    return `Query OK, 0 rows affected ${giay(r.thoi_gian_ms)}`;
  }

  function dauTerm(tieu_de, phu, lop_tt, chu_tt) {
    return `<div class="term-dau"><span class="cham-mau"><i></i><i></i><i></i></span><b>${tieu_de}</b>
      <span class="term-phu">${phu}</span><span style="flex:1"></span>${chu_tt ? `<span class="tt-phien ${lop_tt}">${chu_tt}</span>` : ""}</div>`;
  }

  const nhanDiem = () => `<span class="t-diem ${kq.loai}">${kq.loai === "sai" ? "← nguyên nhân" : "← cách sửa"}</span>`;

  /** Một câu lệnh trong cửa sổ của phiên p.  ds_e: các sự kiện cùng mã bước (bị chặn → chạy tiếp…). */
  function khoiLenh(p, ma_b, ds_e, e_hien) {
    const cuoi = ds_e[ds_e.length - 1];
    const d = (kq.ma_nguon[p] || []).find(x => x.ma === ma_b);
    const hien = e_hien && ds_e.includes(e_hien);
    const sql = cuoi.loai === "hoan" ? (d?.sql || cuoi.sql) : cuoi.sql;
    const the = (cuoi.ky_hieu ? `<span class="t-kh">${esc(cuoi.ky_hieu)}</span>` : "") + (d?.diem_khac ? nhanDiem() : "");
    let html = `<div class="khoi ${hien ? "hien" : ""} ${cuoi.loai}" data-k="${cuoi.thu_tu}">
      <div class="t-chu-thich">-- t${ds_e[0].thu_tu} · ${esc(cuoi.mo_ta)}</div>`;
    if (cuoi.loai === "hoan") {
      return html + `<div class="t-lenh t-hoan"><span class="t-nhac">  ⏸  </span><span class="t-sql">${toMauSql(sql)};</span></div>
        <div class="t-ra t-mo">   xếp hàng – kết nối còn bận chờ câu lệnh phía trên trả về, chưa gửi được</div></div>`;
    }
    html += `<div class="t-lenh"><span class="t-nhac">mysql&gt;</span> <span class="t-sql" data-sql="${esc(sql + ";")}">${toMauSql(sql)};</span>${the}</div>`;
    if (cuoi.loai === "bi_chan") {
      const ai = (cuoi.cho || []).filter(c => c.phien_cho === p).map(c => c.phien_giu);
      html += `<div class="t-ra t-cho"><span class="t-xoay"></span>đang chờ khóa${ai.length ? ` do phiên ${ai.join(", ")} giữ` : ""}… (câu lệnh chưa trả về)</div>`;
    } else if (cuoi.loai === "bo_qua") {
      html += `<div class="t-ra t-mo">-- bỏ qua</div>`;
    } else {
      const tiep = cuoi.loai === "xong_sau_chan"
        ? `<span class="t-tiep">▶ hết chờ sau ${so(cuoi.ket_qua?.thoi_gian_ms)} ms – phiên ${kia(p)} đã nhả khóa</span>\n` : "";
      html += `<div class="t-ra">${tiep}${ketQuaMysql(cuoi)}</div>`;
    }
    return html + `</div>`;
  }

  function veTerm(p, e_hien) {
    const ch = (kq.ma_nguon[p] || []).find(d => d.la_cau_hinh);
    const thu_tu = [], nhom = {};
    for (let j = 0; j < khung; j++) {
      const e = kq.nhat_ky[j];
      if (e.phien !== p) continue;
      if (!nhom[e.ma]) { nhom[e.ma] = []; thu_tu.push(e.ma); }
      nhom[e.ma].push(e);
    }
    const [lop_tt, chu_tt] = trangThaiPhien(p);
    const dang_chan = Object.values(nhom).some(ds => ds[ds.length - 1].loai === "bi_chan");
    let than = `<div class="t-mo">Đã kết nối MySQL 9.6 · CSDL demo_dongthoi · kết nối riêng của phiên ${p}</div>`;
    if (ch) {
      than += `<div class="khoi cau-hinh"><div class="t-chu-thich">-- t0 · ${esc(ch.mo_ta)}</div>
        <div class="t-lenh"><span class="t-nhac">mysql&gt;</span> <span class="t-sql">${toMauSql(ch.sql)};</span>${ch.diem_khac ? nhanDiem() : ""}</div>
        <div class="t-ra">Query OK, 0 rows affected (0.00 sec)</div></div>`;
    }
    let da_kiem_tra = false;
    for (const m of thu_tu) {
      if (m.startsWith("K") && !da_kiem_tra) {
        da_kiem_tra = true;
        than += `<div class="t-chu-thich t-kiem-tra">-- ===== cả hai giao tác đã kết thúc – đọc lại để kiểm tra =====</div>`;
      }
      than += khoiLenh(p, m, nhom[m], e_hien);
    }
    if (!dang_chan) than += `<div class="t-lenh t-cho-go"><span class="t-nhac">mysql&gt;</span> <span class="con-tro"></span></div>`;
    return dauTerm(`Phiên ${p} · ${TEN_PHIEN[p]}`, `${p === "A" ? "T₁" : "T₂"} · mysql -u root demo_dongthoi`, lop_tt, chu_tt)
      + `<div class="term-than">${than}</div>`;
  }

  /** Một bảng dưới CSDL: bản mới nhất trong InnoDB, ô có bản nháp hiện "đã commit→nháp". */
  function bangDuoiCsdl(ten, t, t_truoc, khoa) {
    if (!t) return "";
    const pk = t.khoa_chinh;
    const commit = new Map(t.da_commit.map(d => [String(d[pk]), d]));
    const truoc = t_truoc ? new Map(t_truoc.moi_nhat.map(d => [String(d[pk]), d])) : null;
    const cot = Object.keys(t.moi_nhat[0] || t.da_commit[0] || {});
    if (!cot.length) return "Empty set (0.00 sec)";
    const khoa_dong = {};
    for (const k of khoa) {
      if (k.loai_khoa === "RECORD" && k.bang === ten) (khoa_dong[khoaChinhCuaKhoa(k)] ||= []).push(k);
    }
    const dang_chen = khoa.find(k => k.bang === ten && k.trang_thai === "WAITING" && k.che_do_khoa.includes("INSERT_INTENTION"));
    const hang = [];
    for (const d of t.moi_nhat) {
      const key = String(d[pk]);
      const c = commit.get(key);
      const o = cot.map(col => {
        const v = d[col];
        const nhap = c && c[col] !== v;
        const doi = truoc && (!truoc.get(key) || truoc.get(key)[col] !== v);
        return { t: nhap ? `${chuO(c[col])}→${chuO(v)}` : chuO(v), so: laSo(v),
                 lop: [nhap || !c ? "t-nhap" : "", doi ? "t-vua-doi" : ""].join(" ").trim() };
      });
      const ghi = [];
      if (!c) ghi.push(`<span class="t-nhap-chu">+ dòng mới${dang_chen ? ` – ${esc(dang_chen.phien)} đang chèn dở` : ""}, chưa commit</span>`);
      else if (cot.some(col => c[col] !== d[col])) ghi.push(`<span class="t-nhap-chu">← bản nháp chưa commit</span>`);
      if (khoa_dong[key]) ghi.push(veChip(khoa_dong[key]));
      hang.push({ o, duoi: ghi.length ? "  " + ghi.join(" ") : "" });
    }
    for (const [key, c] of commit) {
      if (t.moi_nhat.some(d => String(d[pk]) === key)) continue;
      hang.push({ o: cot.map(col => ({ t: chuO(c[col]), so: laSo(c[col]), lop: "t-xoa" })),
                  duoi: `  <span class="t-nhap-chu">✗ đã xóa, chưa commit</span>` });
    }
    let s = bangAscii(cot, hang);
    if (khoa_dong["∞"]) s += `\n  ${veChip(khoa_dong["∞"])} <span class="t-mo">trên khoảng trống sau dòng cuối (supremum)</span>`;
    return s;
  }

  function khoaDuoiCsdl(khoa, cho) {
    const dong = khoa.filter(k => k.loai_khoa === "RECORD");
    let s = `<span class="t-lenh-qs">mysql&gt; SELECT phien, object_name, index_name, lock_mode, lock_status, lock_data
    -&gt; FROM performance_schema.data_locks WHERE lock_type = 'RECORD';</span>\n`;
    if (!dong.length) s += `Empty set (0.00 sec)  <span class="t-mo">-- không phiên nào đang giữ khóa dòng</span>`;
    else {
      s += bangAscii(["phien", "object_name", "index_name", "lock_mode", "lock_status", "lock_data"], dong.map(k => ({
        o: [k.phien, k.bang, k.chi_muc || "NULL", k.che_do_khoa, k.trang_thai, chuO(k.du_lieu)].map((t, i) => ({
          t: chuO(t), lop: i === 0 ? `t-p${k.phien}` : i === 4 && t === "WAITING" ? "t-loi" : "" })),
        lop: k.trang_thai === "WAITING" ? "t-dong-cho" : "",
      }))) + `\n${soDong(dong.length)} in set`;
    }
    const so_bang = khoa.length - dong.length;
    if (so_bang) s += `\n<span class="t-mo">-- (không hiện ${so_bang} khóa ý định mức bảng IX/IS)</span>`;
    s += `<span class="qs-cho"><span class="t-lenh-qs">\n\nmysql&gt; SELECT … FROM performance_schema.data_lock_waits;</span>\n`;
    s += cho.length
      ? bangAscii(["phien_dang_cho", "phien_dang_giu"], cho.map(c => ({
          o: [{ t: c.phien_cho, lop: `t-p${c.phien_cho}` }, { t: c.phien_giu, lop: `t-p${c.phien_giu}` }],
          duoi: `  <span class="t-mo">${esc(c.phien_cho)} đứng chờ tới khi ${esc(c.phien_giu)} commit / rollback</span>` })))
        + `\n${soDong(cho.length)} in set`
      : `Empty set (0.00 sec)  <span class="t-mo">-- không phiên nào phải chờ</span>`;
    return s + `</span>`;
  }

  function veQuanSat(e, hoat_hinh) {
    const tt = trangThaiKhung(khung);
    const tt_truoc = khung > 0 ? trangThaiKhung(khung - 1) : null;
    const khoa = e ? e.khoa || [] : [];
    const cho = e ? e.cho || [] : [];
    const so_khoa = khoa.filter(k => k.loai_khoa === "RECORD").length;
    const bang = kq.bang.map(ten => `<span class="t-lenh-qs">mysql&gt; SELECT * FROM ${esc(ten)};</span>\n`
      + bangDuoiCsdl(ten, tt[ten], tt_truoc ? tt_truoc[ten] : null, khoa)).join("\n\n");
    return dauTerm("🗄 Dưới CSDL – dữ liệu thật trong InnoDB",
      khung ? `ảnh chụp ngay sau bước <b>t${khung}</b>` : "trạng thái ban đầu <b>t0</b>",
      cho.length ? "chan" : so_khoa ? "mo" : "", cho.length ? `⏳ ${cho.length} phiên đang chờ khóa` : so_khoa ? `🔒 ${so_khoa} khóa dòng` : "không có khóa")
      + `<div class="qs-luoi ${hoat_hinh ? "tre" : ""}">
        <div class="term-than qs-o"><div class="qs-nhan">Nội dung bảng</div>${bang}</div>
        <div class="term-than qs-o"><div class="qs-nhan">Khóa của InnoDB</div>${khoaDuoiCsdl(khoa, cho)}</div></div>
      <div class="qs-chu-giai"><span><span class="t-nhap">7→6</span> đã commit → bản nháp chưa commit (phiên khác đọc thường vẫn thấy 7)</span>
        <span><span class="t-vua-doi">ô sáng</span> vừa đổi ở bước này</span>
        <span><span class="chip A">🔒 A X</span> đang giữ khóa · <span class="chip B cho" style="animation:none">⏳ B X</span> đang chờ</span></div>`;
  }

  function veManHinhMysql(e, hoat_hinh) {
    const sai = kq.loai === "sai";
    $("#xd-mysql").className = "man-hinh-mysql " + (sai ? "kb-la-sai" : "kb-la-dung");
    for (const p of ["A", "B"]) {
      const o = $(`#xd-term-${p}`);
      o.innerHTML = veTerm(p, e);
      o.classList.toggle("dang-go-lenh", !!e && e.phien === p);
      const than = o.querySelector(".term-than");
      than.scrollTop = than.scrollHeight;
    }
    $("#xd-qs").innerHTML = veQuanSat(e, hoat_hinh);
    ganChuThich("#xd-mysql");
    $$("#xd-mysql .khoi[data-k]").forEach(k => k.addEventListener("click", () => { dungPhat(); toi(+k.dataset.k); }));
    if (hoat_hinh && e) goLenh(e);
  }

  /** Hiệu ứng gõ câu lệnh vào cửa sổ, rồi mới hiện kết quả MySQL trả về. */
  function goLenh(e) {
    const luot = luot_hoat_hinh;
    const term = $(`#xd-term-${e.phien}`);
    const khoi = term && term.querySelector(".khoi.hien");
    if (!khoi) return;
    const than = term.querySelector(".term-than");
    const ra = khoi.querySelector(".t-ra");
    if (e.loai === "xong_sau_chan" || e.loai === "hoan") { ra && ra.classList.add("t-hien-ra"); return; }
    const sql_el = khoi.querySelector(".t-sql");
    if (!sql_el || !sql_el.dataset.sql) return;
    const html_day = sql_el.innerHTML, chu = sql_el.dataset.sql;
    const an = [...khoi.querySelectorAll(".t-kh, .t-diem")];
    const cho_go = term.querySelector(".t-cho-go");
    an.forEach(x => (x.style.visibility = "hidden"));
    if (ra) ra.style.display = "none";
    if (cho_go) cho_go.style.display = "none";
    sql_el.textContent = "";
    sql_el.classList.add("dang-go");
    const nhip = Math.max(5, 14 / toc_do), moi_lan = 2;
    let i = 0;
    const go = () => {
      if (luot !== luot_hoat_hinh) return;
      i = Math.min(chu.length, i + moi_lan);
      sql_el.textContent = chu.slice(0, i);
      if (i < chu.length) { setTimeout(go, nhip); return; }
      sql_el.innerHTML = html_day;
      sql_el.classList.remove("dang-go");
      an.forEach(x => (x.style.visibility = ""));
      setTimeout(() => {
        if (luot !== luot_hoat_hinh) return;
        if (ra) { ra.style.display = ""; ra.classList.add("t-hien-ra"); }
        if (cho_go) cho_go.style.display = "";
        than.scrollTop = than.scrollHeight;
      }, 220 / toc_do);
    };
    go();
  }

  function datCheDoXem(c) {
    che_do_xem = c;
    try { localStorage.setItem("xd-che-do", c); } catch { /* bỏ qua */ }
    $$("#xd-che-do button").forEach(b => b.classList.toggle("dang-chon", b.dataset.xem === c));
    $("#xd-mysql").hidden = c !== "mysql";
    $("#xd-san-khau").hidden = c !== "lich";
    $("#xd-che-do-phu").textContent = c === "mysql"
      ? "Hai cửa sổ dòng lệnh của hai phiên + dữ liệu thật dưới CSDL sau mỗi bước"
      : "Lịch giao tác T₁ | T₂ theo thời gian, như vẽ trên bảng";
    if (kq) veKhung();
  }
  $$("#xd-che-do button").forEach(b => b.addEventListener("click", () => datCheDoXem(b.dataset.xem)));

  /* ------------------------------------------------------------ bàn điều khiển: xem CSDL thật + Reset */
  const GOI_Y = [
    "SELECT * FROM chuyen_bay",
    "SELECT * FROM ve",
    "SELECT * FROM ghe",
    "SELECT object_name, index_name, lock_mode, lock_status, lock_data FROM performance_schema.data_locks",
  ];
  const nhatKyBdk = () => $("#xd-bdk-log");
  function inBdk(html) {
    const l = nhatKyBdk();
    l.insertAdjacentHTML("beforeend", html);
    ganChuThich("#xd-bdk-log .khoi:last-child");
    l.scrollTop = l.scrollHeight;
    return l.lastElementChild;
  }
  const dongLenh = sql => `<div class="t-lenh"><span class="t-nhac">mysql&gt;</span> <span class="t-sql">${toMauSql(sql)};</span></div>`;

  function inDuLieu(r, chu_thich) {
    let s = `<div class="khoi"><div class="t-chu-thich">-- ${esc(chu_thich)} · ${new Date().toLocaleTimeString("vi-VN")}</div>`;
    for (const [ten, t] of Object.entries(r.trang_thai || {})) {
      s += dongLenh(`SELECT * FROM ${ten}`) + `<div class="t-ra">${bangDuoiCsdl(ten, t, null, r.khoa || [])}\n${soDong(t.moi_nhat.length)} in set</div>`;
    }
    const dong_khoa = (r.khoa || []).filter(k => k.loai_khoa === "RECORD");
    s += `<div class="t-ra t-mo">-- ${dong_khoa.length ? `${dong_khoa.length} khóa dòng đang được giữ` : "không có khóa nào đang được giữ"}</div>`;
    inBdk(s + `</div>`);
  }

  async function chayTruyVan(sql) {
    const khoi = inBdk(`<div class="khoi">${dongLenh(sql)}<div class="t-ra t-cho"><span class="t-xoay"></span>đang chạy…</div></div>`);
    const ra = khoi.querySelector(".t-ra");
    try {
      const r = await goiApi("/api/csdl/truy-van", { sql });
      ra.className = "t-ra t-hien-ra";
      if (r.loi) ra.innerHTML = loiMysql(r.loi);
      else if (!r.dong.length) ra.innerHTML = `Empty set ${giay(r.thoi_gian_ms)}`;
      else ra.innerHTML = `${bangTuDong(r.cot, r.dong)}\n${soDong(r.so_dong)} in set ${giay(r.thoi_gian_ms)}`
        + (r.cat_bot ? `  <span class="t-mo">-- chỉ hiện ${r.so_dong} dòng đầu</span>` : "");
    } catch (err) {
      ra.className = "t-ra";
      ra.innerHTML = `<span class="t-loi">${esc(err.message)}</span>`;
    }
    nhatKyBdk().scrollTop = nhatKyBdk().scrollHeight;
  }

  $("#xd-bdk-goi-y").innerHTML = `<span>Thử nhanh:</span>` + GOI_Y.map(s =>
    `<button type="button" class="phu nho" data-sql="${esc(s)}">${esc(s.length > 42 ? s.slice(0, 40) + "…" : s)}</button>`).join("");
  $$("#xd-bdk-goi-y button").forEach(b => b.addEventListener("click", () => chayTruyVan(b.dataset.sql)));
  $("#xd-bdk-form").addEventListener("submit", ev => {
    ev.preventDefault();
    const o = $("#xd-bdk-sql");
    const sql = o.value.trim().replace(/;+\s*$/, "");
    if (!sql) return;
    o.value = "";
    chayTruyVan(sql);
  });
  $("#xd-xoa-bdk").addEventListener("click", () => { nhatKyBdk().innerHTML = ""; });
  $("#xd-hien-tai").addEventListener("click", async () => {
    try { inDuLieu(await goiApi("/api/csdl/hien-tai"), "Dữ liệu đang có trong CSDL"); }
    catch (err) { inBdk(`<div class="khoi"><div class="t-ra"><span class="t-loi">${esc(err.message)}</span></div></div>`); }
  });
  $("#xd-dat-lai").addEventListener("click", async () => {
    dungPhat();
    await chayCo($("#xd-dat-lai"), $("#xd-trang-thai"), "Đang nạp lại dữ liệu ban đầu…", async () => {
      const r = await goiApi("/api/csdl/dat-lai", {});
      inBdk(`<div class="khoi"><div class="t-chu-thich">-- ↺ RESET: xóa mọi thay đổi do các lần chạy trước để lại</div>
        <div class="t-ra t-ok">Query OK – đã nạp lại dữ liệu ban đầu cho ${Object.keys(r.trang_thai || {}).map(esc).join(", ")}</div></div>`);
      inDuLieu(r, "Dữ liệu sau khi reset");
      if (kq) toi(0);
    });
    $("#xd-bdk").scrollIntoView({ block: "nearest", behavior: "smooth" });
  });
  inBdk(`<div class="khoi"><div class="t-mo">Phiên quan sát – một kết nối riêng, chạy câu đọc ở READ COMMITTED trong giao tác READ ONLY:
không đặt khóa nên không làm ảnh hưởng kịch bản nào, và luôn thấy bản đã commit mới nhất.
Gõ một câu SELECT rồi Enter, hoặc bấm một gợi ý bên dưới.</div></div>`);

  /* ------------------------------------------------------------ mã nguồn SAI | ĐÚNG */
  function veMaNguon() {
    const x = DS[ma];
    if (!x) return;
    const cot = l => {
      const kb = x.kich_ban[l];
      const khoi = p => {
        const ds = kb.ma_nguon[p] || [];
        const dong = d => {
          const cm = [d.ky_hieu, d.diem_khac ? (l === "sai" ? "← nguyên nhân" : "← cách sửa") : ""].filter(Boolean).join("   ");
          return `<div class="mn-dong ${d.diem_khac ? "khac" : ""}"><span class="t-sql">${toMauSql(d.sql)};</span>${cm ? `<span class="mn-cm">-- ${esc(cm)}</span>` : ""}</div>`;
        };
        const chinh = ds.filter(d => !d.kiem_tra), kt = ds.filter(d => d.kiem_tra);
        return `<div class="mn-phien ${p}"><div class="t-chu-thich">-- ===== Phiên ${p} · ${TEN_PHIEN[p]} (${p === "A" ? "T₁" : "T₂"}) =====</div>${chinh.map(dong).join("")}
          ${kt.length ? `<div class="t-chu-thich">-- kiểm tra sau khi cả hai kết thúc</div>${kt.map(dong).join("")}` : ""}</div>`;
      };
      return `<div class="mn-cot ${l}"><div class="mn-dau"><b>${l === "sai" ? "✗ Kịch bản SAI" : "✓ Kịch bản ĐÚNG"}</b>
          <span>${esc(kb.tieu_de)}</span></div>
        <div class="term"><div class="term-than mn-than">${khoi("A")}${khoi("B")}</div></div></div>`;
    };
    $("#xd-ma-nguon").innerHTML = `<div class="mn-luoi">${cot("sai")}${cot("dung")}</div>
      <div class="ket-luan trung" style="margin-top:12px"><b>Khác biệt:</b> ${esc(x.khac_biet)}</div>`;
  }

  /* ------------------------------------------------------------ tự kiểm chứng trên phpMyAdmin */
  const TU_KHOA_TT = /\b(CREATE PROCEDURE|BEGIN|END|DECLARE|INT|VARCHAR|CALL|DO SLEEP|INTO|SET SESSION|SET TRANSACTION ISOLATION LEVEL|START TRANSACTION|SELECT|FROM|WHERE|FOR UPDATE|UPDATE|SET|INSERT INTO|VALUES|COMMIT|ROLLBACK|AND|AS|ORDER BY|COUNT|GROUP_CONCAT|SEPARATOR|ROW_COUNT)\b/g;
  const toMauThuTuc = sql => sql.split("\n").map(dong => {
    const i = dong.indexOf("--");
    const ma_ = i < 0 ? dong : dong.slice(0, i), cm = i < 0 ? "" : dong.slice(i);
    return esc(ma_).replace(TU_KHOA_TT, '<span class="tk">$1</span>')
      .replace(/\b(READ UNCOMMITTED|READ COMMITTED|REPEATABLE READ|SERIALIZABLE)\b/g, '<span class="tt-muc">$1</span>')
      + (cm ? `<span class="t-mo">${esc(cm)}</span>` : "");
  }).join("\n");

  function nutChep(sql) {
    return `<button type="button" class="phu nho nut-chep" data-chep="${esc(sql)}" title="Sao chép để dán vào ô SQL của phpMyAdmin">⧉ Chép</button>`;
  }

  function veThuTuc() {
    const o = $("#xd-pma");
    if (!THU_TUC || !THU_TUC[ma]) return;
    const x = THU_TUC[ma], kb = x[loai];
    const sai = loai === "sai";
    const lenh = (so_, tieu_de, sql, phu) => `<div class="pma-buoc"><span class="pma-so">${so_}</span>
      <div><b>${tieu_de}</b>${phu ? `<span class="pma-phu">${phu}</span>` : ""}
        ${sql ? `<div class="pma-lenh"><code>${esc(sql)}</code>${nutChep(sql)}</div>` : ""}</div></div>`;
    const ma_tt = t => `<div class="pma-tt"><div class="pma-tt-dau"><b>${t}</b> <code>${esc(kb[t].ten)}</code>
        <span>${esc(x.vai_tro[t])}</span></div>
      <div class="term"><pre class="term-than pma-code">${toMauThuTuc(kb[t].sql)}</pre></div></div>`;
    o.innerHTML = `<div class="pma-kb ${loai}"><b>${sai ? "✗ Kịch bản SAI" : "✓ Kịch bản ĐÚNG"}</b>
        – đổi kịch bản bằng hai nút SAI / ĐÚNG ở trên. Thủ tục đã được ứng dụng tạo sẵn trong CSDL <code>demo_dongthoi</code>.</div>
      <div class="pma-luoi">
        <div class="pma-cac-buoc">
          ${lenh(1, "Đặt lại dữ liệu ban đầu", `CALL ${THU_TUC._dat_lai.ten}();`, "hoặc bấm ↺ Reset dữ liệu CSDL ở trên")}
          ${lenh(2, "Tab phpMyAdmin thứ nhất → tab SQL → dán, bấm Go", `CALL ${kb.T1.ten}();`,
                 `T1 sẽ chạy khoảng ${x.giay_cho} giây (đang “ngủ” giữa giao tác)`)}
          ${lenh(3, `Trong vòng ${x.giay_cho} giây: tab phpMyAdmin thứ hai → dán, bấm Go`, `CALL ${kb.T2.ten}();`,
                 "mở tab mới bằng Ctrl + nhấp vào nút “Mở phpMyAdmin”")}
          ${lenh(4, "Đợi T1 xong rồi xem dữ liệu thật", `${x.kiem_tra};`, "hoặc mở bảng ở cột trái phpMyAdmin → Browse")}
          <div class="pma-ky-vong ${loai}"><b>Kết quả sẽ thấy:</b> ${esc(kb.ky_vong)}</div>
        </div>
        <div class="pma-hai-tt">${ma_tt("T1")}${ma_tt("T2")}</div>
      </div>`;
    $$("#xd-pma .nut-chep").forEach(b => b.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(b.dataset.chep); b.textContent = "✓ Đã chép"; }
      catch { b.textContent = "Chép tay giúp"; }
      setTimeout(() => (b.textContent = "⧉ Chép"), 1600);
    }));
  }

  datCheDoXem(che_do_xem);

  /* ------------------------------------------------------------ hoạt hình */
  function toaDo(p, k) {
    const sk = $("#xd-san-khau").getBoundingClientRect();
    const bang = $("#xd-lich-gt").getBoundingClientRect();
    const db = $("#xd-csdl").getBoundingClientRect();
    const o = $(`#xd-lich-gt .lgt-dong[data-k="${k}"] .lgt-o.${p}`);
    const r = (o || $("#xd-lich-gt")).getBoundingClientRect();
    return {
      y: Math.max(db.top + 40, Math.min(db.bottom - 20, r.top + 22)) - sk.top,
      y_cho: r.top + 22 - sk.top,
      x_phien: r.left + r.width * 0.78 - sk.left,
      x_db: db.left + Math.min(110, db.width * 0.3) - sk.left,
      x_cua: (bang.right + db.left) / 2 - sk.left,
    };
  }

  function taoVien(chu, lop) {
    const el = document.createElement("div");
    el.className = "vien-sql " + lop;
    el.innerHTML = `<span style="display:inline-block;margin-right:5px;font-size:12px">✈</span>${esc(chu)}`;
    $("#xd-lop").appendChild(el);
    return el;
  }

  function datVi(el, x, y) {
    el.style.transform = `translate(${x - el.offsetWidth / 2}px, ${y - el.offsetHeight / 2}px)`;
  }

  function bay(el, x0, y0, x1, y1, thoi_gian) {
    const w = el.offsetWidth, h = el.offsetHeight;
    const a = `translate(${x0 - w / 2}px, ${y0 - h / 2}px)`;
    const b = `translate(${x1 - w / 2}px, ${y1 - h / 2}px)`;
    el.style.transform = b;
    const anim = el.animate(
      [{ transform: a, opacity: 0 }, { transform: a, opacity: 1, offset: 0.12 }, { transform: b, opacity: 1 }],
      { duration: thoi_gian, easing: "cubic-bezier(.45,.05,.35,1)" });
    // Khi tab bị ẩn, trình duyệt ngừng vẽ nên hoạt hình đứng yên và .finished không bao giờ xong.
    // Hẹn giờ dự phòng giữ cho chuỗi đi → về vẫn tiếp diễn đúng thứ tự.
    return Promise.race([anim.finished.catch(() => {}), new Promise(r => setTimeout(r, thoi_gian + 150))]);
  }

  function nganGon(e) {
    const r = e.ket_qua;
    if (!r) return "OK";
    if (r.loi) return `✗ ${r.loi.ma}`;
    if (r.dong && r.dong.length === 1 && Object.keys(r.dong[0]).length === 1) return `${Object.values(r.dong[0])[0]}`;
    if (r.dong && r.dong.length) return `${r.dong.length} dòng`;
    if (r.so_dong_khop != null) return `matched ${r.so_dong_khop}`;
    return "OK";
  }

  /** Mỗi phiên đang bị chặn có một viên "⏳" đứng chờ trước cửa CSDL, ngang hàng với câu lệnh bị chặn. */
  function veVienCho(tru = null) {
    if (manHinhHep() || !kq || che_do_xem !== "lich") return;
    for (const p of ["A", "B"]) {
      const chan = Object.values(suKienTheoBuoc(p)).find(x => x.loai === "bi_chan");
      if (!chan || chan === tru) continue;
      const td = toaDo(p, chan.thu_tu);
      datVi(taoVien("⏳ " + lenhCua(chan.sql), "dung-cho " + p), td.x_cua, td.y_cho);
    }
  }

  function hoatHinh(e) {
    if (manHinhHep() || che_do_xem !== "lich") return;
    const luot = luot_hoat_hinh;
    const con_hieu_luc = () => luot === luot_hoat_hinh;
    veVienCho(e);
    if (e.loai === "hoan") return;
    const td = toaDo(e.phien, e.thu_tu);
    const tg = 650 / toc_do;
    if (e.loai === "xong_sau_chan") {
      const v = taoVien("▶ " + nganGon(e), e.ket_qua?.loi ? "loi" : "ve");
      bay(v, td.x_db, td.y, td.x_phien, td.y_cho, tg * 1.1).then(() => con_hieu_luc() && v.remove());
      return;
    }
    const di = taoVien(lenhCua(e.sql), e.phien);
    const den_x = e.loai === "bi_chan" ? td.x_cua : td.x_db;
    const den_y = e.loai === "bi_chan" ? td.y_cho : td.y;
    bay(di, td.x_phien, td.y_cho, den_x, den_y, tg).then(() => {
      if (!con_hieu_luc()) return;
      di.remove();
      if (e.loai === "bi_chan") {
        datVi(taoVien("⏳ " + lenhCua(e.sql), "dung-cho " + e.phien), td.x_cua, td.y_cho);
        return;
      }
      const ve = taoVien(nganGon(e), e.ket_qua?.loi ? "loi" : "ve");
      bay(ve, td.x_db, td.y, td.x_phien, td.y_cho, tg).then(() => con_hieu_luc() && ve.remove());
    });
  }

  /* ------------------------------------------------------------ kết luận + so sánh */
  function veKetLuan() {
    const sai = kq.loai === "sai";
    const lop = kq.dung_ky_vong ? (sai ? "sai" : "dung") : "la";
    const tieu_de = !kq.dung_ky_vong ? "⚠ Kết quả khác dự kiến – hãy bấm Chạy lại"
      : sai ? `✗ SAI – ${kq.ten} đã xảy ra` : `✓ ĐÚNG – đã ngăn được ${kq.ten.toLowerCase()}`;
    const lich = kq.lich.map(l => l.ky_hieu + (l.loai === "bi_chan" ? "⏳" : "")).join("  ");
    return `<div class="ket-luan-xd ${lop}"><div class="tieu-de-kl">${esc(tieu_de)}</div>${esc(kq.giai_thich)}
      <div class="kl-lich">Lịch đã thực thi: <code>${esc(lich)}</code></div>
      <div class="goi-y">${sai ? "Xem cách khắc phục:" : "Đối chiếu với cách làm sai:"}
        <button class="phu" id="xd-sang-kia">${sai ? "✓ Chuyển sang kịch bản ĐÚNG" : "✗ Chuyển sang kịch bản SAI"}</button></div></div>`;
  }

  function cauThenChot(r) {
    const ds = [];
    for (const p of ["A", "B"]) {
      for (const d of r.ma_nguon[p]) {
        if (d.diem_khac && !(d.la_cau_hinh && p === "B")) ds.push(`${p}: ${d.sql};`);
      }
    }
    return ds.length ? ds.map(s => `<code>${esc(s)}</code>`).join("<br>") : "—";
  }

  function veSoSanh() {
    const s = bo_nho[khoaBN(ma, "sai")], d = bo_nho[khoaBN(ma, "dung")];
    const the = $("#xd-the-ss");
    if (!s || !d) { the.classList.add("an"); return; }
    const lich = r => r.lich.map(l => l.ky_hieu + (l.loai === "bi_chan" ? "⏳" : "")).join("  ");
    const cot = (r, lop, tieu_de) => `<div class="cot-ss ${lop}"><h3>${tieu_de}: ${esc(r.tieu_de)}</h3><dl>
      <dt>Mức cô lập</dt><dd><code>${esc(r.muc_co_lap)}</code></dd>
      <dt>Câu lệnh then chốt</dt><dd>${cauThenChot(r)}</dd>
      <dt>Lịch thực thi</dt><dd><code>${esc(lich(r))}</code></dd>
      <dt>Kết quả</dt><dd><b style="color:${r.xay_ra ? "var(--do)" : "var(--luc)"}">${r.xay_ra ? "xung đột xảy ra" : "không xảy ra xung đột"}</b></dd>
      <dt>Số lần bị chặn</dt><dd>${r.tong_ket.so_lan_bi_chan}</dd>
      <dt>Thời gian chờ khóa</dt><dd>${so(r.tong_ket.thoi_gian_cho_ms)} ms</dd>
      <dt>Lỗi từ MySQL</dt><dd>${r.tong_ket.loi.length ? esc(r.tong_ket.loi.join(", ")) : "không"}</dd>
      </dl></div>`;
    $("#xd-so-sanh").innerHTML = `<div class="so-sanh-xd">${cot(s, "sai", "✗ SAI")}${cot(d, "dung", "✓ ĐÚNG")}</div>
      <div class="ket-luan trung" style="margin-top:12px"><b>Khác biệt duy nhất:</b> ${esc(DS[ma].khac_biet)}</div>`;
    the.classList.remove("an");
  }

  // Hộp hướng dẫn: mở ở lần đầu, sau đó nhớ lựa chọn đóng/mở của người xem
  const huong_dan = $("#xd-huong-dan");
  try {
    if (localStorage.getItem("xd-huong-dan") === "dong") huong_dan.open = false;
  } catch { /* trình duyệt chặn lưu trữ – cứ mở mặc định */ }
  huong_dan.addEventListener("toggle", () => {
    try { localStorage.setItem("xd-huong-dan", huong_dan.open ? "mo" : "dong"); } catch { /* bỏ qua */ }
  });

  nap();
})();
