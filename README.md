# Demo điều khiển truy xuất đồng thời – bản web

Bản xem trực tuyến của demo **Điều khiển truy xuất đồng thời trong MySQL/InnoDB** (ứng dụng đặt vé máy bay
SkyFlight). Trang chỉ gồm HTML, CSS và JavaScript, **không cần máy chủ, không cần MySQL** – mở được trên GitHub
Pages hoặc nhấp đúp `index.html` trên máy.

Mọi lịch giao tác, dữ liệu, bảng khóa và số đo thời gian trên trang là **kết quả đã chạy thật trên MySQL 9.6 /
InnoDB** bằng bản demo gốc rồi ghi lại vào thư mục `du-lieu/`. Vì vậy các ô cấu hình chỉ cho chọn những cấu hình
đã chạy sẵn. Muốn tự chạy trực tiếp trên MySQL, dùng bản gốc:
<https://github.com/thanhvuaws-jpg/hequantricosodemodongthoi> (nhấp đúp `khoi-dong.bat`).

## Nội dung

| Tab | Có sẵn trên bản web |
|---|---|
| 1. Năm xung đột: sai và đúng | Đủ 5 xung đột × 2 kịch bản (sai / đúng), phát lại từng bước |
| 2. Nhiều khách đặt vé | 5 cách xử lý × 5 quy mô (6, 10, 20, 40, 60 khách; số ghế bằng một nửa); quy mô 10 khách có đủ 4 mức cô lập |
| 3. Ma trận mức cô lập | Đủ 6 thí nghiệm × 4 mức cô lập và toàn bộ ma trận |
| 4. So sánh hiệu năng | So sánh với 10, 20, 40 khách; khảo sát chịu tải 5–40 và 5–60 khách |

## Cấu trúc

```
index.html, style.css, chung.js, tab-*.js   giao diện – chép từ bản gốc (demo-dongthoi/app/static)
che-do-web.js, che-do-web.css               thay máy chủ: đọc kết quả đã ghi trong du-lieu/
du-lieu/                                    kết quả chạy thật trên MySQL, mỗi kết quả một tệp .js
_cong-cu/ghi_du_lieu.py                     ghi lại kết quả từ bản gốc đang chạy (http://localhost:8010)
_cong-cu/tao_ban_web.py                     chép giao diện từ bản gốc và gắn che-do-web.js
```

## Cập nhật khi bản gốc thay đổi

1. Chạy bản gốc (`khoi-dong.bat` trong thư mục `demo-dongthoi`).
2. `python _cong-cu/tao_ban_web.py` – chép lại giao diện.
3. `python _cong-cu/ghi_du_lieu.py` – chạy lại mọi kịch bản trên MySQL và ghi kết quả.
