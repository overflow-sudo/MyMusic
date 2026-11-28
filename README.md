# MyMusic

Gitar çalışırken kendini ses veya video olarak kaydetmeni sağlayan, tamamen tarayıcıda çalışan küçük bir uygulama. Şarkılarını listeler, istersen arkada bir MP3 çaldırır (önce metronom ön sayımı), kaydı bilgisayarındaki bir klasöre yazar. Sunucu yok, hesap yok; tek ağ çağrısı albüm kapağı aramasıdır (bkz. **Kapak**).

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

**Şarkı ekranı**: şarkıyı açtığında ses modu hazır gelir ve mikrofon kendiliğinden açılır (tarayıcı ilk seferde izin ister). İzin verilmezse ekran yine kullanılabilir; **Ses** veya **Video** düğmesine tekrar basmak cihazı yeniden dener. Şarkı başlığındaki **⚙** şarkıya özel paneli açar: kapak, durum, tempo, sayım vuruşu, arka plan parçası, akorlar, cihazlar, ışık ve düzenle / sil.

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

### Kapak

Şarkı eklediğinde albüm kapağı Apple'ın (iTunes) arama servisinden arka planda, kendiliğinden bulunur ve şarkı klasörüne `cover.jpg` olarak kaydedilir. Kapağı olmayan eski şarkılar da liste açılınca aranır. Listede küçük, şarkı ekranında büyük gösterilir; kapak yoksa şarkı adının ilk harfi görünür.

- **Gizlilik:** Apple'a yalnızca şarkı adı ve sanatçı adı gönderilir. Kayıtların, parçaların ve klasörün hiçbir zaman bilgisayarından çıkmaz.
- Şarkı ekranındaki **⚙** panelinin **Kapak** bölümünden: **Kapağı yeniden bul** (aramayı tekrarlar), **Kendi resmini seç** (bilgisayarından bir resim), **Kaldır** (kapağı siler; kaldırdığın kapak bir daha kendiliğinden aranmaz).
- İnternet yoksa veya kapak bulunamazsa uygulama normal çalışır, yalnızca harf gösterilir.

### Akorlar

Şarkının akorlarını kendin yapıştırırsın; uygulama akor sitelerinden bir şey çekmez.

1. Şarkı ekranında **⚙** → **Akorlar** bölümünde **Akorları ara ↗** bağlantısı, şarkı adı + sanatçı + "chords" için Google aramasını yeni sekmede açar.
2. Bulduğun akorları kopyala ve metin alanına yapıştır. Alandan çıktığında kaydedilir (`mymusic.json` içinde); alanı boşaltırsan akorlar kaldırılır. Alanın altında küçük bir önizleme görünür.
3. Akor varsa kayıt ekranında sahnenin yanında (dar ekranda altında) büyük, sabit genişlikli yazıyla gösterilir ve kendi içinde kaydırılır. Akor yoksa sahne eskisi gibi tam genişliktedir.

Tanınan biçimler:

- **Akor satırları**: satırdaki tüm sözcükler akorsa (ör. `Am   G   C/E   F#m7`) akorlar renkli gösterilir, boşluklar korunur; böylece alttaki söz satırıyla hizalı kalır.
- **Satır içi akorlar**: `[Am]Bugün [G]yine` gibi; akor, ait olduğu hecenin üstünde küçük yazılır.
- **Bölüm başlıkları**: `[Verse]`, `[Chorus]`, `[Nakarat]` gibi akor olmayan köşeli parantezler küçük bir etiket olur.

Akor alanına yazarken Boşluk (Space) kayıt başlatmaz.

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

## Bulut (kendi sunucun)

İstersen şarkı listeni, parçaları ve kayıtları kendi sunucuna eşitleyebilir, kayıtları link ile paylaşabilirsin. Sunucu Docker ile kurulur; adım adım rehber: [server/KURULUM.md](server/KURULUM.md).

### Bağlanma

**⚙ Ayarlar → Bulut** bölümünde sunucu adresini ve parolanı gir, **Bağlan**'a bas. Bağlanınca eşitleme arka planda kendiliğinden çalışır (açılışta, değişiklikten birkaç saniye sonra, dakikada bir, internet geri gelince). **Şimdi eşitle** bunu hemen başlatır. Kayıt sırasında dosya aktarımı durur, kayıt bitince devam eder.

### Neler eşitlenir

