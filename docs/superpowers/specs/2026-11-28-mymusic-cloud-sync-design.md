# MyMusic — Kendi sunucuda bulut, iki bilgisayar arası eşitleme, kayıt işlemleri, ışık rengi

Tarih: 2026-11-28. Önceki tasarımlar geçerli: `2026-11-24-mymusic-design.md`, `2026-11-24-mymusic-ui-redesign-design.md`, `2026-11-25-mymusic-cover-chords-design.md`.

## Amaç ve neden

Kullanıcı (gitarist) kayıtlarını **telefondan dinlemek** ve **başkalarıyla paylaşmak** istiyor. Ayrıca bazen **MacBook'tan** çalıp kayıt alacak; bu yüzden şarkı listesi, akorlar, kapaklar, MP3 parçalar ve kayıtlar iki bilgisayarda (Windows + Mac) aynı olmalı. Kullanıcının kendi sunucusu var ve onu kullanmak istiyor. Ek olarak: her kaydın yanında **Sil / İndir / Paylaş**, kayıt sırasında **video önizlemesini gizleme**, ve **ışık rengini kendisi seçme**.

## Kullanıcının ortamı (sunucu)

- `https://emiraksu.me`, Ubuntu. Host üzerinde **Caddy** (443, `/etc/caddy/Caddyfile` + `/etc/caddy/projects/` dizini), **Docker** (birçok container, portları `127.0.0.1` / `172.17.0.1`'e bağlı), host'ta Postgres (kullanılmayacak), birkaç cloudflared tüneli.
- Sunucuya Claude erişemez; kurulumu kullanıcı komutlarla yapar.

## Hedefler

### A. Sunucu (`music.emiraksu.me`)
1. Node.js (TypeScript) + SQLite (tek dosya) servisi, tek Docker image (ffmpeg dahil), `docker compose` ile; port `127.0.0.1:8120`. Veriler bir volume'da: `/data/db.sqlite`, `/data/files/...`.
2. Caddy bloğu: `music.emiraksu.me { reverse_proxy 127.0.0.1:8120 }` (yeni dosya `/etc/caddy/projects/mymusic.caddy`; `Caddyfile`'ın bu dizini içe aktardığı varsayılır, değilse `import` satırı eklenir). DNS: `music` A/AAAA kaydı sunucuya (kullanıcı ekler).
3. **Kimlik:** tek kullanıcı. Şifre `OWNER_PASSWORD` ortam değişkeninden. `POST /api/login {password}` → uzun ömürlü rastgele **token** (SQLite'ta saklanır, iptal edilebilir). Uygulama `Authorization: Bearer` ile gönderir. Telefon sayfası aynı token'ı `HttpOnly; Secure; SameSite=Lax` çerezde tutar. Yanlış şifre denemeleri yavaşlatılır (IP başına basit sınır).
4. **CORS:** `/api/*` yalnızca `https://overflow-sudo.github.io` ve `http://localhost:5173/5174` kökenlerine izin verir.
5. **Kütüphane API (şarkılar):**
   - `GET /api/library` → `{ songs: SongRecord[] }` (silinenler `deletedAt` ile dahil).
   - `PUT /api/songs/:id` gövde = şarkı JSON'u. **Şarkı bazında son yazan kazanır:** sunucu yalnızca `incoming.updatedAt > stored.updatedAt` ise kaydeder; cevap her zaman sunucudaki güncel kayıttır.
   - Silme bir "mezar taşı"dır: `deletedAt` ve `updatedAt` ayarlanmış şarkı `PUT` edilir; dosyaları (parça, kapak) sunucuda silinir; kayıtlar silinmez (kullanıcı ayrıca siler).
   - Cihaza özgü ayarlar (gecikme telafisi, cihaz seçimleri, ışık tercihi) **eşitlenmez**.
6. **Dosya API (parça, kapak):** `PUT/GET/DELETE /api/songs/:id/track` ve `/cover`. `PUT` ham gövde + `X-File-Name`, `Content-Type`; sunucu SHA-256 hesaplar ve şarkı kaydındaki `track.hash` / `cover.hash` ile eşleşmesini döner. Parçalar **asla** paylaşım bağlantısıyla ya da telefon sayfasında verilmez.
7. **Kayıt API:**
   - `PUT /api/recordings/:id` (ham webm gövde) + başlıklar `X-Song-Id`, `X-Kind` (`video`/`ses`), `X-Recorded-At` (ISO), `X-File-Name`. `:id` istemcide belirlenir: `sha256(songId + '/' + fileName)` ilk 32 hex → aynı kayıt iki kez yüklenmez (idempotent; varsa 200).
   - `GET /api/recordings` → `{ id, songId, kind, recordedAt, fileName, size, durationSec, status: 'processing'|'ready'|'failed', shared: boolean }[]`.
   - `GET /api/recordings/:id/url` → 1 saat geçerli imzalı oynatma adresi (`/files/rec/:id?exp=&sig=`, HMAC) — `<audio>/<video>` başlık gönderemediği için. Hazırsa MP4/M4A, değilse orijinal webm.
   - `DELETE /api/recordings/:id` → dosyalar + kayıt + paylaşım silinir.
   - **Dönüştürme:** yükleme bitince sıraya alınır; ffmpeg tek seferde bir iş: video → MP4 (H.264 + AAC 192k, `+faststart`), ses → M4A (AAC 192k). Başarısızsa `failed`, orijinal yine oynatılabilir. Süre `ffprobe` ile.
   - Yükleme boyutu sınırı 4 GB; yüklemeler 32 MB'lık parçalarla yapılır (bkz. ek karar 3), kopan yükleme baştan denenir.
8. **Paylaşım:** `POST /api/recordings/:id/share` → `{ url: 'https://music.emiraksu.me/r/<token>' }` (token 22+ karakter rastgele; aynı kayıt için var olanı döner). `DELETE .../share` iptal. Herkese açık `GET /r/<token>`: şarkı adı, sanatçı, kapak, oynatıcı, İndir; `noindex`. Başka hiçbir veri görünmez.
9. **Telefon sayfası** (`/`): sade, koyu, uygulamayla aynı görsel dil; giriş (şifre) → şarkılara göre gruplu kayıtlar (yeni üstte), oynatıcı, Paylaş (bağlantıyı kopyala / Web Share), İndir. Bağımlılıksız statik HTML/JS.
10. Sağlık: `GET /api/health`. Loglar stdout'a. Yedek: `/data` klasörünü kopyalamak yeterli (README'de yazılır).

### B. Uygulama — eşitleme
1. **Ayarlar → Bulut:** sunucu adresi (varsayılan `https://music.emiraksu.me`), şifre → token alınır ve tarayıcıda saklanır (localStorage; şifre saklanmaz). Durum: "Bağlı", "Eşitleniyor…", "Çevrimdışı", "Giriş gerekli". "Şimdi eşitle" ve "Çıkış yap".
2. **Kütüphane eşitleme:** açılışta, bağlantı gelince, her değişiklikten ~2 sn sonra (debounce) ve 60 sn'de bir:
   - Sunucudan çek; her şarkı için `updatedAt`'i büyük olan kazanır (mezar taşları dahil); yerelde daha yeni olanları `PUT` et; birleşmiş sonucu yerel `mymusic.json`'a yaz.
   - Yerel silme artık mezar taşı bırakır (`deletedAt`); arayüz silinenleri göstermez. `parseLibrary` `deletedAt`'i kabul eder.
   - `updatedAt` karşılaştırması iki bilgisayarın saat farkından etkilenebilir; kabul edildi (aynı anda kullanılmıyor).
3. **Parça ve kapak eşitleme:** şarkı kaydı `track.hash` / `cover.hash` taşır (SHA-256, yerelde içe aktarırken hesaplanır). Yerelde var + sunucuda yok/farklı → yükle; sunucuda var + yerelde yok/farklı → indir ve şarkı klasörüne yaz. Mac'te ilk açılışta tüm parçalar ve kapaklar iner.
4. **Kayıt yükleme:** her eşitlemede yerel kayıt dosyaları ile sunucu listesi karşılaştırılır; sunucuda olmayanlar sırayla (tek tek) yüklenir. Ayrı bir kuyruk durumu tutulmaz (karşılaştırma kuyruğun kendisidir). Yükleme kayıt sırasında **yapılmaz** (bant genişliği ve CPU kayıtla yarışmasın); kayıt bitince devam eder.
5. **Kayıt listesi:** yerel + sunucu kayıtları birleşik; her satırda durum: ☁ yüklendi / ⇡ yükleniyor / yalnız bu bilgisayarda / yalnız bulutta. Oynatma: yerel dosya varsa yerelden, yoksa imzalı sunucu adresinden.
6. **Satır butonları:** **İndir** (yerelse yerel dosya, değilse sunucudaki MP4/M4A — `<a download>` ile), **Paylaş** (bağlantıyı oluşturur ve panoya kopyalar; "Bağlantı kopyalandı"; paylaşımı kaldırma seçeneği), **Sil** (onay: "Bu kayıt bu bilgisayardan ve buluttan silinsin mi?" → yerel dosya + sunucu). Bulut bağlı değilse Paylaş gizli, Sil yalnız yereli siler.
7. Çevrimdışıyken her şey yerelde çalışır; bağlantı gelince eşitlenir. Hatalar sessiz bir durum satırıyla gösterilir, kayıt akışını asla bozmaz.

### C. Uygulama — küçük işler
1. **Önizlemeyi gizle:** kayıt ekranında sahnenin köşesinde bir düğme (göz ikonu, `aria-pressed`). Gizliyken kamera akışı ve kayıt devam eder; ekranda önizleme yerine (akor varsa) büyük akor sayfası, yoksa boş koyu sahne. Seçim cihazda hatırlanır. Ses modunda düğme görünmez.
2. **Işık rengi:** ⚙ Ayarlar'da "Işık rengi": **Otomatik** (tempoya göre, mevcut) veya **Sabit**: 8 hazır renk + renk seçici. Şarkının ⚙ panelinde "Bu şarkının rengi" (Genel / kendi rengi) — şarkı rengi eşitlenir (`song.lightColor?: string`, `#rrggbb`), genel tercih cihaza özgü. Uygulama hex'i tona (hue) çevirip mevcut ışık formülüne verir; doygunluğu çok düşük renkler (gri) için minimum doygunluk korunur. Gitar seviyesi tonu yine hafifçe kaydırır yalnızca Otomatik modda; Sabit modda ton sabit, yalnız parlaklık değişir.

## Hedef olmayanlar
Çok kullanıcı / hesaplar, kaldığı yerden devam eden yükleme, alan bazında birleştirme, kayıtların her cihaza otomatik indirilmesi, sunucuda kayıt düzenleme, uygulamanın telefondan kayıt alması, Safari desteği.

## Başarısızlık sayılacak şeyler
- Bir kaydın kaybolması (yükleme yarıda kalınca yerel dosya silinirse, ya da sunucu silmesi yereldeki eşleşmeyen dosyayı silerse).
- Paylaşım bağlantısıyla parça (MP3), başka kayıt ya da liste görülebilmesi.
- Eşitlemenin kayıt sırasında takılma, gecikme yaratması.
- Token/şifrenin repoya, URL'ye ya da loglara yazılması.
- Mac'te ilk açılışta parçaların inmemesi yüzünden kayıt alınamaması.

## Kısıtlar
- Uygulama GitHub Pages'te (`https://overflow-sudo.github.io/MyMusic/`), statik; tüm sunucu iletişimi `fetch` ile, CORS üzerinden.
- Sunucu kodu bu depoda `server/` altında; kendi `package.json`'ı, testleri (Vitest + supertest benzeri), `Dockerfile`, `compose.yaml`, `mymusic.caddy`, Türkçe `server/KURULUM.md`.
- Gizli değerler (şifre, HMAC anahtarı) yalnız sunucudaki `.env`'de; repoya örnek `.env.example`.

## Yaklaşımlar
| Yaklaşım | Artısı | Eksisi |
|---|---|---|
| **Node.js + SQLite + Docker, Caddy arkasında (seçilen)** | Uygulamayla aynı dil, ortak tipler; tek dosya veritabanı; mevcut düzene uyar | Postgres'ten yararlanmaz |
| Python FastAPI + SQLite | Sunucuda Python zaten var | İki dilde tekrar eden şemalar |
| Node.js + mevcut Postgres | Mevcut yedekleme | Ek bağımlılık ve kurulum |
| OneDrive klasörü / Drive API | Az kod | Kullanıcı kendi sunucusunu istedi |

Yükleme: basit yükleme seçildi.

## Kullanıcının kararları
- Kendi sunucu (`emiraksu.me`); telefon + paylaşım; MP3'ler de sunucuya (özel); MacBook'tan da kullanım → eşitleme; şarkı bazında son değişiklik kazanır; basit yükleme; Sil/İndir/Paylaş; önizleme gizleme; ışık rengini kendisi seçer.

## Benim kararlarım (düzeltilebilir)
- Alt alan adı `music.emiraksu.me`, port `127.0.0.1:8120`, SQLite.
- Sunucuda MP4/M4A dönüştürme (iPhone uyumu).
- Kayıtlar diğer bilgisayara otomatik inmez, sunucudan oynatılır.
- Cihaza özgü ayarlar eşitlenmez; şarkı rengi eşitlenir.
- Kayıt sırasında yükleme durur.
- Telefon sayfası tek şifreyle; paylaşım bağlantıları kayıt başına, iptal edilebilir.

## Kurucu kontrolünden sonra eklenen kararlar (benim kararlarım)

1. **Kayıt silme diğer bilgisayara da ulaşır.** Sunucu silinen kaydın kimliğini mezar taşı olarak saklar (`deletedRecordings`, `GET /api/recordings` bunları `deleted: true` ile döner). Bir bilgisayar eşitlemede mezar taşı görürse o kaydın yerel dosyasını siler ve asla yeniden yüklemez. (Kayıtlar diğer bilgisayara otomatik inmediği için yerel kopya normalde yalnız kaydın alındığı bilgisayardadır; kullanıcının Sil isteği budur.) Bulut bağlı değilken yapılan yerel silmeler sunucuya bağlanınca gönderilir (yerelde küçük bir "bekleyen silmeler" listesi, `mymusic.json` içinde `pendingDeletes`).
2. **Şarkı silinince kayıtları:** kayıtlar sunucuda kalır. Uygulamada silinen şarkıyla birlikte gizlenir; telefon sayfasında "Silinen şarkılar" grubunda görünür ve silinebilir. Paylaşım sayfası için kayıt satırı yüklenirken şarkı adı/sanatçı kopyası (`songTitle`, `songArtist`) saklanır. Yerel `recordings/<klasör>` dosyaları (mevcut davranış gereği) diskte kalır ve yüklenmeye devam eder.
3. **Yükleme parçalı ama basit:** Cloudflare proxy'si (varsa) istek gövdesini ~100 MB ile sınırladığı için her dosya 32 MB'lık parçalar halinde gönderilir: `POST /api/uploads` → `{uploadId}`, `PUT /api/uploads/:id/:n`, `POST /api/uploads/:id/complete {kind: 'recording'|'track'|'cover', ...meta}`. Kopma olursa yükleme baştan başlar (kaldığı yerden devam yok — kullanıcı kararı korunur). Tamamlanmamış yüklemeler 24 saat sonra silinir. Bu, alan adının Cloudflare arkasında olup olmamasından bağımsız çalışır.
4. **Parça/kapak çakışması:** birleşmiş şarkı kaydındaki `hash` esastır. Yerel dosyanın hash'i bununla eşleşmiyorsa: yerel dosya şarkı kaydının yerelde yeni olduğu durumda yüklenir, aksi halde sunucudaki indirilir. Sunucuda dosya henüz yoksa (404) ya da hash tutmuyorsa "sonra tekrar dene" — hata değil.
5. **Sıra:** eşitleme her zaman kütüphane → parça/kapak → kayıtlar sırasıyla. Sunucu bilinmeyen şarkıya ait kayıt/parça yüklemesini 409 ile reddeder; istemci sonraki turda tekrar dener.
6. **Mac boş başlar.** İlk eşitlemede yerel kütüphane boşsa sunucudakiyle doldurulur. Mac'te önceden ayrı girilmiş şarkılar varsa ayrı şarkılar olarak birleşir (çift kayıt olabilir; kabul).
7. **Otomatik değişiklikler `updatedAt`'i ilerletmez:** kapak bulma (backfill), hash hesaplama gibi arka plan güncellemeleri `updatedAt`'i değiştirmez. Birleştirmede `updatedAt` eşitse `cover` ve `track.hash` alanları için dolu olan taraf alınır (boş olanın üzerine yazılmaz). Kullanıcının yaptığı her değişiklik `updatedAt`'i ilerletir.

## Kurucuya kalanlar
- Sunucu iç yapısı (router, katmanlar), SQLite kütüphanesi (`better-sqlite3` önerilir), ffmpeg çağrısı, telefon sayfasının görünüşü (uygulamanın tokenlarıyla), istemci eşitleme modülünün iç yapısı, hata metinleri.
