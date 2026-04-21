<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <b>Português (Brasil)</b> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Segurança

## Importante

Não aceitamos relatórios de segurança gerados por IA. Recebemos muitos deles e absolutamente não temos recursos para revisar todos. Enviar um resulta em banimento automático do projeto.

## Modelo de ameaças

### Visão geral

OpenCode é um assistente de programação com IA que roda localmente em sua máquina. Fornece um sistema de agentes com acesso a ferramentas poderosas, incluindo execução de shell, operações em arquivos e acesso à web.

### Sem sandbox

O OpenCode **não** coloca o agente em sandbox. O sistema de permissões existe como recurso de UX para ajudar os usuários a ficarem cientes do que o agente está fazendo — solicita confirmação antes de executar comandos, gravar arquivos, etc. No entanto, não foi projetado para fornecer isolamento de segurança.

Se você precisa de isolamento real, execute o OpenCode dentro de um contêiner Docker ou VM.

### Modo servidor

O modo servidor é somente opt-in. Quando ativado, defina `OPENCODE_SERVER_PASSWORD` para exigir HTTP Basic Auth. Sem isso, o servidor roda sem autenticação (com um aviso). É responsabilidade do usuário final proteger o servidor — qualquer funcionalidade fornecida por ele não é uma vulnerabilidade.

### Fora de escopo

| Categoria | Justificativa |
| --- | --- |
| **Acesso ao servidor quando ativado** | Se você habilitar o modo servidor, o acesso à API é o comportamento esperado |
| **Escapes de sandbox** | O sistema de permissões não é um sandbox (ver acima) |
| **Manipulação de dados do provedor LLM** | Os dados enviados ao seu provedor LLM configurado são regidos pelas políticas dele |
| **Comportamento de servidores MCP** | Servidores MCP externos que você configura estão fora da nossa fronteira de confiança |
| **Arquivos de configuração maliciosos** | Os usuários controlam sua própria configuração; modificá-la não é um vetor de ataque |

---

# Reportar problemas de segurança

Agradecemos seus esforços para divulgar de forma responsável suas descobertas e faremos todo o possível para reconhecer suas contribuições.

Para reportar um problema de segurança, use a aba GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new).

A equipe enviará uma resposta indicando os próximos passos. Após a resposta inicial, a equipe de segurança manterá você informado sobre o progresso em direção a uma correção e anúncio completo, e pode pedir informações adicionais.

## Escalonamento

Se você não receber uma confirmação em 6 dias úteis, pode enviar um e-mail para security@anoma.ly
