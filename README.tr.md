<p align="center">
  <a href="https://opencode.ai">
    <picture>
      <source srcset="packages/console/app/src/asset/logo-ornate-dark.svg" media="(prefers-color-scheme: dark)">
      <source srcset="packages/console/app/src/asset/logo-ornate-light.svg" media="(prefers-color-scheme: light)">
      <img src="packages/console/app/src/asset/logo-ornate-light.svg" alt="OpenCode logo">
    </picture>
  </a>
</p>
<p align="center">Açık kaynaklı yapay zeka kodlama asistanı.</p>
<p align="center">
  <a href="https://opencode.ai/discord"><img alt="Discord" src="https://img.shields.io/discord/1391832426048651334?style=flat-square&label=discord" /></a>
  <a href="https://www.npmjs.com/package/opencode-ai"><img alt="npm" src="https://img.shields.io/npm/v/opencode-ai?style=flat-square" /></a>
  <a href="https://github.com/anomalyco/opencode/actions/workflows/publish.yml"><img alt="Build status" src="https://img.shields.io/github/actions/workflow/status/anomalyco/opencode/publish.yml?style=flat-square&branch=dev" /></a>
</p>

<p align="center">
  <a href="README.md">English</a> |
  <a href="README.zh.md">简体中文</a> |
  <a href="README.zht.md">繁體中文</a> |
  <a href="README.ko.md">한국어</a> |
  <a href="README.de.md">Deutsch</a> |
  <a href="README.es.md">Español</a> |
  <a href="README.fr.md">Français</a> |
  <a href="README.it.md">Italiano</a> |
  <a href="README.da.md">Dansk</a> |
  <a href="README.ja.md">日本語</a> |
  <a href="README.pl.md">Polski</a> |
  <a href="README.ru.md">Русский</a> |
  <a href="README.bs.md">Bosanski</a> |
  <a href="README.ar.md">العربية</a> |
  <a href="README.no.md">Norsk</a> |
  <a href="README.br.md">Português (Brasil)</a> |
  <a href="README.th.md">ไทย</a> |
  <a href="README.tr.md">Türkçe</a> |
  <a href="README.uk.md">Українська</a> |
  <a href="README.bn.md">বাংলা</a> |
  <a href="README.gr.md">Ελληνικά</a> |
  <a href="README.vi.md">Tiếng Việt</a>
</p>

