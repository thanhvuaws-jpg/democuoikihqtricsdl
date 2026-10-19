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

  const TEN_PHIEN = { A: "Quầy vé A", B: "App di động B" };
  const khoaBN = (m, l) => `${m}:${l}`;
  const N = () => (kq ? kq.nhat_ky.length : 0);
  const lenhCua = sql => (sql || "").trim().split(/\s+/)[0].toUpperCase();
  const manHinhHep = () => matchMedia("(max-width: 1080px)").matches;
  const kia = p => (p === "A" ? "B" : "A");

  const TU_KHOA = /\b(SET SESSION TRANSACTION ISOLATION LEVEL|START TRANSACTION|SELECT|FROM|WHERE|FOR UPDATE|UPDATE|SET|INSERT INTO|VALUES|COMMIT|ROLLBACK|AND|ORDER BY|COUNT)\b/g;
  const toMauSql = sql => esc(sql).replace(TU_KHOA, '<span class="tk">$1</span>');

  /* ------------------------------------------------------------ nạp & chọn */
  async function nap() {
    try {
      const d = await goiApi("/api/xung-dot");
      DS = d.xung_dot;
      veDanhSach();
      chon(ma, loai);
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
    $("#xd-san-khau").className = "san-khau-lich " + (kq.loai === "sai" ? "kb-la-sai" : "kb-la-dung");
    $("#xd-lich-gt").innerHTML = veLichGiaoTac(e);
    $("#xd-csdl").innerHTML = veCsdl(e);
    $$("#xd-san-khau [data-tip]").forEach(el => {
      el.addEventListener("mousemove", ev => hienHop(ev, esc(el.dataset.tip).replace(/\n/g, "<br>")));
      el.addEventListener("mouseleave", anHop);
    });
    $$("#xd-lich-gt .lgt-dong[data-k]").forEach(d => d.addEventListener("click", () => { dungPhat(); toi(+d.dataset.k); }));

    $("#xd-ket-luan").innerHTML = khung === N() ? veKetLuan() : "";
    const nut_kia = $("#xd-sang-kia");
    if (nut_kia) nut_kia.addEventListener("click", () => chon(ma, kq.loai === "sai" ? "dung" : "sai"));

    // giữ dòng đang xem trong tầm nhìn khi bảng dài hơn màn hình
    const dong_hien = $("#xd-lich-gt .lgt-dong.hien");
    if (dong_hien && hoat_hinh) {
      const r = dong_hien.getBoundingClientRect();
      if (r.bottom > innerHeight - 20 || r.top < 150) dong_hien.scrollIntoView({ block: "center", behavior: "smooth" });
    }

    $("#xd-lop").innerHTML = "";
    if (hoat_hinh && e) setTimeout(() => hoatHinh(e), 30);
    else veVienCho();
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
    if (manHinhHep() || !kq) return;
    for (const p of ["A", "B"]) {
      const chan = Object.values(suKienTheoBuoc(p)).find(x => x.loai === "bi_chan");
      if (!chan || chan === tru) continue;
      const td = toaDo(p, chan.thu_tu);
      datVi(taoVien("⏳ " + lenhCua(chan.sql), "dung-cho " + p), td.x_cua, td.y_cho);
    }
  }

  function hoatHinh(e) {
    if (manHinhHep()) return;
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
