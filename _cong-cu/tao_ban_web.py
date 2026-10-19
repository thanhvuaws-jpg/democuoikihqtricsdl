"""Dựng bản web tĩnh từ giao diện của bản demo gốc.

Chỉ ĐỌC thư mục ../demo-dongthoi/app/static (không sửa gì ở đó): chép chung.js, tab-*.js, style.css sang đây
nguyên vẹn; riêng index.html được chỉnh đường dẫn, thêm khung giới thiệu bản web và nạp che-do-web.js.

    python _cong-cu/tao_ban_web.py
"""
import re
import shutil
from pathlib import Path

GOC = Path(__file__).resolve().parent.parent
NGUON = GOC.parent / "demo-dongthoi" / "app" / "static"
REPO_GOC = "https://github.com/thanhvuaws-jpg/hequantricosodemodongthoi"

KHUNG_WEB = f"""  <!-- ===== bản web tĩnh ===== -->
  <div class="bang-web" role="note">
    <span class="bieu-tuong">🌐</span>
    <div>
      <b>Bản web xem trực tuyến</b> – trang này chỉ gồm HTML, CSS và JavaScript, không có máy chủ.
      Mọi lịch giao tác, dữ liệu, bảng khóa và số đo thời gian là <b>kết quả đã chạy thật trên MySQL 9.6 /
      InnoDB</b> rồi ghi lại; các ô cấu hình chỉ cho chọn những cấu hình đã chạy sẵn.
      Muốn tự chạy trực tiếp trên MySQL: tải mã nguồn tại <a href="{REPO_GOC}" target="_blank" rel="noopener">GitHub</a>
      và nhấp đúp <code>khoi-dong.bat</code>.
    </div>
  </div>
"""


def thay_mot_lan(s, cu, moi):
    assert s.count(cu) == 1, cu
    return s.replace(cu, moi)


def main():
    for tep in ["chung.js", *sorted(p.name for p in NGUON.glob("tab-*.js"))]:
        shutil.copy2(NGUON / tep, GOC / tep)
    # ảnh nền khung giới thiệu không có trong mã nguồn gốc (thư mục images trống) → bỏ để không báo lỗi 404;
    # khung vẫn dùng màu nền dự phòng như bản gốc
    css = (NGUON / "style.css").read_text(encoding="utf-8")
    css = thay_mot_lan(css, "  background-image: url('/static/images/flight_hero_bg.jpg');\n", "")
    (GOC / "style.css").write_text(css, encoding="utf-8")

    html = (NGUON / "index.html").read_text(encoding="utf-8")
    html = html.replace('"/static/', '"')
    html = thay_mot_lan(html, "<title>SkyFlight Airways ✈ Demo Điều Khiển Truy Xuất Đồng Thời — MySQL/InnoDB</title>",
                        "<title>SkyFlight Airways ✈ Demo Điều Khiển Truy Xuất Đồng Thời — bản web</title>")
    html = thay_mot_lan(html, '<link rel="stylesheet" href="style.css">',
                        '<link rel="stylesheet" href="style.css">\n<link rel="stylesheet" href="che-do-web.css">')
    html = thay_mot_lan(html, '<script src="chung.js"></script>',
                        '<script src="chung.js"></script>\n<script src="che-do-web.js"></script>')
    html = thay_mot_lan(html, "<main>\n", "<main>\n" + KHUNG_WEB)
    # ảnh khoang 3D không có trong mã nguồn gốc (thư mục images trống) → bỏ nút mở và hộp xem ảnh
    html, n = re.subn(r'\s*<button[^>]*id="btn-open-cabin-3d"[^>]*>.*?</button>', "", html, flags=re.S)
    assert n == 1
    html, n = re.subn(r"<!-- Modal xem hình ảnh khoang ghế 3D -->.*?(?=<script)", "", html, flags=re.S)
    assert n == 1
    (GOC / "index.html").write_text(html, encoding="utf-8")
    (GOC / ".nojekyll").write_text("", encoding="utf-8")
    print("Đã dựng bản web tại", GOC)


if __name__ == "__main__":
    main()
