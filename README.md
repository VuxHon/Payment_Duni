# Payment Duni · ACB Transaction Hub

Dashboard quản lý tiền vào/ra nhận từ dịch vụ **Thông báo giao dịch** của ACB ONE CONNECT.

## Callback ACB

Callback chính, công khai và phản hồi HTTP 200 ngay trước khi thực hiện bất kỳ truy vấn PostgreSQL nào:

`https://payment.byduni.com/api/callback`

Payload sau đó được xử lý bất đồng bộ, chống trùng và lưu vào PostgreSQL. Đây là URL nên khai báo trên ACB ONE CONNECT.

Callback có token dành cho kiểm thử hoặc cấu hình yêu cầu xác thực đường dẫn:

Ứng dụng công bố URL có token bí mật theo mẫu:

`https://payment.byduni.com/api/webhooks/acb/rtxn-notification/<ACB_CALLBACK_TOKEN>`

Các callback trả `{ "errorCode": "00", "errorMessage": "Success" }`, chống nhận trùng theo SHA-256, lưu payload gốc và chuẩn hóa giao dịch vào PostgreSQL. Endpoint `/api/webhooks/acb/rtxn-notification` không có token chỉ chấp nhận `x-client-id` + `x-client-secret` khớp cấu hình hoặc `ACB_WEBHOOK_TOKEN`.

## Chạy local

```bash
cp .env.example .env
npm install
npm run dev
```

Frontend: `http://localhost:5173`. API: `http://127.0.0.1:3000`.

## Kiểm tra

```bash
npm run typecheck
npm test
npm run build
```

PostgreSQL được tự động tạo bảng/index khi API khởi động. Dashboard hỗ trợ đăng nhập, tổng quan 30 ngày, biểu đồ 14 ngày, tìm kiếm/lọc, xem payload gốc và xuất CSV.
