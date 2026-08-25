# Payment Duni · ACB ONE CONNECT Hub

Website quản lý tiền vào/ra, tài khoản, số dư, lịch sử giao dịch và sổ phụ ACB. Stack: React + Vite 8 + TypeScript, Express TypeScript, PostgreSQL, PM2, Nginx và Certbot.

## Callback ACB

- Callback tổng hợp: `https://payment.byduni.com/api/callback`
- Callback kết quả sổ phụ: `https://payment.byduni.com/api/callback/statement`
- Callback có token tương thích cũ: `/api/webhooks/acb/rtxn-notification/<ACB_CALLBACK_TOKEN>`

URL callback chính yêu cầu `x-api-key: <ACB_WEBHOOK_TOKEN>`. Hệ thống chỉ trả HTTP 200 sau khi payload đã được ghi nguyên tử và `fsync` vào local spool trên VPS; vì vậy PostgreSQL `192.168.31.24` tạm ngừng vẫn không làm mất callback. Worker chuyển bản ghi sang PostgreSQL, chỉ xóa file spool sau khi PostgreSQL xác nhận, sau đó tạo outbox để gửi HMAC sang AdminDuni. Cả inbox và outbox đều chống trùng, retry theo backoff; mất mạng/AdminDuni/HTTP 5xx được retry vô hạn, còn lỗi 4xx cố định mới chuyển `DEAD_LETTER` sau ngưỡng cấu hình. Request thiếu/sai API key trả 401; JSON body không hợp lệ trả 400.

Luồng lưu trữ: `ACB → local spool VPS → Payment PostgreSQL → admin_sync_outbox → AdminDuni`. Sandbox được gửi với `sourceEnvironment=SANDBOX` và AdminDuni cô lập vào bảng staging; chỉ `PRODUCTION` mới được ghi vào `bank_transaction` và chạy logic ghép đơn/kế toán. `ADMIN_SYNC_SHARED_SECRET` ở Payment phải trùng `ACB_PAYMENT_SHARED_SECRET` ở AdminDuni.

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
- POST /credit để tạo giao dịch Có trong sandbox
- POST /debit để tạo giao dịch Nợ trong sandbox

API thứ 9 là callback kết quả sổ phụ do hệ thống này tiếp nhận. Base URL, token URL, prefix và từng path đều cấu hình bằng env để chuyển Sandbox/Production mà không sửa code.

`/statements` được validate cùng một ngày. `/transaction-history` hỗ trợ tối đa 100 giao dịch gần nhất, hoặc tối đa 500 giao dịch trong cùng một ngày/theo khoảng số giao dịch. HTTP 401 từ ACB làm token bị xóa/lấy lại và request được gọi lại một lần.

ACB dùng nhiều namespace độc lập (`customers/account`, `accounts/transactions`, `oe/current-account`, `payment/payment-execution`), vì vậy từng path đầy đủ được cấu hình riêng thay vì ghép chung một prefix.

Header outbound được cấu hình thay vì hard-code: `ACB_X_CHANNEL`, `ACB_PROVIDER_ID`, `ACB_SERVICE`, `X-Request-ID` tự sinh và `X-Client-ID`. `ACB_HEADER_SECRET_NAME`/`ACB_API_SECRET` chỉ giữ để tương thích nếu ACB cấp contract riêng yêu cầu header secret.

## Bảo mật

- Tài khoản dashboard nằm trong `ADMIN_USERNAME`/`ADMIN_PASSWORD` trên VPS, không nằm trong database hoặc Git.
- ACB secret, callback token và PostgreSQL password chỉ nằm trong `.env` bị ignore.
- Cookie phiên `HttpOnly`, `Secure` ở production và `SameSite=Strict`.
- URL chính `/api/callback` chỉ chấp nhận API key qua header `x-api-key`. Các alias/callback chuyên biệt vẫn hỗ trợ Bearer/`x-webhook-token`, hoặc `x-client-id` + `x-client-secret` khi `ACB_WEBHOOK_AUTH_REQUIRED=true`.
- Header nhạy cảm và secret bị loại khỏi audit log.
- `LOCAL_SPOOL_DIR` phải trỏ tới thư mục bền vững ngoài source tree (khuyến nghị `/var/lib/payment-duni/spool`) và quyền chỉ dành cho user chạy PM2.
- Request Payment → AdminDuni ký HMAC-SHA256 trên raw JSON kèm timestamp; AdminDuni từ chối chữ ký sai hoặc request quá 2 phút.

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
3. Điền chính xác `ACB_BASE_URL`, `ACB_TOKEN_URL`, `ACB_X_CHANNEL`, `ACB_PROVIDER_ID`, `ACB_SERVICE` và từng `ACB_PATH_*` theo contract ACB ONE CONNECT.
4. Khai báo callback HTTPS và cơ chế xác thực thống nhất với ACB. Không tắt `ACB_WEBHOOK_AUTH_REQUIRED` ở production.
5. Chạy đủ kịch bản 200, dữ liệu rỗng, sai định dạng, tài khoản không tồn tại và token hết hạn; kiểm tra audit log, retry/dead-letter và chống nhận trùng.
6. Đối soát số dư, lịch sử và sổ phụ với ACB; kiểm tra timezone, dấu tiền vào/ra và mã tham chiếu.
7. ACB xác nhận UAT, cấp endpoint/credential production và allowlist IP tĩnh của VPS.
8. Thay credential production, smoke test callback và truy vấn read-only, theo dõi PM2/Nginx/PostgreSQL trước khi mở nghiệp vụ.
