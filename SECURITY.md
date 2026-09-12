<!-- SECURITY-LANG-SELECTOR -->
<p align="center"><b>English</b> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

---

# Security

## IMPORTANT

We do not accept AI generated security reports. We receive a large number of
these and we absolutely do not have the resources to review them all. If you
submit one that will be an automatic ban from the project.

## Supported Versions

| Version | Supported          |
| ------- | ------------------ |
| 1.3.x   | ✅ Yes (current)   |
| 1.2.x   | ⚠️ Security fixes only |
| < 1.2   | ❌ No              |

> This fork (`Rwanbt/unifia`) tracks the latest upstream release. Patches are backported to the current minor series only.

## Threat Model

### Overview

Unifia is an AI-powered coding assistant that runs locally on your machine. It provides an agent system with access to powerful tools including shell execution, file operations, and web access.

### No Sandbox

Unifia does **not** sandbox the agent. The permission system exists as a UX feature to help users stay aware of what actions the agent is taking - it prompts for confirmation before executing commands, writing files, etc. However, it is not designed to provide security isolation.

If you need true isolation, run Unifia inside a Docker container or VM.

### Server Mode

Server mode is opt-in only. When enabled, set `UNIFIA_SERVER_PASSWORD` to require HTTP Basic Auth. Without this, the server runs unauthenticated (with a warning). It is the end user's responsibility to secure the server - any functionality it provides is not a vulnerability.

### Out of Scope

| Category                        | Rationale                                                               |
| ------------------------------- | ----------------------------------------------------------------------- |
| **Server access when opted-in** | If you enable server mode, API access is expected behavior              |
| **Sandbox escapes**             | The permission system is not a sandbox (see above)                      |
| **LLM provider data handling**  | Data sent to your configured LLM provider is governed by their policies |
| **MCP server behavior**         | External MCP servers you configure are outside our trust boundary       |
| **Malicious config files**      | Users control their own config; modifying it is not an attack vector    |

---

# Reporting Security Issues

We appreciate your efforts to responsibly disclose your findings, and will make every effort to acknowledge your contributions.

To report a security issue **in this fork**, please use this repository's GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/unifia/security/advisories/new) tab.

The maintainer will send a response indicating the next steps in handling your report, and will keep you informed of the progress towards a fix and full announcement.

## Which project to report to

This fork carries a large amount of code inherited from upstream OpenCode. Report to whichever project actually owns the defect:

| The issue is in | Report to |
| --- | --- |
| Fork-specific code — desktop/mobile shells, local model orchestration, Team, governance and identity gates | [Rwanbt/unifia advisories](https://github.com/Rwanbt/unifia/security/advisories/new) |
| Code inherited unchanged from upstream, and reproducible on upstream | [anomalyco/opencode advisories](https://github.com/anomalyco/opencode/security/advisories/new) |

If you are unsure, report here and the report will be forwarded upstream when it belongs there.

## Escalation

This fork is maintained by a single person, so acknowledgement can take longer than an organisation's. If you do not receive one within 14 calendar days, open a non-descriptive issue on [Rwanbt/unifia](https://github.com/Rwanbt/unifia/issues) asking the maintainer to check their advisory inbox — do not disclose the vulnerability in that issue.
