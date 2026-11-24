# MyMusic — Tasarım

Tarih: 2026-11-24

## Amaç ve neden

Gitar çalan tek bir kullanıcı için kişisel bir repertuar ve kayıt uygulaması. Kullanıcı:

- hangi şarkıları **bildiğini** ve hangilerini **çalıştığını** tek bakışta görmek,
- her şarkı için **ses ya da video kaydı** almak,
- kayıttan önce şarkının temposunda bir **metronom sayımı** duymak (sayım bitince metronom susar, kayıt başlar),
- tüm kayıtların **kendi bilgisayarında** dosya olarak durmasını istiyor.

Kullanıcının düzeni: **Windows**; gitar → **NUX MG-300** (efekt pedalı) → **M-Audio** ses kartı (Solo); ayrıca **kondenser mikrofon**; sinyaller **Voicemeeter** ile karıştırılıyor. Kullanıcı sesi **M-Audio'ya bağlı kulaklıktan** dinliyor. MG-300 bilgisayara tuş/MIDI göndermiyor; uygulamayı kontrol eden bir ayak pedalı **yok**.

## Hedefler

1. Şarkı listesi: iki sekme, **Bildiğim** ve **Çalıştığım**; arama; şarkı ekleme.
2. Şarkı alanları: ad, sanatçı, durum (bildiğim / çalıştığım), tempo (BPM), sayım vuruşu (varsayılan 4).
3. Şarkı ekranı: alanları düzenleme, durumu tek tıkla değiştirme, ses / video kaydı, o şarkının kayıtlarının listesi (en yeniden eskiye) ve uygulama içinde oynatma.
4. Kayıt akışı:
   1. Ses ya da video modu seçilir; video modunda kamera önizlemesi açılır.
   2. Kamera ve mikrofon (giriş) cihazı menüden seçilir; seçim hatırlanır. Voicemeeter sanal çıkışları (ör. "Voicemeeter Out B1") ve M-Audio doğrudan listede görünür.
   3. Kayıt öncesi giriş seviye göstergesi görünür.
   3a. **Metronom çıkışı** ayrı bir menüden seçilir (Web Audio `AudioContext.setSinkId`); varsayılan öneri M-Audio kulaklık çıkışı. Amaç tıkın kaydedilen Voicemeeter hattına (B1 vb.) girmemesi. M-Audio Voicemeeter tarafından tutulduğu için doğrudan açılamazsa, ekranda kısa bir ipucu: "Voicemeeter'da tarayıcı sesini yalnızca A1'e (kulaklık) gönder, B hattına gönderme."
   4. **● Kaydet** ya da **boşluk tuşu** → metronom şarkının BPM'inde N vuruş sayar (ilk vuruş vurgulu), ekranda büyük "4 · 3 · 2 · 1" geri sayımı.
   5. N vuruş bitince metronom susar ve kayıt o anda başlar. **Sayım sesi kayda girmez.** İlk vuruşun kesilmemesi için kaydedici son vuruşun bitişinden kısa bir süre (~150 ms) önce başlatılır; tık kaydedilen hatta gitmediği için bu güvenlidir.
   6. Kayıt sırasında kırmızı nokta + süre (`● 0:42`).
   7. **■ Durdur** ya da **boşluk tuşu** kaydı bitirir. Sayım sırasında **Esc** / Durdur iptal eder (dosya oluşmaz).
   8. Dosya seçilen klasöre otomatik yazılır ve listede en üstte belirir.
5. Ses kalitesi: tarayıcının konuşma odaklı işlemleri **kapalı** — `echoCancellation: false`, `noiseSuppression: false`, `autoGainControl: false`; **stereo** (`channelCount: 2`), 48 kHz istenir. Voicemeeter'dan gelen karışım olduğu gibi kaydedilir.
6. Veriler tamamen yerel: kullanıcının seçtiği bir klasör.

## Hedef olmayanlar (bu sürümde yok)

