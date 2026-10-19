/* Tab 2 – phòng thí nghiệm mức cô lập */
(() => {
  let DS = {};          // mã -> thông tin thí nghiệm
  let CAC_MUC = [];
  let DU_LIEU_DAU = null;
  let chon_tn = "doc_rac";
  let chon_muc = "READ UNCOMMITTED";
  let kq = null;        // kết quả lần chạy gần nhất
  let da_hien = 0;      // số sự kiện đang hiện (phát từng bước)
  const CHO_CHAN = 700; // khớp với CHO_CHAN_MS ở phongthinghiem.py

  async function nap() {
    try {
      const d = await goiApi("/api/thi-nghiem");
      DS = d.thi_nghiem; CAC_MUC = d.cac_muc; DU_LIEU_DAU = d.du_lieu_ban_dau;
      veDanhSach(); veMuc(); veKeHoach(); veDuLieuDau();
    } catch (e) {
      $("#cl-trang-thai").className = "trang-thai loi";
      $("#cl-trang-thai").textContent = e.message;
    }
  }

  function veDanhSach() {
    $("#cl-ds").innerHTML = Object.entries(DS).map(([ma, t]) =>
      `<button class="tn ${ma === chon_tn ? "dang-chon" : ""}" data-ma="${ma}">
         <b>${esc(t.ten)}</b><span>${esc(t.tom_tat)}</span></button>`).join("");
    $$("#cl-ds .tn").forEach(b => b.addEventListener("click", () => {
      chon_tn = b.dataset.ma; kq = null; veDanhSach(); veKeHoach();
    }));
  }

  function veMuc() {
    $("#cl-muc").innerHTML = CAC_MUC.map(m =>
      `<button class="${m === chon_muc ? "dang-chon" : ""}" data-muc="${m}">${esc(m)}</button>`).join("");
    $$("#cl-muc button").forEach(b => b.addEventListener("click", () => {
      chon_muc = b.dataset.muc; kq = null; veMuc(); veKeHoach();
    }));
  }

  function veDuLieuDau() {
    const d = DU_LIEU_DAU;
    $("#cl-du-lieu-nd").innerHTML = `<div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:8px">
      <div><div style="color:var(--mo);margin-bottom:3px"><code>chuyen_bay</code></div><table style="width:auto">
        <tr><th>ma_chuyen</th><th>so_hieu</th><th>tong_ghe</th><th>so_ghe_trong</th></tr>
        ${d.chuyen_bay.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table></div>
      <div><div style="color:var(--mo);margin-bottom:3px"><code>ve</code> (có chỉ mục <code>fk_ve_chuyen</code> trên cột ma_chuyen)</div><table style="width:auto">
        <tr><th>ma_ve</th><th>ma_chuyen</th><th>hanh_khach</th></tr>
        ${d.ve.map(r => `<tr>${r.map(v => `<td>${esc(v)}</td>`).join("")}</tr>`).join("")}</table></div></div>`;
  }

  /* -------------------------------------------------- kế hoạch trước khi chạy */
  function veKeHoach() {
    const t = DS[chon_tn];
    if (!t) return;
    $("#cl-tieu-de").textContent = t.ten;
    $("#cl-tom-tat").innerHTML = `${esc(t.tom_tat)} · Mức cô lập: <b>${esc(chon_muc)}</b>`;
    $("#cl-ket-luan").innerHTML = `<div class="ket-luan"><b>Kịch bản dự kiến.</b> Bấm "Chạy thí nghiệm" để thực thi
      trên MySQL. Thứ tự thực tế có thể khác kịch bản nếu một phiên bị chặn vì chờ khóa.</div>`;
    $("#cl-dk").classList.add("an");
    $("#cl-lan").innerHTML = bangLan(t.buoc.map((b, i) => ({
      thu_tu: i + 1, phien: b.phien, ma: b.ma, mo_ta: b.mo_ta, sql: b.sql, loai: "ke_hoach",
    })), new Set());
  }

  /* -------------------------------------------------- chạy */
  async function chay(tn, muc) {
    chon_tn = tn; chon_muc = muc; kq = null;
    veDanhSach(); veMuc(); veKeHoach();
    await chayCo($("#cl-chay"), $("#cl-trang-thai"), "Hai phiên đang chạy trên MySQL…", async () => {
      kq = await goiApi("/api/thi-nghiem/chay", { ma: tn, muc_co_lap: muc });
      da_hien = 1;
      veKetQua();
    });
  }
  $("#cl-chay").addEventListener("click", () => chay(chon_tn, chon_muc));

  function veKetQua() {
    if (!kq) return;
    $("#cl-tieu-de").textContent = kq.ten;
    $("#cl-tom-tat").innerHTML = `${esc(kq.tom_tat)} · Mức cô lập: <b>${esc(kq.muc_co_lap)}</b>`;
    $("#cl-dk").classList.remove("an");
    const tong = kq.nhat_ky.length;
    da_hien = Math.max(1, Math.min(da_hien, tong));
    $("#cl-dem").textContent = `Bước ${da_hien} / ${tong}`;
    $("#cl-lui").disabled = da_hien <= 1;
    $("#cl-tien").disabled = da_hien >= tong;
    $("#cl-het").disabled = da_hien >= tong;

    const xong = da_hien >= tong;
    if (!xong) {
      $("#cl-ket-luan").innerHTML = `<div class="ket-luan"><b>Đang phát từng bước.</b>
        Kết luận sẽ hiện khi đi hết ${tong} bước. Phím mũi tên ← → cũng dùng được.</div>`;
    } else {
      const la_loi = kq.la_loi;
      const lop = kq.xay_ra === null ? "" : !la_loi ? "trung" : kq.xay_ra ? "xau" : "tot";
      const tieu_de = kq.xay_ra === null ? "Không đủ dữ liệu để kết luận"
        : la_loi ? (kq.xay_ra ? "Hiện tượng CÓ xảy ra" : "Hiện tượng KHÔNG xảy ra")
        : (kq.xay_ra ? "Hai cách đọc cho KẾT QUẢ KHÁC NHAU" : "Hai cách đọc cho cùng kết quả");
      let so_sanh = "";
      if (kq.ly_thuyet !== null && kq.ly_thuyet !== undefined) {
        so_sanh = `<div class="mo">Theo lý thuyết (chuẩn SQL): ${kq.ly_thuyet ? "có thể xảy ra" : "không xảy ra"}
          · MySQL thực tế: ${kq.xay_ra ? "xảy ra" : "không xảy ra"}
          ${kq.khac_ly_thuyet ? ' · <b style="color:var(--cam)">KHÁC lý thuyết</b>' : ""}</div>`;
      }
      const ghi_chu = kq.ghi_chu_mysql ? `<div class="mo" style="color:#92400e">${esc(kq.ghi_chu_mysql)}</div>` : "";
      $("#cl-ket-luan").innerHTML = `<div class="ket-luan ${lop}"><b>${tieu_de} ở mức ${esc(kq.muc_co_lap)}.</b>
        ${esc(kq.giai_thich)}${so_sanh}${ghi_chu}</div>`;
    }
    $("#cl-lan").innerHTML = bangLan(kq.nhat_ky.slice(0, da_hien), new Set(xong ? kq.noi_bat : []), da_hien - 1);
  }

  /* -------------------------------------------------- bảng hai làn A | B */
  function ketQuaHtml(e) {
    const r = e.ket_qua;
    if (!r) return "";
    if (r.loi) {
      return `<div class="kq"><span class="the-trang-thai tt-loi">LỖI ${r.loi.ma}${r.loi.ten === "deadlock" ? " · DEADLOCK" : ""}</span>
        <span style="color:var(--do)">${esc(r.loi.thong_diep)}</span></div>`;
    }
    const lenh = (e.sql || "").trim().split(/\s+/)[0].toUpperCase();
    if (r.dong && r.dong.length) {
      const cot = Object.keys(r.dong[0]);
      return `<div class="kq"><table><tr>${cot.map(c => `<th>${esc(c)}</th>`).join("")}</tr>
        ${r.dong.map(d => `<tr>${cot.map(c => `<td><b>${esc(d[c])}</b></td>`).join("")}</tr>`).join("")}</table></div>`;
    }
    if (lenh === "SELECT") return `<div class="kq" style="color:var(--mo)">(không có dòng nào)</div>`;
    if (lenh === "UPDATE" && r.so_dong_khop !== null && r.so_dong_khop !== undefined) {
      const im_lang = r.so_dong_khop > r.so_dong_doi;
      return `<div class="kq" style="color:${im_lang ? "var(--cam)" : "var(--mo)"}">
        Rows matched: <b>${r.so_dong_khop}</b> · Changed: <b>${r.so_dong_doi}</b>
        ${im_lang ? "– giá trị mới trùng giá trị cũ nên MySQL không tính là thay đổi" : ""}</div>`;
    }
    if (["UPDATE", "INSERT", "DELETE"].includes(lenh)) {
      return `<div class="kq" style="color:var(--mo)">${r.so_dong} dòng bị tác động</div>`;
    }
    return `<div class="kq" style="color:var(--luc)">OK</div>`;
  }

  function oBuoc(e) {
    let nhan = "";
    if (e.loai === "bi_chan") nhan += `<span class="the-trang-thai tt-chan">BỊ CHẶN</span>`;
    if (e.loai === "xong_sau_chan") nhan += `<span class="the-trang-thai tt-sau">ĐƯỢC CHẠY TIẾP</span>`;
    if (e.loai === "hoan") nhan += `<span class="the-trang-thai tt-hoan">HOÃN</span>`;
    if (e.chay_bu) nhan += `<span class="the-trang-thai tt-bu">CHẠY BÙ</span>`;
    const mo = e.loai === "ke_hoach" ? ' style="opacity:.75"' : "";
    let html = `<div${mo}><div class="mo-ta">${nhan}<b>${esc(e.ma)}</b> · ${esc(e.mo_ta)}</div>
      <code>${esc(e.sql)}</code>`;
    if (e.loai === "hoan") html += `<div class="kq" style="color:var(--mo)">${esc(e.ly_do || "")}</div>`;
    if (e.loai === "bi_chan") {
      const ai = (e.cho || []).map(c => `phiên ${esc(c.phien_cho)} đang chờ khóa do phiên ${esc(c.phien_giu)} giữ`).join("; ");
      html += `<div class="kq" style="color:var(--do)">Câu lệnh chưa trả về sau ${CHO_CHAN} ms – ${ai || "đang chờ khóa"}.</div>`;
    }
    if (e.loai === "xong_sau_chan" && e.ket_qua) {
      html += `<div class="kq" style="color:var(--luc)">Được InnoDB cho chạy tiếp sau ${so(e.ket_qua.thoi_gian_ms)} ms chờ khóa.</div>`;
    }
    html += ketQuaHtml(e);
    return html + `</div>`;
  }

  function bangLan(su_kien, noi_bat, moi = -1) {
    return `<table class="lan"><tr><th class="stt">#</th><th class="pa">Phiên A</th><th class="pb">Phiên B</th></tr>
      ${su_kien.map((e, i) => {
        const nb = noi_bat.has(e.ma) && ["xong", "xong_sau_chan"].includes(e.loai);
        // Bảng khóa có nhiều cột nên trải trên cả hai làn, không nhét vào một cột hẹp
        const khoa = e.loai === "bi_chan" && e.khoa && e.khoa.length
          ? `<tr class="dong-khoa"><td class="stt"></td><td colspan="2">
              <details class="khoa" open><summary>Bảng khóa của InnoDB ngay lúc này (${e.khoa.length} khóa)</summary>
              ${bangKhoa(e.khoa)}</details></td></tr>` : "";
        return `<tr class="${nb ? "noi-bat" : ""} ${i === moi ? "moi" : ""}">
          <td class="stt">${e.thu_tu}</td>
          <td class="o-buoc">${e.phien === "A" ? oBuoc(e) : ""}</td>
          <td class="o-buoc">${e.phien === "B" ? oBuoc(e) : ""}</td></tr>${khoa}`;
      }).join("")}</table>`;
  }

  /* -------------------------------------------------- điều khiển từng bước */
  function toi(n) {
    if (!kq) return;
    da_hien = Math.max(1, Math.min(kq.nhat_ky.length, n));
    veKetQua();
  }
  $("#cl-tien").addEventListener("click", () => toi(da_hien + 1));
  $("#cl-lui").addEventListener("click", () => toi(da_hien - 1));
  $("#cl-het").addEventListener("click", () => toi(Infinity));
  document.addEventListener("keydown", ev => {
    if ($("#tab-colap").hidden || !kq) return;
    if (["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement?.tagName)) return;
    if (ev.key === "ArrowRight") { toi(da_hien + 1); ev.preventDefault(); }
    if (ev.key === "ArrowLeft") { toi(da_hien - 1); ev.preventDefault(); }
  });

  /* -------------------------------------------------- ma trận */
  $("#cl-ma-tran").addEventListener("click", () => chayCo(
    $("#cl-ma-tran"), $("#cl-trang-thai"), "Đang chạy 24 thí nghiệm trên MySQL…", async () => {
      const m = await goiApi("/api/thi-nghiem/ma-tran", {});
      veMaTran(m);
    }));

  const VIET_TAT = { "READ UNCOMMITTED": "READ<br>UNCOMMITTED", "READ COMMITTED": "READ<br>COMMITTED",
                     "REPEATABLE READ": "REPEATABLE<br>READ", "SERIALIZABLE": "SERIALIZABLE" };

  function veMaTran(m) {
    const the = $("#cl-the-mt");
    the.classList.remove("an");
    let html = `<table class="ma-tran"><tr><th>Hiện tượng</th>${m.cac_muc.map(c => `<th>${VIET_TAT[c] || esc(c)}</th>`).join("")}</tr>`;
    const ghi_chu = [];
    for (const [ma, hang] of Object.entries(m.bang)) {
      const tn = m.thi_nghiem[ma];
      html += `<tr><td><b>${esc(tn.ten)}</b></td>`;
      for (const muc of m.cac_muc) {
        const c = hang[muc];
        const co = c.xay_ra;
        const lop = co === null ? "" : tn.la_loi ? (co ? "co" : "khong") : (co ? "trung-co" : "trung-khong");
        const chu = co === null ? "?" : tn.la_loi ? (co ? "Xảy ra" : "Không") : (co ? "Khác nhau" : "Giống nhau");
        const lt = c.ly_thuyet === null || c.ly_thuyet === undefined ? "" :
          `<span class="lt">chuẩn SQL: ${c.ly_thuyet ? "có" : "không"}</span>`;
        const phu = [c.co_chan ? "có chặn" : "", c.co_deadlock ? "deadlock" : ""].filter(Boolean).join(" · ");
        html += `<td class="o ${lop} ${c.khac_ly_thuyet ? "khac" : ""}" data-ma="${ma}" data-muc="${esc(muc)}"
                   data-tip="${esc(c.giai_thich)}">${chu}${lt}${phu ? `<span class="lt">${phu}</span>` : ""}</td>`;
        if (c.ghi_chu_mysql && c.khac_ly_thuyet) ghi_chu.push(`<li><b>${esc(tn.ten)} · ${esc(muc)}:</b> ${esc(c.ghi_chu_mysql)}</li>`);
      }
      html += `</tr>`;
    }
    html += `</table>
      <div class="ghi-chu-ma-tran">
        <span><i class="o-mau" style="background:#fee2e2"></i>Lỗi xảy ra</span>
        <span><i class="o-mau" style="background:#dcfce7"></i>Được ngăn chặn</span>
        <span><i class="o-mau" style="outline:2px dashed var(--cam);outline-offset:-2px"></i>MySQL khác lý thuyết chuẩn SQL</span>
      </div>`;
    if (ghi_chu.length) {
      html += `<div class="ket-luan trung" style="margin-top:12px"><b>Những điểm MySQL/InnoDB khác lý thuyết:</b>
        <ul style="margin:6px 0 0;padding-left:20px">${ghi_chu.join("")}</ul></div>`;
    }
    $("#cl-bang-mt").innerHTML = html;
    $$("#cl-bang-mt td.o").forEach(td => {
      td.addEventListener("mousemove", ev => hienHop(ev, esc(td.dataset.tip)));
      td.addEventListener("mouseleave", anHop);
      td.addEventListener("click", () => {
        anHop();
        $("#cl-the-kq").scrollIntoView({ behavior: "smooth", block: "start" });
        chay(td.dataset.ma, td.dataset.muc).then(() => toi(Infinity));
      });
    });
    the.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  nap();
})();
