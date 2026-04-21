<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <b>Español</b> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <a href="SECURITY.tr.md">Türkçe</a> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Seguridad

## Importante

No aceptamos informes de seguridad generados por IA. Recibimos una gran cantidad de ellos y no tenemos recursos para revisarlos todos. Enviar uno resulta en un baneo automático del proyecto.

## Modelo de amenazas

### Visión general

OpenCode es un asistente de programación con IA que se ejecuta localmente en tu máquina. Proporciona un sistema de agentes con acceso a herramientas potentes como ejecución de shell, operaciones de archivos y acceso web.

### Sin sandbox

OpenCode **no** pone al agente en un sandbox. El sistema de permisos existe como funcionalidad de UX para mantener al usuario consciente de las acciones del agente — pide confirmación antes de ejecutar comandos, escribir archivos, etc. Sin embargo, no está diseñado para proporcionar aislamiento de seguridad.

Si necesitas aislamiento real, ejecuta OpenCode dentro de un contenedor Docker o una VM.

### Modo servidor

El modo servidor es opcional. Cuando se activa, establece `OPENCODE_SERVER_PASSWORD` para requerir HTTP Basic Auth. Sin esto, el servidor corre sin autenticación (con un aviso). Es responsabilidad del usuario final proteger el servidor — cualquier funcionalidad que proporcione no es una vulnerabilidad.

### Fuera del alcance

| Categoría | Justificación |
| --- | --- |
| **Acceso al servidor cuando está activado** | Si activas el modo servidor, el acceso a la API es comportamiento esperado |
| **Escape de sandbox** | El sistema de permisos no es un sandbox (ver arriba) |
| **Manejo de datos del proveedor LLM** | Los datos enviados al proveedor LLM configurado se rigen por sus políticas |
| **Comportamiento de servidores MCP** | Los servidores MCP externos que configures están fuera de nuestra frontera de confianza |
| **Archivos de configuración maliciosos** | Los usuarios controlan su propia configuración; modificarla no es un vector de ataque |

---

# Reportar problemas de seguridad

Agradecemos tus esfuerzos por divulgar responsablemente tus hallazgos y haremos todo lo posible para reconocer tus contribuciones.

Para reportar un problema, usa la pestaña ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new) de GitHub Security Advisory.

El equipo enviará una respuesta indicando los próximos pasos. Tras la respuesta inicial, el equipo de seguridad te mantendrá informado del progreso hacia una corrección y anuncio completo, y puede pedir información adicional.

## Escalada

Si no recibes un acuse de recibo en 6 días hábiles, puedes enviar un correo a security@anoma.ly