- Akor, söz, ton, not alanları (sonra eklenebilir olmalı, ama şimdi yok).
- Kayıt düzenleme / kırpma / MP4'e dönüştürme.
- Bulut, paylaşma, hesap, birden fazla kullanıcı.
- Kayıt boyunca çalan metronom (yalnızca sayım var).
- Firefox, Safari, mobil destek.
- Uygulama içinden kayıt silme (kullanıcı dosyayı Dosya Gezgini'nden siler; uygulama bunu yansıtır).

## Başarısızlık sayılacak şeyler (çalışsa bile)

- Gitar sesinin boğuk / dalgalı kaydedilmesi (gürültü bastırma ya da otomatik seviye açık kalırsa).
- Metronom sesinin kayda girmesi.
- Bir kaydın kaybolması — tarayıcı sekmesi kayıt sırasında kapanırsa bile o ana kadarki kısım diskte kalmalı.
- Kayıtların kullanıcının göremediği bir yerde (tarayıcı deposunda) saklanması.
- Gitar elindeyken fareye uzanmayı gerektiren bir başlatma/durdurma akışı (boşluk tuşu ikisini de yapar).

Bilinen sınır (kullanıcıya söylendi): tarayıcı tuşları yalnızca penceresi öndeyken duyar; Voicemeeter penceresine geçilirse önce uygulamaya geri tıklamak gerekir.

## Kısıtlar

- Windows üzerinde Chrome veya Edge (File System Access API, MediaRecorder, Web Audio).
- Kamera/mikrofon ve klasör erişimi için **güvenli bağlam** (HTTPS ya da localhost) gerekir.
- Tarayıcılar videoyu `.webm` (VP8/VP9 + Opus) olarak kaydeder; kullanıcıya bu söylendi ve kabul edildi.

## Yaklaşımlar

| Yaklaşım | Artısı | Eksisi |
|---|---|---|
| **1. Tarayıcı uygulaması (seçilen)** | Kurulum yok; Edge/Chrome'da "uygulama olarak yükle" ile kendi penceresi; cihazlar ve klasöre yazma tarayıcıda hazır | Yalnızca Chrome/Edge; klasör izni ara sıra yeniden sorulabilir |
| 2. Electron masaüstü programı | Tam dosya erişimi, izin sorusu yok, MP4 dönüştürme kolay | 100 MB+ kurulum, her değişiklikte yeniden paketleme — bu ihtiyaç için ağır |
| 3. Yerel sunucu + tarayıcı arayüzü | Tarayıcı kısıtı yok | Her kullanımdan önce komut çalıştırmak gerekir |

Kullanıcı **1**'i seçti.

## Kullanıcının kararları

- Metronom: sayım usulü (dinleyerek algılama değil).
- Hem ses hem video kaydı.
- Kayıtlar bilgisayara, kullanıcının klasörüne.
- Repertuar grupları: Bildiğim / Çalıştığım.
- Ekran taslakları (aşağıda) onaylandı.
- Yaklaşım 1.

## Ekranlar

```
┌─ MyMusic ───────────────────────────── [+ Şarkı ekle] ─┐
│  [ Bildiğim (12) ]  [ Çalıştığım (4) ]   🔍 ara...     │
│                                                        │
│  Wonderwall — Oasis            87 BPM   3 kayıt   ›   │
│  Blackbird — The Beatles       94 BPM   1 kayıt   ›   │
│  Hotel California — Eagles     74 BPM   —         ›   │
└────────────────────────────────────────────────────────┘

┌─ Wonderwall — Oasis ─────────── Durum: [Çalıştığım ▾] ─┐
│  Tempo: [87] BPM    Sayım: [4] vuruş                   │
│                                                        │
│   [ 🎙 Ses kaydı ]     [ 🎥 Video kaydı ]              │
│        (kamera önizlemesi burada)                      │
│                                                        │
│  Kayıtlar                                              │
│   ▶ 24 Kas 2026 21:30  video  2:41                     │
│   ▶ 20 Kas 2026 19:05  ses    2:38                     │
└────────────────────────────────────────────────────────┘
```

Arayüz dili Türkçe.

## Benim kararlarım (kullanıcı onaylamadı, düzeltebilir)

- **Teknoloji:** Vite + React + TypeScript. Testler Vitest ile.
- **Yayın:** GitHub Pages (HTTPS). Uygulama yüklenebilir olsun diye PWA manifesti eklenir. Kod internette durur, **veriler asla** — her şey kullanıcının klasöründe.
- **Klasör düzeni:**
  ```
  <seçilen klasör>/
    mymusic.json                    # şarkı listesi
    recordings/
      <şarkı-id>-<slug>/            # ör. 3f9a-wonderwall
        2026-11-24_21-30-05_video.webm
        2026-11-20_19-05-12_ses.webm
  ```
  Şarkı klasörü oluşturulduğu adla kalır (şarkı adı değişse bile id üzerinden bulunur).
- **`mymusic.json` şeması:** `{ version: 1, songs: [{ id, title, artist, status: "known" | "learning", bpm, countInBeats, createdAt, updatedAt }] }`. Bilinmeyen alanlar korunur (ileride alan eklemek kolay olsun).
- **Kayıt listesi** şarkı klasörü taranarak oluşturulur; böylece Dosya Gezgini'nden silinen dosya listeden de kalkar.
- **Kaybolmaya karşı:** Chrome yazma akışını ancak `close()` ile diske işler, bu yüzden tek bir akış yeterli değil. MediaRecorder parçaları birkaç saniyelik numaralı dosyalar halinde `<klasör>/.parcalar/<kayıt-id>/` altına yazılır; durdurunca sırayla birleştirilip asıl `.webm` dosyası oluşturulur ve parça klasörü silinir. Açılışta yarım kalmış parça klasörü bulunursa birleştirilip kayıt kurtarılır. En fazla birkaç saniye kaybolur.
- **Süre:** MediaRecorder'ın ürettiği webm dosyalarında süre bilgisi eksik olur; süre oynatma sırasında ya da kayıt anında ölçülüp gösterilir (uygulama içi bir yan dosyada veya `mymusic.json`'da saklanabilir — kurucunun kararı).
- **Metronom:** Web Audio API ile zamanlanmış tıklar (vurgulu ilk vuruş). Kayıt, son vuruştan bir vuruş aralığı sonra başlar.
- **Video:** varsayılan 1280×720, 30 fps; cihaz ne destekliyorsa ona düşer.
- **Ses bit hızı:** Opus ~256 kbps.
- **Cihaz seçimi ve klasör bağlantısı** hatırlanır (cihazlar localStorage'da, klasör tanıtıcısı IndexedDB'de). Açılışta izin gerekirse "Klasöre tekrar bağlan" butonu gösterilir.
- **Şarkı silme:** onaylı; şarkı listeden kalkar, kayıt dosyaları diskte bırakılır.

## Kurucuya kalanlar

- Bileşen yapısı, stil, ikonlar, renkler.
- Metronom tık sesi (sentezlenmiş).
- Boş liste ve hata durumlarının metinleri (izin reddi, cihaz bulunamadı, klasör seçilmedi).
- Süre bilgisinin nasıl saklanacağı.
