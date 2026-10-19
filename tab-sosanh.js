/* Tab 3 – so sánh hiệu năng các cách xử lý tranh chấp */
(() => {
  const THU_TU = ["khong_khoa", "bi_quan", "lac_quan", "nguyen_tu"];

  /* -------------------------------------------------- so sánh cùng điều kiện */
  $("#ss-chay").addEventListener("click", () => {
    const so_lan = +$("#ss-lan").value;
    chayCo($("#ss-chay"), $("#ss-trang-thai"), `Đang chạy 4 cách × ${so_lan} lần…`, async () => {
      const d = await goiApi("/api/so-sanh", {
        so_khach: +$("#ss-so-khach").value, ton_kho: +$("#ss-ton-kho").value,
        think_ms: +$("#ss-think").value, so_lan,
      });
      veSoSanh(d);
    });
  });

  function veSoSanh(d) {
    const k = d.ket_qua;
    const cot = (truong, extra = () => ({})) => THU_TU.map(cd => ({
      nhan: TEN_NGAN[cd], gt: k[cd][truong], mau: MAU_CHE_DO[cd], ...extra(cd),
    }));
    const bieu_do = [
      ["Thời gian trung bình (ms) – vạch đen: nhỏ nhất → lớn nhất",
        bieuDoCot(cot("thoi_gian_tb", cd => ({ min: k[cd].thoi_gian_min, max: k[cd].thoi_gian_max })))],
      ["Số vé bán vượt (trung bình mỗi lần)", bieuDoCot(cot("ban_vuot_tb"), { chu_so: 1 })],
      ["Số lần thử lại (trung bình)", bieuDoCot(cot("thu_lai_tb"), { chu_so: 1 })],
      ["Số lần phải chờ khóa (trung bình)", bieuDoCot(cot("cho_khoa_tb"), { chu_so: 1 })],
    ];
    $("#ss-bieu-do").innerHTML = bieu_do.map(([t, svg]) =>
      `<div class="bieu-do"><h3>${esc(t)}</h3>${svg}</div>`).join("");

    const dk = d.dieu_kien;
    $("#ss-bang").innerHTML = `<tr><th>Cách xử lý</th><th>Thời gian TB</th><th>Nhanh nhất – chậm nhất</th>
      <th>Vé bán TB</th><th>Bán vượt TB</th><th>Số lần cho kết quả sai</th><th>Thử lại TB</th>
      <th>Chờ khóa TB</th><th>Deadlock TB</th></tr>`
      + THU_TU.map(cd => {
        const r = k[cd];
        return `<tr><td><i class="o-mau" style="background:${MAU_CHE_DO[cd]};margin-right:6px;vertical-align:-1px"></i><b>${esc(r.mo_ta)}</b></td>
          <td class="so-lieu"><b>${so(r.thoi_gian_tb)} ms</b></td>
          <td class="so-lieu">${so(r.thoi_gian_min)} – ${so(r.thoi_gian_max)} ms</td>
          <td class="so-lieu">${so(r.ve_ban_tb, 1)}</td>
          <td class="so-lieu" style="color:${r.ban_vuot_tb ? "var(--do)" : "inherit"}">${so(r.ban_vuot_tb, 1)}</td>
          <td class="so-lieu" style="color:${r.so_lan_sai ? "var(--do)" : "var(--luc)"}"><b>${r.so_lan_sai} / ${r.so_lan_chay}</b></td>
          <td class="so-lieu">${so(r.thu_lai_tb, 1)}</td><td class="so-lieu">${so(r.cho_khoa_tb, 1)}</td>
          <td class="so-lieu">${so(r.deadlock_tb, 1)}</td></tr>`;
      }).join("");

    const dung = THU_TU.filter(cd => k[cd].so_lan_sai === 0);
    const nhanh = [...dung].sort((a, b) => k[a].thoi_gian_tb - k[b].thoi_gian_tb);
    let nx = `<b>Nhận xét</b> (${dk.so_khach} khách, ${dk.ton_kho} ghế, cân nhắc ${dk.think_ms} ms, lặp ${dk.so_lan} lần):<ul style="margin:6px 0 0;padding-left:20px">`;
    if (k.khong_khoa.so_lan_sai) {
      nx += `<li>Không dùng khóa cho kết quả sai ở <b>${k.khong_khoa.so_lan_sai}/${k.khong_khoa.so_lan_chay}</b> lần chạy,
        trung bình bán vượt ${so(k.khong_khoa.ban_vuot_tb, 1)} vé. Nhanh nhưng vô dụng vì dữ liệu sai.</li>`;
    } else {
      nx += `<li>Lần này cách không khóa tình cờ không sai – hãy tăng thời gian cân nhắc hoặc số khách để tranh chấp rõ hơn.</li>`;
    }
    if (nhanh.length >= 2) {
      const a = nhanh[0], b = nhanh[nhanh.length - 1];
      nx += `<li>Trong các cách cho kết quả đúng, <b>${esc(TEN_NGAN[a])}</b> nhanh nhất (${so(k[a].thoi_gian_tb)} ms),
        <b>${esc(TEN_NGAN[b])}</b> chậm nhất (${so(k[b].thoi_gian_tb)} ms) – chậm hơn
        <b>${so(k[b].thoi_gian_tb / Math.max(1, k[a].thoi_gian_tb), 1)} lần</b>.</li>`;
    }
    if (k.bi_quan.cho_khoa_tb) {
      nx += `<li>Khóa bi quan phải chờ khóa trung bình ${so(k.bi_quan.cho_khoa_tb, 1)} lần mỗi lượt chạy: các giao tác
        bị xếp hàng, mỗi khách giữ khóa suốt thời gian cân nhắc.</li>`;
    }
    if (k.lac_quan.thu_lai_tb) {
      nx += `<li>Khóa lạc quan không phải chờ nhưng phải thử lại trung bình ${so(k.lac_quan.thu_lai_tb, 1)} lần – chi phí
        này tăng nhanh khi tranh chấp cao.</li>`;
    }
    $("#ss-nhan-xet").innerHTML = nx + `</ul>`;
    $("#ss-kq").classList.remove("an");
  }

  /* -------------------------------------------------- khảo sát theo số khách */
  $("#ks-chay").addEventListener("click", () => {
    const cac_muc = $("#ks-muc").value.split(/[,;\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
    if (!cac_muc.length) {
      $("#ks-trang-thai").className = "trang-thai loi";
      $("#ks-trang-thai").textContent = "Nhập các mức số khách, ví dụ: 5, 10, 20, 40";
      return;
    }
    chayCo($("#ks-chay"), $("#ks-trang-thai"), `Đang khảo sát ${cac_muc.length} mức × 4 cách…`, async () => {
      const d = await goiApi("/api/khao-sat", { cac_muc, think_ms: +$("#ks-think").value });
      veKhaoSat(d);
    });
  });

  function veKhaoSat(d) {
    const xs = d.cac_muc;
    const chuoi_tg = THU_TU.map(cd => ({
      ten: TEN_NGAN[cd], mau: MAU_CHE_DO[cd], ys: d.chuoi[cd].map(p => p.thoi_gian_ms),
    }));
    const chuoi_gia = [
      { ten: "Vé bán vượt – không khóa", mau: MAU_CHE_DO.khong_khoa, ys: d.chuoi.khong_khoa.map(p => p.ban_vuot) },
      { ten: "Lần chờ khóa – bi quan", mau: MAU_CHE_DO.bi_quan, ys: d.chuoi.bi_quan.map(p => p.cho_khoa) },
      { ten: "Lần thử lại – lạc quan", mau: MAU_CHE_DO.lac_quan, ys: d.chuoi.lac_quan.map(p => p.thu_lai) },
    ];
    $("#ks-bieu-do").innerHTML =
      `<div class="bieu-do"><h3>Tổng thời gian xử lý</h3>
         ${bieuDoDuong(xs, chuoi_tg, { nhan_x: "Số khách đồng thời", don_vi: "ms" })}${chuGiaiChuoi(chuoi_tg)}</div>
       <div class="bieu-do"><h3>Cái giá riêng của từng cách</h3>
         ${bieuDoDuong(xs, chuoi_gia, { nhan_x: "Số khách đồng thời", don_vi: "số lần" })}${chuGiaiChuoi(chuoi_gia)}</div>`;

    $("#ks-bang").innerHTML = `<tr><th>Số khách</th><th>Số ghế</th>${THU_TU.map(cd =>
      `<th style="color:${MAU_CHE_DO[cd]}">${esc(TEN_NGAN[cd])}</th>`).join("")}</tr>`
      + xs.map((x, i) => `<tr><td class="so-lieu"><b>${x}</b></td><td class="so-lieu">${d.chuoi.khong_khoa[i].ton_kho}</td>
        ${THU_TU.map(cd => {
          const p = d.chuoi[cd][i];
          const phu = cd === "khong_khoa" ? (p.ban_vuot ? `<span style="color:var(--do)"> · vượt ${p.ban_vuot}</span>` : "")
            : cd === "bi_quan" ? ` · chờ ${p.cho_khoa}`
            : cd === "lac_quan" ? ` · thử lại ${p.thu_lai}${p.bo_cuoc ? `, bỏ cuộc ${p.bo_cuoc}` : ""}` : "";
          return `<td class="so-lieu">${so(p.thoi_gian_ms)} ms<span style="color:var(--mo)">${phu}</span></td>`;
        }).join("")}</tr>`).join("");
    $("#ks-kq").classList.remove("an");
  }
})();
