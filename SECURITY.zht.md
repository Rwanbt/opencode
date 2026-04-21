<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <b>繁體中文</b> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# 安全

## 重要

我們不接受 AI 生成的安全報告。我們收到大量此類報告，且完全沒有資源逐一審閱。如提交，將被自動封禁。

## 威脅模型

### 概覽

OpenCode 是在本地機器上運行的 AI 驅動編碼助手，提供具備 shell 執行、檔案操作和網路存取等強大工具的代理系統。

### 無沙箱

OpenCode **不會** 對代理進行沙箱化。權限系統作為 UX 功能存在，用於提醒使用者代理正在執行的動作——在執行命令、寫入檔案等之前會請求確認。但它並非為安全隔離而設計。

如需真正的隔離，請在 Docker 容器或虛擬機中運行 OpenCode。

### 伺服器模式

伺服器模式僅在顯式啟用時生效。啟用時，設定 `OPENCODE_SERVER_PASSWORD` 以啟用 HTTP Basic Auth。否則伺服器將以未認證方式運行（並提示警告）。保護伺服器是最終使用者的責任——其所提供的任何功能均不視為漏洞。

### 不在範圍內

| 類別 | 理由 |
| --- | --- |
| **啟用伺服器後的伺服器存取** | 啟用伺服器模式後，API 存取是預期行為 |
| **沙箱逃逸** | 權限系統不是沙箱（見上文） |
| **LLM 提供商的資料處理** | 發送給所配置 LLM 提供商的資料受其政策管轄 |
| **MCP 伺服器行為** | 您所配置的外部 MCP 伺服器不在我們的信任邊界內 |
| **惡意設定檔** | 使用者控制自身設定；修改設定不構成攻擊向量 |

---

# 回報安全問題

我們感謝您負責任地揭露發現的努力，並將盡一切可能感謝您的貢獻。

請使用 GitHub 安全公告 [“回報漏洞”](https://github.com/Rwanbt/opencode/security/advisories/new) 分頁。

團隊將發送回覆並告知處理步驟。在初步回覆後，安全團隊將持續告知修復和公告進度，並可能要求提供更多資訊。

## 升級

若 6 個工作日內未收到確認，可發送郵件至 security@anoma.ly
