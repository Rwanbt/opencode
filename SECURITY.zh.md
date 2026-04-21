<p align="center"><a href="SECURITY.md">English</a> | <b>简体中文</b> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# 安全

## 重要

我们不接受 AI 生成的安全报告。我们收到大量此类报告，且完全没有资源逐一审阅。如提交，将被自动封禁。

## 威胁模型

### 概览

OpenCode 是在本地机器上运行的 AI 驱动编码助手，提供具备 shell 执行、文件操作和网络访问等强大工具的代理系统。

### 无沙箱

OpenCode **不会** 对代理进行沙箱化。权限系统作为 UX 功能存在，用于提醒用户代理正在执行的动作——在执行命令、写入文件等之前会请求确认。但它并非为安全隔离而设计。

如需真正的隔离，请在 Docker 容器或虚拟机中运行 OpenCode。

### 服务器模式

服务器模式仅在显式启用时生效。启用时，设置 `OPENCODE_SERVER_PASSWORD` 以启用 HTTP Basic Auth。否则服务器将以未认证方式运行（并提示警告）。保护服务器是最终用户的责任——其所提供的任何功能均不视为漏洞。

### 不在范围内

| 类别 | 理由 |
| --- | --- |
| **启用服务器后的服务器访问** | 启用服务器模式后，API 访问是预期行为 |
| **沙箱逃逸** | 权限系统不是沙箱（见上文） |
| **LLM 提供商的数据处理** | 发送给所配置 LLM 提供商的数据受其政策管辖 |
| **MCP 服务器行为** | 您所配置的外部 MCP 服务器不在我们的信任边界内 |
| **恶意配置文件** | 用户控制自身配置；修改配置不构成攻击向量 |

---

# 报告安全问题

我们感谢您负责任地披露发现的努力，并将尽一切可能感谢您的贡献。

请使用 GitHub 安全公告 [“报告漏洞”](https://github.com/Rwanbt/opencode/security/advisories/new) 选项卡。

团队将发送回复并告知处理步骤。在初步回复后，安全团队将持续告知修复和公告进度，并可能要求提供更多信息。

## 升级

若 6 个工作日内未收到确认，可发送邮件至 security@anoma.ly
