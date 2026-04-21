<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <b>Tiếng Việt</b></p>

# Bảo mật

## Quan trọng

Chúng tôi không chấp nhận các báo cáo bảo mật do AI tạo ra. Chúng tôi nhận được số lượng lớn những báo cáo này và tuyệt đối không có đủ nguồn lực để xem xét tất cả. Gửi một báo cáo như vậy sẽ dẫn đến việc cấm tự động khỏi dự án.

## Mô hình mối đe dọa

### Tổng quan

OpenCode là một trợ lý lập trình được hỗ trợ bởi AI chạy cục bộ trên máy của bạn. Nó cung cấp một hệ thống tác nhân với quyền truy cập vào các công cụ mạnh mẽ bao gồm thực thi shell, thao tác tệp và truy cập web.

### Không có sandbox

OpenCode **không** đặt tác nhân vào sandbox. Hệ thống quyền tồn tại như một tính năng UX để giúp người dùng nhận biết những gì tác nhân đang làm — nó yêu cầu xác nhận trước khi thực thi các lệnh, ghi tệp, v.v. Tuy nhiên, nó không được thiết kế để cung cấp cách ly bảo mật.

Nếu bạn cần cách ly thực sự, hãy chạy OpenCode bên trong một container Docker hoặc VM.

### Chế độ máy chủ

Chế độ máy chủ chỉ là opt-in. Khi được bật, đặt `OPENCODE_SERVER_PASSWORD` để yêu cầu HTTP Basic Auth. Nếu không có điều này, máy chủ chạy không xác thực (với cảnh báo). Người dùng cuối có trách nhiệm bảo vệ máy chủ — bất kỳ chức năng nào nó cung cấp đều không phải là lỗ hổng.

### Ngoài phạm vi

| Danh mục | Lý do |
| --- | --- |
| **Truy cập máy chủ khi opt-in** | Nếu bạn bật chế độ máy chủ, truy cập API là hành vi được mong đợi |
| **Thoát sandbox** | Hệ thống quyền không phải là sandbox (xem trên) |
| **Xử lý dữ liệu của nhà cung cấp LLM** | Dữ liệu gửi đến nhà cung cấp LLM được cấu hình của bạn được điều chỉnh bởi các chính sách của họ |
| **Hành vi của máy chủ MCP** | Các máy chủ MCP bên ngoài mà bạn cấu hình nằm ngoài ranh giới tin cậy của chúng tôi |
| **Tệp cấu hình độc hại** | Người dùng kiểm soát cấu hình của riêng họ; sửa đổi nó không phải là vectơ tấn công |

---

# Báo cáo sự cố bảo mật

Chúng tôi đánh giá cao nỗ lực công bố có trách nhiệm các phát hiện của bạn và sẽ cố gắng hết sức để ghi nhận những đóng góp của bạn.

Để báo cáo sự cố bảo mật, hãy sử dụng tab GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

Nhóm sẽ gửi phản hồi chỉ ra các bước tiếp theo. Sau phản hồi ban đầu, nhóm bảo mật sẽ thông báo cho bạn về tiến trình hướng tới một bản sửa lỗi và thông báo đầy đủ, và có thể yêu cầu thông tin bổ sung.

## Leo thang

Nếu bạn không nhận được xác nhận trong vòng 6 ngày làm việc, bạn có thể gửi email đến security@anoma.ly
