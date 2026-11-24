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

## Kayıt

- **Boşluk (Space)**: kaydı başlatır / durdurur.
- **Esc**: ön sayım sırasında kaydı iptal eder.
- Bir giriş kutusuna yazarken Space kayıt başlatmaz.
- Arka plan parçası varsa önce metronom ön sayımı çalar, sonra parça başlar; parça bitince kayıt 2 saniye sonra kendiliğinden durur.
- Metronom sesi kayda girmez; arka plan parçası girer.
- Sekmeyi kayıt sırasında kapatırsan, uygulamayı tekrar açtığında "yarım kayıt kurtarıldı" mesajı çıkar ve dosya kurtarılır.

## Voicemeeter ipucu

- Mikrofon olarak **Voicemeeter Out B1** seç.
- Metronom çıkışını M-Audio kulaklığa ver.
- Bu çıkış seçilemiyorsa tarayıcı sesini yalnızca **A1**'e yönlendir, **B**'ye yönlendirme (yoksa metronom/parça kayda çifte girer).

## Gecikme telafisi

Arka plan parçası kayıtta gitarla kayık duyuluyorsa ayarlardaki gecikme telafisini değiştir ve bir deneme kaydı al. Zamanında oturana kadar küçük adımlarla ayarla.

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
2. Şarkı ekle, Voicemeeter Out B1 seçiliyken ses kaydet → dosya çalıyor, stereo, tık sesi duyulmuyor.
3. Video kaydet → sesli oynuyor.
4. Başlangıç noktalı bir MP3 ekle → kulaklıkta ön sayım, sonra parça duyuluyor; kayıtta gitar + parça var; gecikme telafisini zamanında olana kadar ayarla.
5. Kayıt sırasında sekmeyi kapat, tekrar aç → "1 yarım kayıt kurtarıldı", dosya çalıyor.
6. Edge → "Uygulama olarak yükle".
