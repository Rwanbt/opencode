<p align="center"><a href="SECURITY.md">English</a> | <a href="SECURITY.zh.md">简体中文</a> | <a href="SECURITY.zht.md">繁體中文</a> | <a href="SECURITY.ko.md">한국어</a> | <a href="SECURITY.de.md">Deutsch</a> | <a href="SECURITY.es.md">Español</a> | <a href="SECURITY.fr.md">Français</a> | <a href="SECURITY.it.md">Italiano</a> | <a href="SECURITY.da.md">Dansk</a> | <a href="SECURITY.ja.md">日本語</a> | <a href="SECURITY.pl.md">Polski</a> | <a href="SECURITY.ru.md">Русский</a> | <a href="SECURITY.bs.md">Bosanski</a> | <a href="SECURITY.ar.md">العربية</a> | <a href="SECURITY.no.md">Norsk</a> | <a href="SECURITY.br.md">Português (Brasil)</a> | <a href="SECURITY.th.md">ไทย</a> | <b>Türkçe</b> | <a href="SECURITY.uk.md">Українська</a> | <a href="SECURITY.bn.md">বাংলা</a> | <a href="SECURITY.gr.md">Ελληνικά</a> | <a href="SECURITY.vi.md">Tiếng Việt</a></p>

# Güvenlik

## Önemli

AI tarafından oluşturulan güvenlik raporlarını kabul etmiyoruz. Bunlardan çok sayıda alıyoruz ve hepsini incelemeye kesinlikle kaynağımız yok. Bir tanesini göndermek projeden otomatik yasaklanmanıza neden olur.

## Tehdit modeli

### Genel bakış

OpenCode, makinenizde yerel olarak çalışan AI destekli bir kodlama asistanıdır. Shell yürütme, dosya işlemleri ve web erişimi dahil güçlü araçlara erişimi olan bir ajan sistemi sağlar.

### Sandbox yok

OpenCode ajanı **sandbox'a almaz**. İzin sistemi, kullanıcıların ajanın ne yaptığının farkında olmasına yardımcı olan bir UX özelliği olarak vardır — komutları yürütmeden, dosya yazmadan vs. önce onay ister. Ancak güvenlik izolasyonu sağlamak için tasarlanmamıştır.

Gerçek izolasyona ihtiyacınız varsa OpenCode'u bir Docker kapsayıcısı veya VM içinde çalıştırın.

### Sunucu modu

Sunucu modu yalnızca opt-in'dir. Etkinleştirildiğinde, HTTP Basic Auth gerektirmek için `OPENCODE_SERVER_PASSWORD` ayarlayın. Bu olmadan sunucu kimlik doğrulaması olmadan çalışır (uyarı ile). Sunucuyu güvence altına almak son kullanıcının sorumluluğundadır — sağladığı herhangi bir işlevsellik bir güvenlik açığı değildir.

### Kapsam dışı

| Kategori | Gerekçe |
| --- | --- |
| **Etkinleştirildiğinde sunucu erişimi** | Sunucu modunu etkinleştirirseniz API erişimi beklenen davranıştır |
| **Sandbox kaçışları** | İzin sistemi bir sandbox değildir (yukarıya bakın) |
| **LLM sağlayıcısının veri işlemesi** | Yapılandırılmış LLM sağlayıcınıza gönderilen veriler, onların politikalarına tabidir |
| **MCP sunucusu davranışı** | Yapılandırdığınız harici MCP sunucuları, güven sınırımızın dışındadır |
| **Kötü amaçlı yapılandırma dosyaları** | Kullanıcılar kendi yapılandırmalarını kontrol eder; onları değiştirmek bir saldırı vektörü değildir |

---

# Güvenlik sorunlarını bildirme

Bulgularınızı sorumlu bir şekilde açıklama çabanızı takdir ediyoruz ve katkılarınızı kabul etmek için her türlü çabayı göstereceğiz.

Güvenlik sorunu bildirmek için GitHub Security Advisory ["Report a Vulnerability"](https://github.com/Rwanbt/opencode/security/advisories/new) sekmesini kullanın.

Ekip, sonraki adımları belirten bir yanıt gönderecektir. İlk yanıttan sonra güvenlik ekibi, düzeltme ve tam duyuruya doğru ilerlemeler hakkında sizi bilgilendirecek ve ek bilgi isteyebilir.

## Eskalasyon

6 iş günü içinde onay almazsanız security@anoma.ly adresine e-posta gönderebilirsiniz
