# IoT Smart Doorbell

Phạm Hoàng Ngọc phụ trách Web/App STT 9–12. Nguyễn Thanh Huy phụ trách Arduino Uno R3; Minh Duy phụ trách ESP8266.

## Chạy ngay bằng Windows và VS Code

1. Giải nén bộ bài. Mở đúng thư mục `IoT_Doorbell_Web` bằng VS Code > File > Open Folder.
2. Cài extension **Live Server** của **Ritwick Dey** (`ritwickdey.LiveServer`).
3. Nhấp phải `index.html` > **Open with Live Server**.
4. Địa chỉ thường là `http://127.0.0.1:5500/index.html`; cổng có thể khác nếu đã được sử dụng.
5. Giữ `firebase-config.js` trống để dùng Demo. Không mở trực tiếp bằng địa chỉ `file:///`.

Không cần React, Node.js, npm, XAMPP, PHP, MySQL, Android Studio hay Flutter để chạy Web.

## Kiểm thử Demo

- Giả lập có khách: hiển thị **CÓ KHÁCH**, cập nhật thời gian theo máy tính.
- Giả lập bình thường hoặc ĐẶT VỀ BÌNH THƯỜNG: hiển thị **BÌNH THƯỜNG**.
- TẮT CHUÔNG TỪ XA: hiển thị **Đã tắt** trong Demo.
- BẬT LẠI CHUÔNG: hiển thị **Đang hoạt động**.

Demo không tải Firebase SDK. Dữ liệu mô phỏng lưu trên trình duyệt; các tab cùng địa chỉ có thể nhận thay đổi qua localStorage. Điện thoại và máy khác không chia sẻ dữ liệu Demo.

## Chuyển sang Firebase thật

1. Tạo dự án ở https://console.firebase.google.com/.
2. Tạo **Realtime Database**, chọn khu vực Singapore (`asia-southeast1`) nếu có trong danh sách; bắt đầu ở Locked mode.
3. Đăng ký Web App, lấy cấu hình trong Project settings > General > Your apps > Config.
4. Điền các giá trị thật vào `firebase-config.js`, giữ nguyên `export const firebaseConfig`.
5. Copy `databaseURL` gốc tại Realtime Database > Data; không thêm `/doorbell` hoặc `.json` vào cấu hình Web.
6. Import `sample-data.json` tại **gốc database mới**. Nếu database đã có dữ liệu khác, tạo riêng node `doorbell` để tránh ghi đè dữ liệu gốc.
7. Mở Realtime Database > Rules, dán toàn bộ `database.rules.json` rồi **Publish**.
8. Tải lại Web. Phải thấy **CHẾ ĐỘ FIREBASE** và **Web ↔ Firebase: đã kết nối**.

Chỉ bốn trường tại `/doorbell` được ghi theo Rules này. Rules cho phép đọc/ghi công khai phục vụ demo; không dùng cho hệ thống thật. Web config không phải service account và không kiểm soát quyền truy cập thay cho Rules.

## Cấu trúc dữ liệu

| Path | Kiểu | Vai trò |
|---|---|---|
| `doorbell/ring` | Boolean | `true`: có tín hiệu khách; `false`: bình thường |
| `doorbell/mute` | Boolean | `true`: yêu cầu tắt còi; `false`: cho phép còi |
| `doorbell/lastRingAt` | Number | Unix timestamp mili giây lần ghi nhận chuông, `0` khi chưa có |
| `doorbell/muteRequestedAt` | Number | Unix timestamp mili giây lần yêu cầu tắt, `0` khi chưa có |

Web dùng Firebase JS SDK **12.19.0** qua browser modules/CDN. `onValue` cập nhật giao diện không reload; `update` chỉ thay trường cần thiết; `serverTimestamp()` tạo thời gian server. `/.info/connected` phản ánh kết nối của **Web**, không xác nhận ESP8266 đang online.

## Ý nghĩa các nút

- Tắt chuông: ghi `mute=true`, `muteRequestedAt=serverTimestamp()`.
- Bật lại: ghi `mute=false`, giữ nguyên thời gian yêu cầu tắt gần nhất.
- Giả lập khách: ghi `ring=true`, `lastRingAt=serverTimestamp()`.
- Bình thường: ghi `ring=false`, không xóa thời gian và không đổi `mute`.

`ring` là trạng thái lưu cho đến khi được đặt lại; không tự về false khi nhả nút hoặc còi ngừng. Khi đang mute, khách bấm nút vẫn phải được ghi nhận. Trạng thái Đã tắt phản ánh `mute` trên database; muốn xác nhận còi vật lý phải kiểm tra Arduino.

## Khi có lỗi

- Chưa đủ config: Web hiện Demo và liệt kê trường còn thiếu.
- Config có lỗi cú pháp hoặc databaseURL sai định dạng: trang vẫn hiện, khóa nút và báo lỗi.
- Database chưa có/thiếu/sai kiểu: không giả vờ báo Bình thường; chỉ rõ dữ liệu cần sửa.
- Mất mạng: giữ dữ liệu gần nhất, khóa lệnh mới. Khi kết nối lại, listener hoạt động tiếp.
- Mất mạng sau khi đã gửi lệnh: chờ Firebase xác nhận, không báo thành công sớm. SDK có thể gửi lại khi mạng trở lại; không đóng trang khi đang chờ.
- Permission denied: kiểm tra Rules, dữ liệu, đúng database; Publish rồi tải lại trang nếu listener đã bị hủy.
- F12 > Console/Network để xem lỗi 404, module hoặc tải CDN thất bại.

## Đưa lên Vercel

1. Điền config thật và thử Firebase trên Live Server trước.
2. Vào https://vercel.com/drop, đăng nhập, kéo **đúng thư mục `IoT_Doorbell_Web`** lên.
3. `index.html` phải ở gốc thư mục được kéo. Chọn team cá nhân, đặt tên dự án rồi Deploy.
4. Copy URL HTTPS sau khi hoàn tất. Mở điện thoại bằng 4G và kiểm thử lại.
5. Khi sửa file, tải bản mới lên dự án trong Dashboard nếu có vùng thả cập nhật; thả ở trang Drop sẽ tạo dự án mới.

Không tải thư mục Hardware_Reference lên Vercel vì phần đó có chỗ điền mật khẩu Wi-Fi. Báo cáo và hướng dẫn cũng không cần deploy.

## Tài liệu của bộ bài

- `HUONG_DAN_A_Z_FULL_CODE.html`: hướng dẫn A–R và đầy đủ nội dung từng file, mở bằng Chrome/Edge để đọc và copy.
- `HUONG_DAN_A_Z_FULL_CODE.md`: cùng nội dung dạng Markdown.
- `HUONG_DAN_A_Z.docx`: hướng dẫn thao tác từng bước.
- `BAO_CAO_CHUONG_3_WEB_APP.docx`: Chương 3 có bảng database, test case, sơ đồ và hướng dẫn ảnh minh chứng.
- `Hardware_Reference`: hai sketch Arduino/ESP8266 tham khảo, không phải mã Web.
- `TIN_NHAN_GUI_MINH_DUY.txt`: mẫu tin nhắn để Ngọc điền URL rồi tự gửi.
- `KET_QUA_KIEM_THU.md`: phạm vi kiểm tra đã thực hiện và những bước cần làm với tài khoản/thiết bị thật.
