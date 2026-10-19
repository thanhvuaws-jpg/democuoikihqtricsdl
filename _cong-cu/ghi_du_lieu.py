"""Ghi lại kết quả chạy THẬT trên MySQL thành dữ liệu tĩnh cho bản web (không cần máy chủ).

Cần bản demo gốc (thư mục demo-dongthoi) đang chạy tại http://localhost:8010 – nhấp đúp khoi-dong.bat.

    python _cong-cu/ghi_du_lieu.py

Mỗi kết quả được lưu thành một tệp du-lieu/<khóa>.js gán vào window.DU_LIEU[<khóa>]. Dùng tệp .js thay vì
.json để trang chạy được cả khi mở thẳng index.html (file://), lẫn trên GitHub Pages.
Danh sách cấu hình phải khớp với che-do-web.js.
"""
import json
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = "http://localhost:8010"
GOC = Path(__file__).resolve().parent.parent
DL = GOC / "du-lieu"

MUC_CO_LAP = ["READ UNCOMMITTED", "READ COMMITTED", "REPEATABLE READ", "SERIALIZABLE"]
CHE_DO = ["khong_khoa", "bi_quan", "lac_quan", "nguyen_tu", "deadlock"]
# tab 2 – nhiều khách đặt vé: (số khách, số ghế); thời gian cân nhắc cố định
QUY_MO = [(6, 3), (10, 5), (20, 10), (40, 20), (60, 30)]
THINK_DAT_VE = 100
QUY_MO_CO_MUC = (10, 5)        # chỉ quy mô này có đủ 4 mức cô lập
# tab 4 – so sánh: (số khách, số ghế, cân nhắc, số lần lặp); khảo sát: (các mức số khách, cân nhắc)
SO_SANH = [(10, 5, 80, 3), (20, 10, 80, 3), (40, 20, 80, 3)]
KHAO_SAT = [([5, 10, 20, 40], 50), ([5, 10, 20, 40, 60], 50)]


def ten_muc(m):
    return m.replace(" ", "_") if m else "mac_dinh"


def goi(duong_dan, than=None):
    """Gọi API; máy chủ chỉ cho chạy một kịch bản mỗi lúc (409) nên thử lại nếu đang bận."""
    for _ in range(30):
        yc = urllib.request.Request(API + duong_dan, method="GET" if than is None else "POST")
        du_lieu = None
        if than is not None:
            yc.add_header("Content-Type", "application/json")
            du_lieu = json.dumps(than).encode()
        try:
            with urllib.request.urlopen(yc, du_lieu, timeout=600) as r:
                return json.loads(r.read())
        except urllib.error.HTTPError as e:
            if e.code != 409:
                raise SystemExit(f"{duong_dan} {than}: lỗi {e.code} {e.read()[:300]!r}")
            time.sleep(2)
    raise SystemExit(f"{duong_dan}: máy chủ bận quá lâu")


def luu(khoa, du_lieu):
    tep = DL / f"{khoa}.js"
    tep.parent.mkdir(parents=True, exist_ok=True)
    noi_dung = json.dumps(du_lieu, ensure_ascii=False, separators=(",", ":"))
    tep.write_text(f"(window.DU_LIEU = window.DU_LIEU || {{}})[{json.dumps(khoa)}] = {noi_dung};\n",
                   encoding="utf-8")
    print(f"  {khoa:55s} {len(noi_dung) / 1024:8.1f} KB", flush=True)


def main():
    try:
        tt = goi("/api/thong-tin")
    except urllib.error.URLError:
        sys.exit(f"Không gọi được {API} – hãy chạy bản demo gốc (khoi-dong.bat) trước.")
    luu("thong-tin", tt)

    print("Tab 1 – năm xung đột")
    ds = goi("/api/xung-dot")
    luu("xung-dot", ds)
    for ma in ds["xung_dot"]:
        for loai in ("sai", "dung"):
            luu(f"xung-dot/{ma}_{loai}", goi("/api/xung-dot/chay", {"ma": ma, "loai": loai}))

    print("Tab 3 – ma trận mức cô lập")
    tn = goi("/api/thi-nghiem")
    luu("thi-nghiem", tn)
    for ma in tn["thi_nghiem"]:
        for muc in MUC_CO_LAP:
            luu(f"thi-nghiem/{ma}_{ten_muc(muc)}", goi("/api/thi-nghiem/chay", {"ma": ma, "muc_co_lap": muc}))
    luu("ma-tran", goi("/api/thi-nghiem/ma-tran", {}))

    print("Tab 2 – nhiều khách đặt vé")
    for che_do in CHE_DO:
        for so_khach, ton_kho in QUY_MO:
            cac_muc = [None] + (MUC_CO_LAP if (so_khach, ton_kho) == QUY_MO_CO_MUC else [])
            for muc in cac_muc:
                kq = goi("/api/chay", {"che_do": che_do, "so_khach": so_khach, "ton_kho": ton_kho,
                                       "think_ms": THINK_DAT_VE, "muc_co_lap": muc})
                # mẫu khóa thô lấy 25 ms một lần (tới vài MB) – giao diện không đọc, chỉ dùng su_kien đã tổng hợp
                kq.pop("cho_khoa", None)
                luu(f"dat-ve/{che_do}_{so_khach}_{ton_kho}_{THINK_DAT_VE}_{ten_muc(muc)}", kq)

    print("Tab 4 – so sánh hiệu năng và khảo sát chịu tải")
    for so_khach, ton_kho, think, so_lan in SO_SANH:
        kq = goi("/api/so-sanh", {"so_khach": so_khach, "ton_kho": ton_kho, "think_ms": think, "so_lan": so_lan})
        luu(f"so-sanh/{so_khach}_{ton_kho}_{think}_{so_lan}", kq)
    for cac_muc, think in KHAO_SAT:
        kq = goi("/api/khao-sat", {"cac_muc": cac_muc, "think_ms": think})
        luu(f"khao-sat/{'-'.join(map(str, cac_muc))}_{think}", kq)
    print("Xong.")


if __name__ == "__main__":
    main()