[![OpenCode Terminal UI](packages/web/src/assets/lander/screenshot.png)](https://opencode.ai)

---

## Fork Özellikleri

> Bu, [anomalyco/opencode](https://github.com/anomalyco/opencode) projesinin [Rwanbt](https://github.com/Rwanbt) tarafından sürdürülen bir fork'udur.
> Upstream ile senkronize tutulmaktadır. En son değişiklikler için [dev dalına](https://github.com/Rwanbt/opencode/tree/dev) bakın.

#### Arka Plan Görevleri

İşleri asenkron çalışan alt ajanlara devredin. Task aracında `mode: "background"` ayarlayın; ajan arka planda çalışırken hemen bir `task_id` döner. Yaşam döngüsü takibi için bus olayları (`TaskCreated`, `TaskCompleted`, `TaskFailed`) yayınlanır.

#### Ajan Takımları

`team` aracını kullanarak birden fazla ajanı paralel olarak orkestre edin. Bağımlılık kenarlarıyla alt görevler tanımlayın; `computeWaves()` bir DAG oluşturur ve bağımsız görevleri eşzamanlı olarak yürütür (en fazla 5 paralel ajan). `max_cost` (dolar) ve `max_agents` ile bütçe kontrolü. Tamamlanan görevlerden bağlam otomatik olarak bağımlı görevlere aktarılır.

#### Git Worktree İzolasyonu

Her arka plan görevi otomatik olarak kendi git worktree'sini alır. Çalışma alanı veritabanında oturuma bağlanır. Bir görev dosya değişikliği üretmezse worktree otomatik olarak temizlenir. Bu, konteyner olmadan git düzeyinde izolasyon sağlar.

#### Görev Yönetimi API'si

Görev yaşam döngüsü yönetimi için tam REST API:

| Method | Path | Açıklama |
|--------|------|----------|
| GET | `/task/` | Görevleri listele (parent, status'a göre filtrele) |
| GET | `/task/:id` | Görev detayları + status + worktree bilgisi |
| GET | `/task/:id/messages` | Görev oturum mesajlarını getir |
| POST | `/task/:id/cancel` | Çalışan veya sıradaki görevi iptal et |
| POST | `/task/:id/resume` | Tamamlanan/başarısız/engellenen görevi devam ettir |
| POST | `/task/:id/followup` | Boşta olan göreve takip mesajı gönder |
| POST | `/task/:id/promote` | Arka plan görevini ön plana terfi ettir |
| GET | `/task/:id/team` | Toplu takım görünümü (maliyetler, üye başına diff'ler) |

#### TUI Görev Paneli

Gerçek zamanlı durum simgeleriyle aktif arka plan görevlerini gösteren kenar çubuğu eklentisi:

| Simge | Durum |
|-------|-------|
| `~` | Running / Retrying |
| `?` | Queued / Awaiting input |
| `!` | Blocked |
| `x` | Failed |
| `*` | Completed |
| `-` | Cancelled |

Eylemler içeren iletişim kutusu: görev oturumunu aç, iptal et, devam ettir, takip mesajı gönder, durumu kontrol et.

#### MCP Ajan Kapsamı

MCP sunucuları için ajan başına izin ver/engelle listeleri. `opencode.json` dosyasında her ajanın `mcp` alanı altında yapılandırılır. `toolsForAgent()` fonksiyonu, çağıran ajanın kapsamına göre kullanılabilir MCP araçlarını filtreler.

```json
{
  "agents": {
    "explore": {
      "mcp": { "deny": ["dangerous-server"] }
    }
  }
}
```

#### 9 Durumlu Oturum Yaşam Döngüsü

Oturumlar veritabanında kalıcı olarak saklanan 9 durumdan birini takip eder:

`idle` · `busy` · `retry` · `queued` · `blocked` · `awaiting_input` · `completed` · `failed` · `cancelled`

Kalıcı durumlar (`queued`, `blocked`, `awaiting_input`, `completed`, `failed`, `cancelled`) veritabanı yeniden başlatmalarında korunur. Bellek içi durumlar (`idle`, `busy`, `retry`) yeniden başlatmada sıfırlanır.

#### Orkestratör Ajanı

Salt okunur koordinatör ajan (en fazla 50 adım). `task` ve `team` araçlarına erişimi vardır ancak tüm düzenleme araçları reddedilmiştir. Uygulamayı build/general ajanlara devreder ve sonuçları sentezler.

## Teknik Mimari

### Çoklu Sağlayıcı Desteği

21+ sağlayıcı kullanıma hazır: Anthropic, OpenAI, Google Gemini, Azure, AWS Bedrock, Vertex AI, OpenRouter, GitHub Copilot, XAI, Mistral, Groq, DeepInfra, Cerebras, Cohere, TogetherAI, Perplexity, Vercel, Venice, GitLab, Gateway ve herhangi bir OpenAI uyumlu endpoint. Fiyatlandırma [models.dev](https://models.dev) kaynağından alınmıştır.

### Ajan Sistemi

| Agent | Mode | Access | Description |
|-------|------|--------|-------------|
| **build** | primary | full | Default development agent |
| **plan** | primary | read-only | Analysis and code exploration |
| **general** | subagent | full (no todowrite) | Complex multi-step tasks |
| **explore** | subagent | read-only | Fast codebase search |
| **orchestrator** | subagent | read-only + task/team | Multi-agent coordinator (50 steps) |
| compaction | hidden | none | AI-driven context summarization |
| title | hidden | none | Session title generation |
| summary | hidden | none | Session summarization |

### LSP Entegrasyonu

Sembol indeksleme, tanılama ve çoklu dil desteği (TypeScript, Deno, Vue ve genişletilebilir) ile tam Language Server Protocol desteği. Ajan, metin araması yerine LSP sembolleri aracılığıyla kodda gezinir; bu sayede hassas go-to-definition, find-references ve gerçek zamanlı tür hatası algılama sağlanır.

### MCP Desteği

Model Context Protocol istemci ve sunucu. stdio, HTTP/SSE ve StreamableHTTP aktarımlarını destekler. Uzak sunucular için OAuth kimlik doğrulama akışı. Tool, prompt ve resource yetenekleri. Allow/deny listeleri aracılığıyla ajan bazında kapsam belirleme.

### İstemci/Sunucu Mimarisi

Typed routes ve OpenAPI spec oluşturma özellikli Hono tabanlı REST API. PTY (pseudo-terminal) için WebSocket desteği. Gerçek zamanlı olay akışı için SSE. Basic auth, CORS, gzip sıkıştırma. TUI bir frontend'dir; sunucu herhangi bir HTTP istemcisi, web UI veya mobil uygulamadan yönetilebilir.

### Bağlam Yönetimi

Token kullanımı modelin bağlam sınırına yaklaştığında AI güdümlü özetleme ile auto-compact. Yapılandırılabilir eşiklerle token farkındalıklı budama (`PRUNE_MINIMUM` 20KB, `PRUNE_PROTECT` 40KB). Skill tool çıktıları budamadan korunur.

### Düzenleme Motoru

Hunk doğrulamalı unified diff yamalama. Tam dosya üzerine yazma yerine belirli dosya bölgelerine hedefli hunk'lar uygular. Dosyalar arası toplu işlemler için multi-edit tool.

### İzin Sistemi

Wildcard desen eşleştirmeli 3 durumlu izinler (`allow` / `deny` / `ask`). Ayrıntılı kontrol için 100+ bash komutu arity tanımı. Proje sınır uygulaması, workspace dışındaki dosya erişimini engeller.

### Git Destekli Geri Alma

Her araç çalıştırması öncesinde dosya durumunu kaydeden snapshot sistemi. Diff hesaplamalı `revert` ve `unrevert` desteği. Değişiklikler mesaj veya oturum bazında geri alınabilir.

### Maliyet Takibi

Tam token dökümüyle mesaj başına maliyet (input, output, reasoning, cache read, cache write). Takım başına bütçe limitleri (`max_cost`). Model ve gün bazında toplama yapan `stats` komutu. TUI'da gerçek zamanlı oturum maliyeti gösterimi. Fiyatlandırma verileri models.dev'den alınır.

### Eklenti Sistemi

Hook mimarili tam SDK (`@opencode/plugin`). npm paketlerinden veya dosya sisteminden dinamik yükleme. Codex, GitHub Copilot, GitLab ve Poe kimlik doğrulaması için yerleşik eklentiler.

---

## Yaygın Yanlış Anlamalar

Bu projenin AI tarafından oluşturulan özetlerinden kaynaklanan karışıklığı önlemek için:

- **TUI TypeScript'tir** (terminal render için SolidJS + @opentui), Rust değil.
- **Tree-sitter** yalnızca TUI sözdizimi vurgulama ve bash komut ayrıştırma için kullanılır, ajan düzeyinde kod analizi için değil.
- **Docker/E2B sandboxing yoktur** -- izolasyon git worktree'ler tarafından sağlanır.
- **Vektör veritabanı veya RAG sistemi yoktur** -- bağlam LSP symbol indexing + auto-compact ile yönetilir.
- **Otomatik düzeltmeler öneren bir "watch mode" yoktur** -- file watcher yalnızca altyapı amaçlıdır.
- **Kendini düzeltme** standart ajan döngüsünü kullanır (LLM araç sonuçlarındaki hataları görür ve yeniden dener), özel bir otomatik onarım mekanizması değil.

## Yetenek Matrisi

| Yetenek | Status | Notes |
|-----------|--------|-------|
| Background tasks | Implemented | `mode: "background"` on task tool |
| Agent teams (DAG) | Implemented | Wave-based parallel execution, budget control |
| Git worktree isolation | Implemented | Auto-created per background task |
| Task REST API | Implemented | 8 endpoints for full lifecycle |
| TUI task dashboard | Implemented | Sidebar + dialog actions |
| MCP agent scoping | Implemented | Per-agent allow/deny config |
| 9-state lifecycle | Implemented | Persistent to SQLite |
| Orchestrator agent | Implemented | Read-only coordinator |
| Multi-provider (21+) | Implemented | Including local models |
| LSP integration | Implemented | Symbols, diagnostics, multi-language |
| MCP protocol | Implemented | Client + server, 3 transports |
| Plugin system | Implemented | SDK + hook architecture |
| Cost tracking | Implemented | Per-message, per-team, per-model |
| Context auto-compact | Implemented | AI summarization + pruning |
| Git rollback/snapshots | Implemented | Revert/unrevert per message |
| Docker sandboxing | Implemented | Optional via `experimental.sandbox.type: "docker"` |
| Vector DB / RAG | Not implemented | LSP + auto-compact covers needs |
| Dry run / command preview | Not implemented | Permission system validates pre-exec |
| Per-message token display | Partial | Stored in DB, shown as session aggregate |

---

### Kurulum

```bash
# YOLO
curl -fsSL https://opencode.ai/install | bash

# Paket yöneticileri
npm i -g opencode-ai@latest        # veya bun/pnpm/yarn
scoop install opencode             # Windows
choco install opencode             # Windows
brew install anomalyco/tap/opencode # macOS ve Linux (önerilir, her zaman güncel)
brew install opencode              # macOS ve Linux (resmi brew formülü, daha az güncellenir)
sudo pacman -S opencode            # Arch Linux (Stable)
paru -S opencode-bin               # Arch Linux (Latest from AUR)
mise use -g opencode               # Tüm işletim sistemleri
nix run nixpkgs#opencode           # veya en güncel geliştirme dalı için github:anomalyco/opencode
```

> [!TIP]
> Kurulumdan önce 0.1.x'ten eski sürümleri kaldırın.

### Masaüstü Uygulaması (BETA)

OpenCode ayrıca masaüstü uygulaması olarak da mevcuttur. Doğrudan [sürüm sayfasından](https://github.com/anomalyco/opencode/releases) veya [opencode.ai/download](https://opencode.ai/download) adresinden indirebilirsiniz.

| Platform              | İndirme                               |
| --------------------- | ------------------------------------- |
| macOS (Apple Silicon) | `opencode-desktop-darwin-aarch64.dmg` |
| macOS (Intel)         | `opencode-desktop-darwin-x64.dmg`     |
| Windows               | `opencode-desktop-windows-x64.exe`    |
| Linux                 | `.deb`, `.rpm` veya AppImage          |

```bash
# macOS (Homebrew)
brew install --cask opencode-desktop
# Windows (Scoop)
scoop bucket add extras; scoop install extras/opencode-desktop
```

#### Kurulum Dizini (Installation Directory)

Kurulum betiği (install script), kurulum yolu (installation path) için aşağıdaki öncelik sırasını takip eder:

1. `$OPENCODE_INSTALL_DIR` - Özel kurulum dizini
2. `$XDG_BIN_DIR` - XDG Base Directory Specification uyumlu yol
3. `$HOME/bin` - Standart kullanıcı binary dizini (varsa veya oluşturulabiliyorsa)
4. `$HOME/.opencode/bin` - Varsayılan yedek konum

```bash
# Örnekler
OPENCODE_INSTALL_DIR=/usr/local/bin curl -fsSL https://opencode.ai/install | bash
XDG_BIN_DIR=$HOME/.local/bin curl -fsSL https://opencode.ai/install | bash
```

### Ajanlar

OpenCode, `Tab` tuşuyla aralarında geçiş yapabileceğiniz iki yerleşik (built-in) ajan içerir.

- **build** - Varsayılan, geliştirme çalışmaları için tam erişimli ajan
- **plan** - Analiz ve kod keşfi için salt okunur ajan
  - Varsayılan olarak dosya düzenlemelerini reddeder
  - Bash komutlarını çalıştırmadan önce izin ister
  - Tanımadığınız kod tabanlarını keşfetmek veya değişiklikleri planlamak için ideal

Ayrıca, karmaşık aramalar ve çok adımlı görevler için bir **genel** alt ajan bulunmaktadır.
Bu dahili olarak kullanılır ve mesajlarda `@general` ile çağrılabilir.

[Ajanlar](https://opencode.ai/docs/agents) hakkında daha fazla bilgi edinin.

### Dokümantasyon

OpenCode'u nasıl yapılandıracağınız hakkında daha fazla bilgi için [**dokümantasyonumuza göz atın**](https://opencode.ai/docs).

### Katkıda Bulunma

OpenCode'a katkıda bulunmak istiyorsanız, lütfen bir pull request göndermeden önce [katkıda bulunma dokümanlarımızı](./CONTRIBUTING.md) okuyun.

### OpenCode Üzerine Geliştirme

OpenCode ile ilgili bir proje üzerinde çalışıyorsanız ve projenizin adının bir parçası olarak "opencode" kullanıyorsanız (örneğin, "opencode-dashboard" veya "opencode-mobile"), lütfen README dosyanıza projenin OpenCode ekibi tarafından geliştirilmediğini ve bizimle hiçbir şekilde bağlantılı olmadığını belirten bir not ekleyin.

### SSS

#### Bu Claude Code'dan nasıl farklı?

Yetenekler açısından Claude Code'a çok benzer. İşte temel farklar:

- %100 açık kaynak
- Herhangi bir sağlayıcıya bağlı değil. [OpenCode Zen](https://opencode.ai/zen) üzerinden sunduğumuz modelleri önermekle birlikte; OpenCode, Claude, OpenAI, Google veya hatta yerel modellerle kullanılabilir. Modeller geliştikçe aralarındaki farklar kapanacak ve fiyatlar düşecek, bu nedenle sağlayıcıdan bağımsız olmak önemlidir.
- Kurulum gerektirmeyen hazır LSP desteği
- TUI odaklı yaklaşım. OpenCode, neovim kullanıcıları ve [terminal.shop](https://terminal.shop)'un geliştiricileri tarafından geliştirilmektedir; terminalde olabileceklerin sınırlarını zorlayacağız.
- İstemci/sunucu (client/server) mimarisi. Bu, örneğin OpenCode'un bilgisayarınızda çalışması ve siz onu bir mobil uygulamadan uzaktan yönetmenizi sağlar. TUI arayüzü olası istemcilerden sadece biridir.

---

**Topluluğumuza katılın** [Discord](https://discord.gg/opencode) | [X.com](https://x.com/opencode)
