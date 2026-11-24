# MyMusic

Gitar çalışırken kendini ses veya video olarak kaydetmeni sağlayan, tamamen tarayıcıda çalışan küçük bir uygulama. Şarkılarını listeler, istersen arkada bir MP3 çaldırır (önce metronom ön sayımı), kaydı bilgisayarındaki bir klasöre yazar. Sunucu yok, hesap yok, ağ çağrısı yok.

Canlı sürüm: https://overflow-sudo.github.io/MyMusic/

> Bu adres, değişiklikler `main` dalına birleştirildikten ve GitHub'da Pages etkinleştirildikten sonra çalışır (Settings → Pages → Source: **GitHub Actions**).

## İlk kullanım

1. Chrome veya Edge ile uygulamayı aç (başka tarayıcılar desteklenmez).
2. **Klasör seç** düğmesine bas ve kayıtların saklanacağı bir klasör seç. Tarayıcı izin ister; onayla.
3. Seçtiğin klasörde şu yapı oluşur:

```
<seçtiğin klasör>/
  mymusic.json                       şarkı listesi ve ayarlar
  recordings/
    <şarkı-klasörü>/
      track.mp3                      arka plan parçası (varsa)
      2026-11-24_18-30-00_ses.webm   ses kaydı
      2026-11-24_18-30-00_video.webm video kaydı
  .parcalar/                         yarım kalan kayıt parçaları (otomatik)
```

Bir şarkıyı silmek dosyalarını silmez; dosyalar klasörde kalır.

## Kullanım

**Liste ekranı**: şarkılar sekmelerle (Çalıştığım / Bildiğim) listelenir, üstteki arama kutusuyla süzülür. Sağ üstteki **⚙** genel ayar panelini açar: gecikme telafisi (ms; boş bırakırsan otomatik ölçülür) ve **Işık** seçimi. Esc paneli kapatır.

**Şarkı ekranı**: şarkıyı açtığında ses modu hazır gelir ve mikrofon kendiliğinden açılır (tarayıcı ilk seferde izin ister). İzin verilmezse ekran yine kullanılabilir; **Ses** veya **Video** düğmesine tekrar basmak cihazı yeniden dener. Şarkı başlığındaki **⚙** şarkıya özel paneli açar: durum, tempo, sayım vuruşu, arka plan parçası, cihazlar, ışık ve düzenle / sil.

### Kayıt

- **Boşluk (Space)**: kaydı başlatır / durdurur.
- **Esc**: ön sayım sırasında kaydı iptal eder.
- Bir giriş kutusuna yazarken veya oynatıcı düğmelerindeyken Space kayıt başlatmaz.
- Arka plan parçası varsa önce metronom ön sayımı çalar, sonra parça başlar; parça bitince kayıt 2 saniye sonra kendiliğinden durur.
- Metronom sesi kayda girmez; arka plan parçası girer.
- Kayıt sırasında uygulamayı ikinci bir sekmede/pencerede açma: ikinci pencere devam eden kaydı yarım kayıt sanıp kurtarmaya çalışır.
- Sekmeyi kayıt sırasında kapatırsan, uygulamayı tekrar açtığında "yarım kayıt kurtarıldı" mesajı çıkar ve dosya kurtarılır.

### Parça ve başlangıç noktası

Şarkı ayarları panelinde bir MP3 seç (**Parça seç**). Parçayı oynatırken **Buradan başla** düğmesi o anki konumu başlangıç noktası olarak kaydeder; kayıt bu noktadan başlar.

### İleri / geri sarma

Parça önizlemesinde ve kayıtlar listesindeki oynatıcılarda **5 saniye geri / ileri** düğmeleri ve ilerleme çubuğu vardır. Kayıt sırasında sarma yoktur. Aynı anda tek ortam çalar: kayıt başlayınca tüm oynatıcılar durur.

### Işık

Ekran, şarkının temposuna göre nabız atan bir ışıkla yanar (kayıtta metronomla birebir, boştayken şarkı temposuyla, liste ekranında yavaş bir nefes gibi). Gitar sesi yükseldikçe ışık parlar ve tonu kayar. Üç seçenek vardır:

- **A · Alttan parıltı**: ışık ekranın altından yükselir (varsayılan).
- **C · Tüm ekran**: arka planın tamamı ışıkla dolar (metin okunur kalsın diye açıklık sınırlıdır).
- **Kapalı**: ışık yok.

Seçimi liste ekranındaki **⚙** panelinden veya şarkı ekranındaki **⚙** panelinin **Işık** bölümünden değiştirebilirsin; seçim tarayıcıda saklanır. Sistemde "hareketi azalt" açıksa ışık nabız atmaz, sabit parlar.

## Voicemeeter ipucu

- Mikrofon olarak **Voicemeeter Out B1** seç.
- Metronom çıkışını M-Audio kulaklığa ver.
- Bu çıkış seçilemiyorsa tarayıcı sesini yalnızca **A1**'e yönlendir (kulaklık). **B**'ye yönlendirme: tarayıcı sesi bir B hattına giderse metronom kayda girer ve arka plan parçası ikinci kez, gecikmeli olarak karışır.

## Gecikme telafisi

Arka plan parçası kayıtta gitarla kayık duyuluyorsa liste ekranındaki **⚙** panelinden gecikme telafisini değiştir ve bir deneme kaydı al. Zamanında oturana kadar küçük adımlarla ayarla.

## Uygulama olarak yükle

Edge'de adres çubuğundaki yükle simgesine veya menü → **Uygulama olarak yükle**'ye bas. Böylece MyMusic ayrı bir pencerede açılır.

## Geliştirme

```
npm install
npm run dev     # yerel geliştirme sunucusu
npm test        # testler
npm run build   # üretim derlemesi (dist/)
```

`main` dalına her push, GitHub Actions ile Pages'e yayınlanır (`.github/workflows/pages.yml`).

## Deneme listesi

Bu adımlar kendi donanımınla elle denenmelidir:

1. Klasör seç → `mymusic.json` oluştu.
2. Şarkı ekle, şarkıyı aç (mikrofon kendiliğinden açılmalı), Voicemeeter Out B1 seçiliyken ses kaydet → dosya çalıyor, stereo, tık sesi duyulmuyor.
3. Video kaydet → sesli oynuyor; 5 sn ileri / geri sarma çalışıyor.
4. Başlangıç noktalı bir MP3 ekle → kulaklıkta ön sayım, sonra parça duyuluyor; kayıtta gitar + parça var; gecikme telafisini zamanında olana kadar ayarla.
5. Kayıt sırasında sekmeyi kapat, tekrar aç → "1 yarım kayıt kurtarıldı", dosya çalıyor.
6. Edge → "Uygulama olarak yükle".
7. ⚙ panelinde Işık A / C / Kapalı değiştir → ışık hemen değişiyor.