- Eşitlenir: şarkılar (ad, sanatçı, tempo, durum, **akorlar**, **kapaklar**), arka plan **parçaları** ve **kayıtlar**.
- Eşitlenmez (her cihazda ayrı): cihaz ve gecikme ayarları, ışık seçimi, mikrofon/kulaklık seçimi, önizleme gizleme.

### Kayıtlar listesi ve durum simgeleri

Şarkı ekranındaki **Kayıtlar** listesi bu bilgisayardaki ve yalnızca bulutta olan (ör. Mac'te çekilen) kayıtları birlikte gösterir. Her satırdaki simge durumu söyler:

- **Bulut + işaret**: hem bu bilgisayarda hem bulutta.
- **Bulut**: yalnız bulutta (bu bilgisayarda dosya yok; oynat ve indir yine çalışır).
- **Bilgisayar**: yalnız bu bilgisayarda (henüz yüklenmedi).
- **Yukarı ok**: yükleniyor. **Saat**: sunucu kaydı telefon uyumlu biçime hazırlıyor.

Yalnız bulutta olan kayıt oynatılırken sunucudan geçici bir bağlantı alınır; **İndir** sunucudaki MP4 / M4A dosyasını indirir.

### Paylaşma ve telefon sayfası

- Bulutta olan bir kaydın satırında **Paylaş** (bağlantı simgesi) bağlantıyı panoya kopyalar ("Bağlantı kopyalandı"). Bağlantıyı açan kişi yalnızca o kaydı görür: şarkı adı, sanatçı, kapak, oynatıcı ve İndir. Başka hiçbir şeye erişemez.
- Paylaşılan satırda **Paylaşımı kaldır** düğmesi çıkar; bağlantı hemen çalışmaz olur.
- Henüz yüklenmemiş kayıtlar paylaşılamaz ("Önce buluta yüklenmeli").
- Telefonda sunucu adresini açıp aynı parolayla girersen kayıtlarını dinleyebilir, paylaşabilir ve paylaşımı kaldırabilirsin.

### Silme

**Sil**, "Bu kayıt bu bilgisayardan ve buluttan silinsin mi?" diye sorar; onaylarsan kayıt hem bu bilgisayardan hem sunucudan silinir, diğer bilgisayardaki kopyası da eşitlemeyle silinir. Yalnız bulutta olan bir kaydı silmek sunucudaki kaydı siler. Silinen şarkı da diğer bilgisayarlardan kalkar.

### İnternet yokken

Uygulama internetsiz de aynen çalışır: kayıtlar klasöre yazılır, listede yalnız bu bilgisayardaki kayıtlar görünür. Bağlantı gelince bekleyen yüklemeler ve silmeler kendiliğinden gönderilir. Yüklemesi yarım kalan bir dosya baştan denenir; yerel kayıt hiçbir zaman yükleme hatasıyla silinmez.

### İki bilgisayar kuralı

Aynı şarkıyı iki bilgisayarda aynı anda değiştirirsen, şarkı başına **son yapılan değişiklik kazanır** (şarkının bütün alanları son değiştirenin sürümü olur). Aynı şarkıyı iki yerde birden düzenlemekten kaçın; bir bilgisayarda değiştirip eşitlenmesini bekledikten sonra diğerinde aç.

## Deneme listesi

Bu adımlar kendi donanımınla elle denenmelidir:

1. Klasör seç → `mymusic.json` oluştu.
2. Şarkı ekle, şarkıyı aç (mikrofon kendiliğinden açılmalı), Voicemeeter Out B1 seçiliyken ses kaydet → dosya çalıyor, stereo, tık sesi duyulmuyor.
3. Video kaydet → sesli oynuyor; 5 sn ileri / geri sarma çalışıyor.
4. Başlangıç noktalı bir MP3 ekle → kulaklıkta ön sayım, sonra parça duyuluyor; kayıtta gitar + parça var; gecikme telafisini zamanında olana kadar ayarla.
5. Kayıt sırasında sekmeyi kapat, tekrar aç → "1 yarım kayıt kurtarıldı", dosya çalıyor.
6. Edge → "Uygulama olarak yükle".
7. ⚙ panelinde Işık A / C / Kapalı değiştir → ışık hemen değişiyor.
8. Yeni bir şarkı ekle → birkaç saniye içinde kapak geliyor; ⚙ → Akorlar'a akor yapıştır → kayıt ekranında sahnenin yanında görünüyor.
