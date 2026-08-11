# Payment Duni · ACB ONE CONNECT Hub

Website quản lý tiền vào/ra, tài khoản, số dư, lịch sử giao dịch và sổ phụ ACB. Stack: React + Vite 8 + TypeScript, Express TypeScript, PostgreSQL, PM2, Nginx và Certbot.

## Callback ACB

- Callback tổng hợp: `https://payment.byduni.com/api/callback`
- Callback kết quả sổ phụ: `https://payment.byduni.com/api/callback/statement`
- Callback có token tương thích cũ: `/api/webhooks/acb/rtxn-notification/<ACB_CALLBACK_TOKEN>`

Endpoint ghi payload vào PostgreSQL durable inbox trước khi trả HTTP 200. Worker chạy nền chống trùng, chuẩn hóa giao dịch, retry theo backoff và chuyển sang `DEAD_LETTER` sau số lần cấu hình. Khi PostgreSQL không khả dụng, callback trả 503 để ACB gửi lại thay vì ACK làm mất dữ liệu.

## Phạm vi ACB Account Information

Backend proxy có audit log và tự làm mới Bearer token cho 8 API outbound:

- `GET /accounts`
- `GET /balances`
- `GET /transaction-history`
- `GET /statements`
- `GET /transaction/detail`
- `GET /statement/retrieve`
- `GET /account/statement/inquiry`
- `POST /e-statement/registration`

API thứ 9 là callback kết quả sổ phụ do hệ thống này tiếp nhận. Base URL, token URL, prefix và từng path đều cấu hình bằng env để chuyển Sandbox/Production mà không sửa code.

`/statements` được validate cùng một ngày. `/transaction-history` hỗ trợ khoảng số giao dịch + khoảng ngày, chỉ khoảng ngày, hoặc truy vấn gần nhất bằng `limit`. HTTP 401 từ ACB làm token bị xóa/lấy lại và request được gọi lại một lần.

## Bảo mật

- Tài khoản dashboard nằm trong `ADMIN_USERNAME`/`ADMIN_PASSWORD` trên VPS, không nằm trong database hoặc Git.
- ACB secret, callback token và PostgreSQL password chỉ nằm trong `.env` bị ignore.
- Cookie phiên `HttpOnly`, `Secure` ở production và `SameSite=Strict`.
- URL chính `/api/callback` được giữ công khai theo contract đã khai báo với ACB và vẫn ghi cờ xác thực vào audit. Các alias/callback chuyên biệt yêu cầu Bearer/`x-webhook-token`, hoặc `x-client-id` + `x-client-secret` khi `ACB_WEBHOOK_AUTH_REQUIRED=true`.
- Header nhạy cảm và secret bị loại khỏi audit log.

## Chạy và kiểm tra

```bash
cp .env.example .env
npm install
npm run typecheck
npm test
npm run build
npm start
```

PostgreSQL tự migration khi app khởi động. `POSTGRES_SSL=false` là chủ ý cho giai đoạn hiện tại; bật SSL sau khi hạ tầng database sẵn sàng.

## Checklist Sandbox → Go-live

1. Đăng ký/được duyệt sản phẩm **Thông Báo Giao Dịch**, **Thông Tin Tài Khoản** và **Authentication** cho đúng ứng dụng ACB.
2. Nhận bộ data test: tài khoản hợp lệ, tài khoản không thuộc khách hàng, ngày có/không giao dịch và giao dịch mẫu.
3. Điền chính xác `ACB_BASE_URL`, `ACB_TOKEN_URL`, `ACB_API_PREFIX` theo đặc tả trong tài khoản ACB ONE CONNECT; portal chỉ công khai suffix API, phần host/prefix phải theo gói được cấp.
4. Khai báo callback HTTPS và cơ chế xác thực thống nhất với ACB. Không tắt `ACB_WEBHOOK_AUTH_REQUIRED` ở production.
5. Chạy đủ kịch bản 200, dữ liệu rỗng, sai định dạng, tài khoản không tồn tại và token hết hạn; kiểm tra audit log, retry/dead-letter và chống nhận trùng.
6. Đối soát số dư, lịch sử và sổ phụ với ACB; kiểm tra timezone, dấu tiền vào/ra và mã tham chiếu.
7. ACB xác nhận UAT, cấp endpoint/credential production và allowlist IP tĩnh của VPS.
8. Thay credential production, smoke test callback và truy vấn read-only, theo dõi PM2/Nginx/PostgreSQL trước khi mở nghiệp vụ.
