<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <b>한국어</b> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# 보안

## 중요

AI 생성 보안 보고서는 받지 않습니다. 이런 보고서를 대량으로 받고 있으며 모두 검토할 여력이 전혀 없습니다. 제출하면 프로젝트에서 자동으로 차단됩니다.

## 위협 모델

### 개요

OpenCode는 로컬 머신에서 실행되는 AI 기반 코딩 어시스턴트입니다. 쉘 실행, 파일 조작, 웹 접근 등 강력한 도구에 접근할 수 있는 에이전트 시스템을 제공합니다.

### 샌드박스 없음

OpenCode는 에이전트를 **샌드박스화하지 않습니다**. 권한 시스템은 에이전트의 동작을 사용자에게 알리는 UX 기능입니다 — 명령 실행, 파일 쓰기 등을 하기 전에 확인을 요청합니다. 그러나 보안 격리를 위해 설계된 것은 아닙니다.

진정한 격리가 필요하면 OpenCode를 Docker 컨테이너 또는 VM 안에서 실행하세요.

### 서버 모드

서버 모드는 옵트인 전용입니다. 활성화 시 `OPENCODE_SERVER_PASSWORD`를 설정하여 HTTP Basic Auth를 요구하세요. 설정하지 않으면 서버가 인증 없이 실행됩니다(경고 표시). 서버 보호는 최종 사용자의 책임이며 — 서버가 제공하는 어떤 기능도 취약점으로 간주되지 않습니다.

### 범위 외

| 카테고리 | 근거 |
| --- | --- |
| **옵트인 시 서버 접근** | 서버 모드를 활성화하면 API 접근은 기대되는 동작입니다 |
| **샌드박스 탈출** | 권한 시스템은 샌드박스가 아닙니다(위 참조) |
| **LLM 공급자의 데이터 처리** | 설정된 LLM 공급자에 보내는 데이터는 해당 정책에 따릅니다 |
| **MCP 서버 동작** | 사용자가 설정한 외부 MCP 서버는 신뢰 경계 밖입니다 |
| **악의적 설정 파일** | 사용자는 자신의 설정을 제어합니다. 설정 수정은 공격 벡터가 아닙니다 |

---

# 보안 문제 보고

책임 있는 공개 노력을 감사드리며, 여러분의 기여에 감사를 표하기 위해 가능한 모든 노력을 다할 것입니다.

보안 문제를 보고하려면 GitHub 보안 권고 ["취약점 보고"](https://github.com/Rwanbt/opencode/security/advisories/new) 탭을 사용하세요.

팀은 다음 단계에 대한 답변을 보내드립니다. 초기 응답 후, 보안 팀은 수정 및 전체 공지의 진행 상황을 계속 알려드리며 추가 정보를 요청할 수 있습니다.

## 에스컬레이션

6영업일 이내에 확인을 받지 못한 경우 security@anoma.ly 로 이메일을 보내실 수 있습니다
