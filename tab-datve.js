/* Tab 1 – nhiều khách cùng đặt vé */
(() => {
  const LOAI = {
    begin:    ["#98a2b3", "START TRANSACTION"],
    doc:      ["#2563eb", "Đọc (SELECT)"],
    ghi:      ["#7c3aed", "Ghi (UPDATE / INSERT)"],
    cho:      ["#d0d5dd", "Đang cân nhắc – giao tác vẫn mở"],
    cho_khoa: ["#dc2626", "Bị chặn vì chờ khóa"],
    commit:   ["#16a34a", "COMMIT"],
    rollback: ["#d97706", "ROLLBACK"],
    deadlock: ["#7f1d1d", "Deadlock – bị InnoDB hủy"],
    het_gio:  ["#b45309", "Hết giờ chờ khóa"],
    loi:      ["#dc2626", "Lỗi"],
  };
  const mauLoai = l => (LOAI[l] || ["#98a2b3"])[0];

  const MO_TA = {
    khong_khoa: "Mỗi khách đọc số ghế còn, cân nhắc, rồi tự tính và ghi đè giá trị mới. Không có gì ngăn "
      + "hai khách cùng đọc một con số – nhiều người sẽ cùng ghi đè cùng một giá trị: <b>mất cập nhật</b>.",
    bi_quan: "<code>SELECT … FOR UPDATE</code> đặt khóa X lên dòng chuyến bay ngay lúc đọc. Khách sau muốn đọc "
      + "phải xếp hàng tới khi khách trước COMMIT. Đúng tuyệt đối nhưng các giao tác bị <b>tuần tự hóa</b>.",
    lac_quan: "Đọc kèm cột <code>version</code>, không khóa gì. Khi ghi chỉ cập nhật nếu version chưa đổi. "
      + "Nếu có người sửa trước (0 dòng bị tác động) thì hủy và <b>thử lại</b> bằng một giao tác mới.",
    nguyen_tu: "Gộp việc kiểm tra và trừ ghế vào <b>một câu UPDATE</b> có điều kiện. InnoDB khóa dòng trong lúc "
      + "thực thi câu lệnh, nên không còn khe hở giữa lúc đọc và lúc ghi.",
    deadlock: "Khách lẻ giữ ghế #1 rồi xin ghế #2, khách chẵn làm ngược lại. Hai bên giữ khóa của nhau "
      + "và chờ nhau thành vòng tròn. InnoDB <b>phát hiện deadlock</b> và hủy một giao tác để phá vòng.",
  };

  const MA = {
    khong_khoa: `START TRANSACTION;
SELECT so_ghe_trong FROM chuyen_bay WHERE ma_chuyen = 1;  -- đọc được n
-- … khách cân nhắc …
UPDATE chuyen_bay SET so_ghe_trong = n - 1 WHERE ma_chuyen = 1;
INSERT INTO ve (ma_chuyen, hanh_khach) VALUES (1, 'Khách i');
COMMIT;`,
    bi_quan: `START TRANSACTION;
SELECT so_ghe_trong FROM chuyen_bay WHERE ma_chuyen = 1
  FOR UPDATE;                     -- khóa X, người sau xếp hàng
-- … khách cân nhắc (vẫn giữ khóa) …
UPDATE chuyen_bay SET so_ghe_trong = n - 1 WHERE ma_chuyen = 1;
INSERT INTO ve (ma_chuyen, hanh_khach) VALUES (1, 'Khách i');
COMMIT;                           -- nhả khóa`,
    lac_quan: `-- lặp tối đa 8 lần, mỗi lần là một giao tác mới
START TRANSACTION;
SELECT so_ghe_trong, version FROM chuyen_bay WHERE ma_chuyen = 1;
-- … khách cân nhắc …
UPDATE chuyen_bay SET so_ghe_trong = n - 1, version = version + 1
  WHERE ma_chuyen = 1 AND version = v;
-- 0 dòng bị tác động → có người sửa trước → ROLLBACK, thử lại
INSERT INTO ve (ma_chuyen, hanh_khach) VALUES (1, 'Khách i');
COMMIT;`,
    nguyen_tu: `START TRANSACTION;
UPDATE chuyen_bay SET so_ghe_trong = so_ghe_trong - 1
  WHERE ma_chuyen = 1 AND so_ghe_trong > 0;
-- 0 dòng bị tác động → hết vé → ROLLBACK
INSERT INTO ve (ma_chuyen, hanh_khach) VALUES (1, 'Khách i');
COMMIT;`,
    deadlock: `-- khách lẻ: ghế 1 rồi ghế 2 · khách chẵn: ghế 2 rồi ghế 1
START TRANSACTION;
UPDATE ghe SET trang_thai = 'dang_giu' WHERE ma_ghe = 1;
-- … vẫn giữ khóa, chưa commit …
UPDATE ghe SET trang_thai = 'dang_giu' WHERE ma_ghe = 2;
COMMIT;`,
  };

  const TU_KHOA = /\b(START TRANSACTION|SELECT|FROM|WHERE|FOR UPDATE|UPDATE|SET|INSERT INTO|VALUES|COMMIT|ROLLBACK|AND)\b/g;
  function toMau(sql) {
    return sql.split("\n").map(dong => {
      const i = dong.indexOf("--");
      const ma = i >= 0 ? dong.slice(0, i) : dong;
      const cm = i >= 0 ? dong.slice(i) : "";
      return esc(ma).replace(TU_KHOA, '<span class="tk">$1</span>')
        + (cm ? `<span class="cm">${esc(cm)}</span>` : "");
    }).join("\n");
  }

  function capNhatMoTa() {
    const cd = $("#dv-che-do").value;
    $("#dv-mo-ta").innerHTML = MO_TA[cd] || "";
    $("#dv-ma").innerHTML = toMau(MA[cd] || "");
  }

  window.addEventListener("da-nap-thong-tin", ev => {
    const d = ev.detail;
    $("#dv-che-do").innerHTML = Object.entries(d.che_do)
      .map(([k, v]) => `<option value="${k}">${esc(v)}</option>`).join("");
    $("#dv-muc").innerHTML = `<option value="">Mặc định (REPEATABLE READ)</option>`
      + d.muc_co_lap.map(m => `<option>${esc(m)}</option>`).join("");
    capNhatMoTa();
  });
  $("#dv-che-do").addEventListener("change", capNhatMoTa);

  let du_lieu = null;

  $("#dv-chay").addEventListener("click", () => chayCo(
    $("#dv-chay"), $("#dv-trang-thai"), "Đang chạy các giao tác đồng thời…", async () => {
      dungPhat();
      du_lieu = await goiApi("/api/chay", {
        che_do: $("#dv-che-do").value,
        so_khach: +$("#dv-so-khach").value,
        ton_kho: +$("#dv-ton-kho").value,
        think_ms: +$("#dv-think").value,
        muc_co_lap: $("#dv-muc").value || null,
      });
      ["#dv-the-kq", "#dv-the-cabin", "#dv-the-tl", "#dv-the-khoa", "#dv-the-log"].forEach(s => $(s)?.classList.remove("an"));
      veTomTat();
      veCabin();
      veTimeline();
      veKhoa();
      veLog();
    }));

  /* ------------------------------------------------------------ tóm tắt */
  function theSo(nhan, gt, lop = "") {
    return `<div class="so ${lop}"><div class="nhan">${nhan}</div><div class="gt">${gt}</div></div>`;
  }

  function veTomTat() {
    const t = du_lieu.tom_tat;
    const kl = $("#dv-ket-luan");
    if (t.che_do === "deadlock") {
      $("#dv-so").innerHTML = theSo("Số khách", t.so_khach)
        + theSo("Giữ được 2 ghế", t.so_thanh_cong, "tot")
        + theSo("Bị hủy vì deadlock", t.so_deadlock, t.so_deadlock ? "xau" : "")
        + theSo("Hết giờ chờ khóa", t.so_het_gio, t.so_het_gio ? "canh-bao" : "")
        + theSo("Lần chờ khóa", t.so_lan_cho_khoa)
        + theSo("Thời gian", so(t.thoi_gian_ms) + " ms");
      const ghe = du_lieu.trang_thai_sau.ghe.map(g => `ghế ${esc(g.so_ghe)}: ${esc(g.nguoi_giu || "trống")}`).join(", ");
      kl.className = "ket-luan trung";
      kl.innerHTML = t.so_deadlock
        ? `<b>InnoDB đã phát hiện ${t.so_deadlock} lần deadlock.</b> Mỗi lần, hai giao tác giữ khóa của nhau
           và chờ nhau thành vòng tròn; InnoDB không đợi hết <code>innodb_lock_wait_timeout</code> mà phát hiện
           vòng chờ ngay, chọn một giao tác làm nạn nhân và ROLLBACK nó (lỗi 1213), nhờ vậy giao tác còn lại
           chạy tiếp được. Trạng thái cuối: ${ghe}.
           <div class="mo">Cách phòng tránh: mọi giao tác luôn khóa tài nguyên theo cùng một thứ tự (ví dụ ghế có mã nhỏ trước).</div>`
        : `<b>Lần này không xảy ra deadlock</b> – các giao tác tình cờ không đan xen đúng thời điểm.
           Hãy tăng thời gian cân nhắc rồi chạy lại. Trạng thái cuối: ${ghe}.`;
      return;
    }

    const sai = t.ban_vuot > 0 || !t.nhat_quan;
    $("#dv-so").innerHTML = theSo("Số ghế ban đầu", t.tong_ghe)
      + theSo("Vé đã bán", t.so_ve_da_ban, t.ban_vuot > 0 ? "xau" : "tot")
      + theSo("Ghế còn lại", t.so_ghe_con_lai, t.nhat_quan ? "" : "xau")
      + theSo("Bán vượt", t.ban_vuot, t.ban_vuot > 0 ? "xau" : "tot")
      + theSo("Thử lại", t.so_lan_thu_lai, t.so_lan_thu_lai ? "canh-bao" : "")
      + theSo("Lần chờ khóa", t.so_lan_cho_khoa, t.so_lan_cho_khoa ? "canh-bao" : "")
      + (t.so_deadlock ? theSo("Deadlock", t.so_deadlock, "xau") : "")
      + theSo("Thời gian", so(t.thoi_gian_ms) + " ms");

    kl.className = "ket-luan " + (sai ? "xau" : "tot");
    let noi;
    if (t.ban_vuot > 0) {
      noi = `<b>Dữ liệu đã sai.</b> ${t.so_khach} khách tranh ${t.tong_ghe} ghế, hệ thống bán ra
        ${t.so_ve_da_ban} vé – thừa ${t.ban_vuot} vé, trong khi cột số ghế còn lại vẫn báo ${t.so_ghe_con_lai}.
        Nhiều giao tác cùng đọc được một con số rồi cùng ghi đè cùng một giá trị: <b>mất cập nhật (lost update)</b>.
        Xem nhật ký: nhiều khách cùng "đọc được so_ghe_trong = ${t.tong_ghe}".`;
      if (t.muc_co_lap.startsWith("REPEATABLE") || t.muc_co_lap.startsWith("mặc định")) {
        noi += `<div class="mo">Lưu ý: đây là mức REPEATABLE READ – mức mặc định của MySQL vẫn không ngăn được lỗi này.</div>`;
      }
    } else if (!t.nhat_quan) {
      noi = `<b>Dữ liệu không nhất quán.</b> Ghế còn lại (${t.so_ghe_con_lai}) cộng vé đã bán (${t.so_ve_da_ban})
        không bằng tổng số ghế (${t.tong_ghe}).`;
    } else {
      noi = `<b>Dữ liệu đúng.</b> Bán ${t.so_ve_da_ban} vé trên ${t.tong_ghe} ghế, còn ${t.so_ghe_con_lai}.
        Ràng buộc "ghế còn + vé đã bán = tổng số ghế" được giữ nguyên dù ${t.so_khach} giao tác chạy đồng thời.`;
      const gia = [];
      if (t.so_lan_cho_khoa) gia.push(`${t.so_lan_cho_khoa} lần phải chờ khóa (tổng ${so(t.tong_thoi_gian_cho_khoa_ms)} ms)`);
      if (t.so_lan_thu_lai) gia.push(`${t.so_lan_thu_lai} lần giao tác bị hủy và thử lại`);
      if (t.so_deadlock) gia.push(`${t.so_deadlock} giao tác bị InnoDB hủy do deadlock`);
      if (t.so_bo_cuoc) gia.push(`${t.so_bo_cuoc} khách bỏ cuộc sau ${8} lần thử`);
      if (gia.length) noi += ` Cái giá phải trả: ${gia.join(", ")}.`;
    }
    kl.innerHTML = noi + `<div class="mo">Mức cô lập: ${esc(t.muc_co_lap)} · cách xử lý: ${esc(t.mo_ta_che_do)}</div>`;
  }

  /* ------------------------------------------------------------ biểu đồ */
  let tMax = 1, X = null, danh_sach_luong = [];

  function sapXepLuong(ds) {
    return [...new Set(ds)].sort((a, b) => (+a.replace(/\D/g, "") || 0) - (+b.replace(/\D/g, "") || 0));
  }

  function mocDep(max) {
    const tho = max / 6;
    const mu = Math.pow(10, Math.floor(Math.log10(tho)));
    const buoc = [1, 2, 5, 10].map(k => k * mu).find(b => b >= tho) || mu * 10;
    const kq = [];
    for (let v = 0; v <= max + 1e-9; v += buoc) kq.push(v);
    return kq;
  }

  function veTimeline() {
    const sk = du_lieu.su_kien;
    danh_sach_luong = sapXepLuong(sk.map(e => e.luong));
    tMax = Math.max(1, ...sk.map(e => e.ket_thuc));
    const khung = $("#timeline");
    const W = Math.max(680, khung.clientWidth || 900);
    const trai = 74, phai = 14, cao = 24, dinh = 24;
    X = t => trai + (t / tMax) * (W - trai - phai);
    const H = dinh + danh_sach_luong.length * cao + 8;

    let s = `<svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" style="font-family:inherit">`;
    danh_sach_luong.forEach((l, i) => {
      if (i % 2) s += `<rect x="0" y="${dinh + i * cao}" width="${W}" height="${cao}" fill="rgba(148, 163, 184, 0.07)"/>`;
    });
    mocDep(tMax).forEach(t => {
      s += `<line x1="${X(t)}" y1="${dinh - 6}" x2="${X(t)}" y2="${H - 8}" stroke="rgba(148, 163, 184, 0.18)"/>
            <text x="${X(t)}" y="${dinh - 10}" font-size="10.5" fill="#94a3b8" text-anchor="middle">${so(t)} ms</text>`;
    });
    danh_sach_luong.forEach((l, i) => {
      const y = dinh + i * cao;
      s += `<text class="nhan-luong" data-luong="${esc(l)}" x="${trai - 8}" y="${y + 16}" font-size="11.5"
              fill="#cbd5e1" text-anchor="end">${esc(l)}</text>`;
    });
    sk.forEach((e, idx) => {
      const i = danh_sach_luong.indexOf(e.luong);
      const y = dinh + i * cao;
      const x1 = X(e.bat_dau);
      const w = Math.max(3, X(e.ket_thuc) - x1);
      s += `<rect class="thanh" data-i="${idx}" x="${x1}" y="${y + 5}" width="${w}" height="14" rx="3"
              fill="${mauLoai(e.loai)}" opacity="${e.loai === "cho" ? 0.8 : 1}"/>`;
    });
    s += `<line id="dv-kim" x1="${X(0)}" y1="${dinh - 4}" x2="${X(0)}" y2="${H - 6}" stroke="#fbbf24"
            stroke-width="1.5" stroke-dasharray="4 3" opacity="0"/>`;
    s += `</svg>`;
    khung.innerHTML = s;

    const co = [...new Set(sk.map(e => e.loai))];
    $("#dv-chu-giai").innerHTML = Object.keys(LOAI).filter(k => co.includes(k)).map(k =>
      `<span><i class="o-mau" style="background:${LOAI[k][0]}"></i>${esc(LOAI[k][1])}</span>`).join("");

    $$("rect.thanh", khung).forEach(r => {
      r.addEventListener("mousemove", ev => {
        const e = sk[+r.dataset.i];
        const dai = e.ket_thuc - e.bat_dau;
        hienHop(ev, `<b>${esc(e.luong)} · ${esc(e.nhan)}</b>
          <div class="phu">${so(e.bat_dau, 1)} → ${so(e.ket_thuc, 1)} ms (${so(dai, 1)} ms)</div>
          ${e.sql ? `<code>${esc(e.sql)}</code>` : ""}
          ${e.ghi_chu ? `<div class="nhan-manh" style="margin-top:4px">${esc(e.ghi_chu)}</div>` : ""}`);
        danhDauNguoiChan(e.bi_chan_boi || []);
      });
      r.addEventListener("mouseleave", () => { anHop(); danhDauNguoiChan([]); });
    });

    const tua = $("#dv-tua");
    tua.max = tMax;
    tua.step = Math.max(0.5, tMax / 400);
    tua.value = tMax;
    datMoc(tMax, false);
  }

  function danhDauNguoiChan(ds) {
    $$("#timeline text.nhan-luong").forEach(t => {
      const co = ds.includes(t.dataset.luong);
      t.setAttribute("fill", co ? "#f87171" : "#cbd5e1");
      t.setAttribute("font-weight", co ? "700" : "400");
    });
  }

  /* ------------------------------------------------ tua / phát lại */
  const TRANG_THAI_CUOI = {
    thanh_cong: ["#16a34a", "✓ đặt được vé"], het_ve: ["#667085", "hết vé"],
    deadlock: ["#7f1d1d", "✗ bị hủy vì deadlock"], het_gio: ["#b45309", "✗ hết giờ chờ khóa"],
    bo_cuoc: ["#d97706", "✗ bỏ cuộc sau nhiều lần thử"], loi: ["#dc2626", "✗ lỗi"],
  };

  function datMoc(t, hien_kim = true) {
    if (!du_lieu) return;
    const kim = $("#dv-kim");
    if (kim) {
      kim.setAttribute("x1", X(t)); kim.setAttribute("x2", X(t));
      kim.setAttribute("opacity", hien_kim ? 1 : 0);
    }
    $("#dv-moc").textContent = `${so(t, 0)} ms`;

    const sk = du_lieu.su_kien;
    const la_dl = du_lieu.tom_tat.che_do === "deadlock";
    const da_commit = sk.filter(e => e.loai === "commit" && e.ket_thuc <= t).length;
    const tong = du_lieu.tom_tat.tong_ghe;
    const vuot = !la_dl && da_commit > tong;
    let html = `<div class="tieu-de-t">Tại <b>${so(t, 0)} ms</b>:
      ${la_dl ? `${da_commit} giao tác đã commit`
              : `đã commit <b style="color:${vuot ? "var(--do)" : "inherit"}">${da_commit}</b> vé trên ${tong} ghế
                 ${vuot ? '<b style="color:var(--do)"> – đã bán vượt!</b>' : ""}`}</div>`;
    danh_sach_luong.forEach(l => {
      const cua = sk.filter(e => e.luong === l);
      // một câu lệnh đã kết thúc đúng tại t thì không còn "đang chạy" nữa
      const dang = cua.find(e => e.bat_dau <= t && t < e.ket_thuc);
      let mau, chu;
      if (dang) {
        mau = mauLoai(dang.loai);
        chu = dang.nhan + (dang.loai === "cho_khoa" && dang.bi_chan_boi?.length ? ` – chờ ${dang.bi_chan_boi.join(", ")}` : "");
      } else if (!cua.length || t < cua[0].bat_dau) {
        mau = "#e5e7eb"; chu = "chưa bắt đầu";
      } else if (t >= cua[cua.length - 1].ket_thuc) {
        const kq = du_lieu.ket_qua_khach[l] || {};
        [mau, chu] = TRANG_THAI_CUOI[kq.trang_thai] || ["#98a2b3", "đã xong"];
      } else {
        const truoc = cua.filter(e => e.ket_thuc <= t).pop();
        mau = "#e5e7eb"; chu = truoc ? `vừa xong: ${truoc.nhan}` : "…";
      }
      html += `<div class="khach"><i class="o-mau" style="background:${mau}"></i><b>${esc(l)}</b><span class="nd" title="${esc(chu)}">${esc(chu)}</span></div>`;
    });
    $("#dv-tai-t").innerHTML = html;
  }

  $("#dv-tua").addEventListener("input", e => { dungPhat(); datMoc(+e.target.value); });

  let khung_hinh = null;
  function dungPhat() {
    if (khung_hinh) cancelAnimationFrame(khung_hinh);
    khung_hinh = null;
    $("#dv-phat").textContent = "▶ Phát lại";
  }
  $("#dv-phat").addEventListener("click", () => {
    if (!du_lieu) return;
    if (khung_hinh) { dungPhat(); return; }
    const thoi_luong = Math.min(9000, Math.max(3500, tMax * 4));
    const bat_dau = performance.now();
    $("#dv-phat").textContent = "⏸ Dừng";
    const buoc = now => {
      const t = Math.min(tMax, ((now - bat_dau) / thoi_luong) * tMax);
      $("#dv-tua").value = t;
      datMoc(t);
      if (t < tMax) khung_hinh = requestAnimationFrame(buoc);
      else dungPhat();
    };
    khung_hinh = requestAnimationFrame(buoc);
  });

  window.addEventListener("resize", () => {
    if (du_lieu && !$("#tab-datve").hidden) { veTimeline(); }
  });
  window.addEventListener("doi-tab", ev => {
    if (ev.detail === "datve" && du_lieu) veTimeline();
    else dungPhat();
  });

  /* ------------------------------------------------------------ khóa + log */
  function veKhoa() {
    const k = du_lieu.khoa_quan_sat;
    $("#dv-bang-khoa").innerHTML = k.length
      ? bangKhoa(k, { cot_ten: "ten", ten_cot: "Giao tác", co_moc: true }).replace(/^<table>|<\/table>$/g, "")
      : `<tr><td style="color:var(--mo);padding:12px">Không bắt được khóa nào. Ở chế độ này các giao tác giữ khóa
         quá ngắn (vài mili giây) so với chu kỳ lấy mẫu. Thử chế độ khóa bi quan hoặc tăng thời gian cân nhắc.</td></tr>`;
  }

  function veLog() {
    const loc = $("#dv-loc");
    const cu = loc.value;
    loc.innerHTML = `<option value="">Tất cả</option>`
      + sapXepLuong(du_lieu.su_kien.map(e => e.luong)).map(l => `<option ${l === cu ? "selected" : ""}>${esc(l)}</option>`).join("");
    locLog();
  }
  function locLog() {
    if (!du_lieu) return;
    const l = $("#dv-loc").value;
    const ds = du_lieu.su_kien.filter(e => !l || e.luong === l);
    $("#dv-bang-log").innerHTML =
      `<tr><th>Mốc (ms)</th><th>Kéo dài</th><th>Giao tác</th><th>Việc</th><th>Câu lệnh</th><th>Ghi chú</th></tr>`
      + ds.map(e => {
        const m = mauLoai(e.loai);
        return `<tr><td class="so-lieu">${so(e.bat_dau, 1)}</td>
          <td class="so-lieu">${so(e.ket_thuc - e.bat_dau, 1)}</td>
          <td style="white-space:nowrap">${esc(e.luong)}</td>
          <td><span class="nhan-mau" style="background:${m}1f;color:${m === "#d0d5dd" ? "#667085" : m}">${esc(e.nhan)}</span></td>
          <td>${e.sql ? `<code>${esc(e.sql)}</code>` : "—"}</td>
          <td style="color:var(--mo)">${esc(e.ghi_chu || "")}</td></tr>`;
      }).join("");
  }
  $("#dv-loc").addEventListener("change", locLog);

  /* ------------------------------------------------------------ sơ đồ cabin máy bay */
  function veCabin() {
    const t = du_lieu.tom_tat;
    const grid = $("#cabin-seats-grid");
    if (!grid) return;

    $("#cabin-status-tag").textContent = `Chuyến bay VN-808 (HAN - SGN) · Chế độ: ${TEN_NGAN[t.che_do] || t.che_do}`;

    if (t.che_do === "deadlock") {
      const gheData = (du_lieu.trang_thai_sau && du_lieu.trang_thai_sau.ghe) || [];
      let html = "";
      for (const g of gheData) {
        const nguoiGiu = g.nguoi_giu;
        const trangThai = nguoiGiu ? "deadlock" : "available";
        html += `<div class="seat-card ${trangThai}" data-seat="${esc(g.so_ghe)}" data-passenger="${esc(nguoiGiu || 'Chưa ai giữ')}" data-status="${trangThai}">
          <div class="seat-card-top">
            <span class="seat-code">Ghế ${esc(g.so_ghe)}</span>
            <span class="seat-icon">💺</span>
          </div>
          <div class="seat-card-passenger">${esc(nguoiGiu ? 'Giữ bởi: ' + nguoiGiu : 'Ghế trống')}</div>
          <span class="seat-card-status">${nguoiGiu ? '🔒 Tranh chấp Deadlock' : 'Trống'}</span>
        </div>`;
      }
      grid.innerHTML = html;
      attachSeatClickHandlers();
      return;
    }

    const tongGhe = Math.min(60, t.tong_ghe || 5);
    const kqKhach = du_lieu.ket_qua_khach || {};
    const khachThanhCong = Object.entries(kqKhach)
      .filter(([_, k]) => k.trang_thai === "thanh_cong")
      .map(([ten, k]) => ({ ten, ...k }));

    const hangCols = ["A", "B", "C", "D", "E", "F"];
    const seatItems = [];

    for (let i = 0; i < tongGhe; i++) {
      const row = Math.floor(i / 6) + 1;
      const col = hangCols[i % 6];
      const code = `${row}${col}`;
      seatItems.push({ code, passengers: [], status: "available" });
    }

    if (t.ban_vuot > 0) {
      khachThanhCong.forEach((kh, idx) => {
        const slotIdx = idx % tongGhe;
        seatItems[slotIdx].passengers.push(kh.ten);
      });
      seatItems.forEach(s => {
        if (s.passengers.length > 1) {
          s.status = "overbooked";
        } else if (s.passengers.length === 1) {
          s.status = "booked";
        }
      });
    } else {
      khachThanhCong.forEach((kh, idx) => {
        if (idx < seatItems.length) {
          seatItems[idx].passengers.push(kh.ten);
          seatItems[idx].status = "booked";
        }
      });
    }

    let html = seatItems.map(s => {
      let statusText = "Ghế trống";
      let passText = "Chưa có khách";
      if (s.status === "booked") {
        statusText = "✓ Đã xuất vé";
        passText = s.passengers[0];
      } else if (s.status === "overbooked") {
        statusText = `⚠️ BÁN TRÙNG ${s.passengers.length} VÉ!`;
        passText = s.passengers.join(" & ");
      }
      return `<div class="seat-card ${s.status}" data-seat="${esc(s.code)}" data-passenger="${esc(passText)}" data-status="${s.status}" data-count="${s.passengers.length}">
        <div class="seat-card-top">
          <span class="seat-code">${esc(s.code)}</span>
          <span class="seat-icon">${s.status === 'overbooked' ? '⚠️' : '💺'}</span>
        </div>
        <div class="seat-card-passenger" title="${esc(passText)}">${esc(passText)}</div>
        <span class="seat-card-status">${esc(statusText)}</span>
      </div>`;
    }).join("");

    if (t.tong_ghe > 60) {
      html += `<div style="grid-column:1/-1;text-align:center;padding:10px;color:var(--mo);font-size:12px">
        Hiển thị 60 ghế đầu tiên của khoang máy bay (Tổng mở bán: ${t.tong_ghe} ghế)
      </div>`;
    }

    grid.innerHTML = html;
    attachSeatClickHandlers();
  }

  function attachSeatClickHandlers() {
    $$("#cabin-seats-grid .seat-card").forEach(c => {
      c.addEventListener("click", () => {
        hienBoardingPass(c.dataset.seat, c.dataset.passenger, c.dataset.status);
      });
    });
  }

  function hienBoardingPass(seatCode, passengerName, status) {
    const modal = $("#modal-ve-may-bay");
    const content = $("#modal-ve-content");
    if (!modal || !content) return;

    const t = du_lieu ? du_lieu.tom_tat : {};
    let statusBadge = `<span style="background:#10b981;color:#041226;padding:3px 10px;border-radius:6px;font-weight:800">✓ ĐÃ XUẤT VÉ HỢP LỆ</span>`;
    let warningNote = "";

    if (status === "overbooked") {
      statusBadge = `<span style="background:#f43f5e;color:#fff;padding:3px 10px;border-radius:6px;font-weight:800">⚠️ BÁN VƯỢT / MẤT CẬP NHẬT</span>`;
      warningNote = `<div style="margin-top:14px;background:rgba(244,63,94,0.18);border:1px solid #f43f5e;padding:12px 14px;border-radius:8px;font-size:12.5px;color:#fda4af;line-height:1.5">
        <b>Phát hiện lỗi mất cập nhật (Lost Update):</b> Do không sử dụng khóa (SELECT thường thay vì SELECT ... FOR UPDATE), nhiều giao tác cùng đọc thấy ghế còn trống và cùng ghi đè cập nhật. Hệ thống đã xuất trùng ghế này cho: <b>${esc(passengerName)}</b>!
      </div>`;
    } else if (status === "deadlock") {
      statusBadge = `<span style="background:#a855f7;color:#fff;padding:3px 10px;border-radius:6px;font-weight:800">🔒 TRANH CHẤP DEADLOCK</span>`;
      warningNote = `<div style="margin-top:14px;background:rgba(168,85,247,0.18);border:1px solid #a855f7;padding:12px 14px;border-radius:8px;font-size:12.5px;color:#e9d5ff;line-height:1.5">
        <b>Xảy ra deadlock:</b> Hai giao tác cùng khóa tài nguyên ngược thứ tự (khách lẻ 1→2, khách chẵn 2→1), tạo chu trình chờ khóa. InnoDB đã phát hiện và tự động ROLLBACK một giao tác để giải phóng khóa.
      </div>`;
    } else if (status === "available") {
      statusBadge = `<span style="background:#64748b;color:#fff;padding:3px 10px;border-radius:6px;font-weight:800">⚪ GHẾ TRỐNG CHƯA BÁN</span>`;
    }

    content.innerHTML = `
      <div style="background:rgba(15,23,42,0.95);border:1px solid rgba(56,189,248,0.35);border-radius:12px;padding:22px;box-shadow:0 8px 30px rgba(0,0,0,0.6)">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:1px dashed rgba(255,255,255,0.15);padding-bottom:12px;margin-bottom:16px">
          <div>
            <div style="font-family:'Outfit',sans-serif;font-size:17px;font-weight:800;color:#38bdf8">✈ SKYFLIGHT AIRWAYS</div>
            <div style="font-size:11.5px;color:#94a3b8">BOARDING PASS &bull; THẺ LÊN MÁY BAY ĐIỆN TỬ</div>
          </div>
          <div>${statusBadge}</div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px 20px">
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Hành khách</div>
            <div style="font-family:'Outfit',sans-serif;font-size:16px;font-weight:700;color:#fff;margin-top:2px">${esc(passengerName)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Chuyến bay</div>
            <div style="font-family:'JetBrains Mono',monospace;font-size:16px;font-weight:700;color:#38bdf8;margin-top:2px">VN-808</div>
          </div>
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Lộ trình bay</div>
            <div style="font-size:14px;font-weight:700;color:#fff;margin-top:2px">Hà Nội (HAN) ➔ Sài Gòn (SGN)</div>
          </div>
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Số ghế chỉ định</div>
            <div style="font-family:'Outfit',sans-serif;font-size:20px;font-weight:800;color:#34d399;margin-top:2px">${esc(seatCode)}</div>
          </div>
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Cửa ra tàu bay (Gate)</div>
            <div style="font-size:14px;font-weight:700;color:#fff;margin-top:2px">B24 &bull; Giờ lên: 14:00</div>
          </div>
          <div>
            <div style="font-size:11px;color:#94a3b8;text-transform:uppercase">Mức cô lập CSDL</div>
            <div style="font-size:12.5px;font-weight:600;color:#cbd5e1;margin-top:2px">${esc(t.muc_co_lap || 'REPEATABLE READ')}</div>
          </div>
        </div>

        ${warningNote}

        <div style="margin-top:20px;background:rgba(2,6,23,0.8);padding:10px 14px;border-radius:8px;display:flex;justify-content:space-between;align-items:center;border:1px solid rgba(255,255,255,0.08)">
          <div style="font-family:'JetBrains Mono',monospace;font-size:11px;color:#64748b">
            TXN-HASH: ${Math.random().toString(36).substring(2, 10).toUpperCase()} &bull; ENGINE: INNODB 9.6
          </div>
          <button class="phu" style="font-size:12px;padding:4px 14px" id="btn-close-pass">Đóng thẻ</button>
        </div>
      </div>
    `;
    modal.classList.remove("an");
    $("#btn-close-pass")?.addEventListener("click", () => modal.classList.add("an"));
  }

  // Modal event listeners
  $("#modal-ve-close")?.addEventListener("click", () => $("#modal-ve-may-bay")?.classList.add("an"));
  $("#modal-ve-may-bay")?.addEventListener("click", ev => {
    if (ev.target === $("#modal-ve-may-bay")) $("#modal-ve-may-bay").classList.add("an");
  });
  $("#btn-open-cabin-3d")?.addEventListener("click", () => $("#modal-cabin-3d")?.classList.remove("an"));
  $("#modal-cabin-close")?.addEventListener("click", () => $("#modal-cabin-3d")?.classList.add("an"));
  $("#modal-cabin-3d")?.addEventListener("click", ev => {
    if (ev.target === $("#modal-cabin-3d")) $("#modal-cabin-3d").classList.add("an");
  });
})();
