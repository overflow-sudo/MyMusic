# MyMusic — Arayüz yenileme (Tesla sadeliği + ritim ışığı + sarma)

Tarih: 2026-11-24
Önceki tasarım: `2026-11-24-mymusic-design.md` (işlevler değişmiyor; bu belge görünümü ve iki küçük özelliği tanımlar).

## Amaç ve neden

Kullanıcı ilk sürümün arayüzünü "çok kötü" buldu: tarayıcı varsayılan gri butonları, hiyerarşi yok, kayıt ekranı düz bir form, "Choose File" gibi İngilizce yerler. İstek: **Tesla gibi sade** bir arayüz, ama **renkler şarkının ve gitarın ritmine göre değişsin**. Ek olarak kayıtlarda ve parçada **ileri-geri sarma**.

Kullanıcı bir taslak sayfada (claude.ai/artifact/PGHU9QBT38uYEJL876GLeG) üç ışık biçimini gördü ve **A (alttan parıltı)** ile **C (tüm ekran rengi)** seçti; ikisi arasında kendisi geçiş yapabilmeli.

## Hedefler

1. **Görsel dil (taslaktaki gibi):** tek koyu tema; büyük, ince başlıklar (Space Grotesk 300) ve Inter gövde; geniş boşluk; çerçevesiz listeler (yalnızca ince ayraç çizgileri); tek kırmızı kayıt rengi; renk yalnızca ışık katmanında. Tüm kontroller özel stilli (gri tarayıcı butonu kalmaz). Dosya seçici Türkçe özel bir butondur ("Parça seç").
2. **Şarkı listesi:** üstte sade sekmeler "Çalıştığım N / Bildiğim N" (seçili olan parlak), sağda "＋ Şarkı" ve "⚙". Satır: **şarkı adı** + soluk sanatçı; sağda büyük BPM rakamı + "BPM · N kayıt" (yoksa "—"). Arama kutusu sade, alt çizgili.
3. **Şarkı (kayıt) ekranı:**
   - Üst: "‹" geri, şarkı adı (büyük, ince), altında küçük büyük-harf satırı "SANATÇI · DURUM · PARÇA: dosya". Sağda büyük tempo rakamı + "BPM · N VURUŞ". Durum tek dokunuşla değişir.
   - Orta: geniş sahne alanı. Video modunda kamera önizlemesi; ses modunda boş koyu alan (ışık burada görünür). Sayım rakamları sahnenin ortasında çok büyük. Kayıt sırasında köşede kırmızı "● 0:42". Sol üstte küçük giriş etiketi (ör. "Kamera · Voicemeeter Out B1").
   - Alt: ses/video seçimi (iki küçük segment), seviye çubuğu (ışık renginde), **yuvarlak kırmızı kayıt düğmesi**, "Boşluk: başlat / durdur" ipucu.
   - **⚙ paneli** (sağdan açılan çekmece): tempo, sayım, durum, Düzenle/Sil, parça (seç / değiştir / kaldır, başlangıç, ses), mikrofon / kamera / metronom çıkışı seçimleri + Voicemeeter ipucu. Ana ekranda bu alanlar görünmez.
   - Altta "Kayıtlar" listesi: tarih, tür, süre; tıklayınca oynatıcı açılır (Hedef 5).
4. **Ritim ışığı:**
   - Biçimler: **A · Alttan parıltı** (ekranın altından yükselen radyal ışık; vuruşta parlar, gitar seviyesiyle büyür), **C · Tüm ekran** (arka plan rengi vuruşla ve gitar seviyesiyle kayar), **Kapalı**. Seçim genel ayarlarda (⚙ Ayarlar) ve tarayıcıda hatırlanır (localStorage). Varsayılan: A.
   - **Vuruş kaynağı:** kayıt sırasında metronom sayımı ve parça çalarken parçanın temposu (şarkının BPM'i; parça başlangıcı = ilk vuruş). Şarkı ekranında kayıt yokken: şarkının BPM'inde hafif nabız. Liste ekranında: yavaş "nefes" (vuruş yok).
   - **Gitar seviyesi kaynağı:** şarkı ekranındaki önizleme akışının seviye ölçümü (mevcut LevelMeter analizörü) — kayıt öncesi ve sırasında.
   - **Renk:** her şarkının tonu temposundan (yavaş → mavi/mor, hızlı → turuncu/kırmızı); gitar seviyesi tonu hafifçe kaydırır ve parlaklığı artırır.
   - `prefers-reduced-motion` açıksa ışık sabit, yumuşak bir parıltı olarak kalır.
   - Işık, okunabilirliği bozmamalı: metin her zaman ışığın üstünde, yeterli kontrastla.
5. **Sarma (oynatıcı):** ortak bir oynatıcı bileşeni:
   - İlerleme çubuğu (sürüklenebilir), geçen / toplam süre, oynat/duraklat, **5 sn geri / 5 sn ileri**.
   - **Kayıtlar** listesinde bir kayıt açılınca bu oynatıcı (video kayıtlarda görüntü üstte).
   - **Parça** (⚙ panelinde): parçayı dinle ve sar; **"Buradan başla"** butonu o anki konumu başlangıç noktası olarak kaydeder (mevcut `track.startSec`). Elle `m:ss` girişi de kalır.
   - Kayıt sırasında sarma yok; kayıt başlarken açık oynatıcılar duraklatılır.
   - Oynatıcı odaktayken Boşluk oynat/duraklat yapar, kayıt başlatmaz (mevcut kural: medya öğeleri kısayolu almaz — özel oynatıcıda da korunmalı).

## Hedef olmayanlar

- İşlevlerde değişiklik yok (kayıt motoru, dosya düzeni, kurtarma, gecikme telafisi aynı).
- Açık tema yok (bilinçli tek koyu görünüm).
- Kayıt sırasında parçayı sarma.
- Dalga formu çizimi, parçanın temposunu otomatik algılama.

## Başarısızlık sayılacak şeyler

- Işığın metni okunmaz yapması ya da kayıt sırasında dikkati dağıtacak kadar sert yanıp sönmesi (C biçiminde bile renk geçişleri yumuşak olmalı; ani beyaz flaş yok).
- Işık hesaplamasının kayıt zamanlamasını bozması (ışık yalnızca okur; ses grafiğine düğüm ekleyip zamanlamayı değiştirmez).
- Mevcut testlerin ve davranışların (Boşluk kuralları, kaydetme hataları, klasör akışı) bozulması.
- Bir ayarın panele taşınırken kaybolması.

## Kısıtlar

- Mevcut kod: Vite + React + TS; `src/ui/*`, `src/audio/*`. Stil şu an `src/ui/app.css`.
- Yazı tipleri Google Fonts'tan (Space Grotesk, Inter) — uygulama zaten internetten yükleniyor; yazı tipi gelmezse sistem fontuna düşer.
- Chrome/Edge, Windows; ekran genişliği masaüstü öncelikli ama 400 px'de de bozulmamalı.

## Yaklaşımlar

| Yaklaşım | Artısı | Eksisi |
|---|---|---|
| **1. Mevcut uygulamayı yeniden stillemek + ışık katmanı (seçilen)** | Çalışan kayıt kısmına dokunmaz; ışık mevcut zamanlama ve seviye ölçümünden beslenir | CSS ve bileşen düzeni baştan yazılır |
| 2. Sıfırdan yeni arayüz | Temiz sayfa | Çalışan ve test edilmiş kayıt akışını riske atar |
| 3. Hazır bileşen kütüphanesi (MUI vb.) | Hızlı bileşenler | Tesla sadeliğine uymaz, ağır, yine özelleştirme gerekir |

Kullanıcı tasarımı onayladı (yaklaşım 1).

## Kullanıcının kararları

- Tesla gibi sade; renk ritimle değişsin.
- Işık biçimleri A ve C, kullanıcı seçer (+ benim eklediğim "Kapalı").
- Ayarlar ⚙ panelinde.
- Sarma: kayıtlarda ve parçada (1 ve 2); kayıt sırasında yok.
- "Buradan başla" ile başlangıç noktası.

## Benim kararlarım (kullanıcı düzeltebilir)

- Işık seçimi tarayıcıda hatırlanır (localStorage), `mymusic.json`'a yazılmaz — cihaza özgü görünüm tercihi.
- Kayıt yokken şarkı ekranında hafif nabız; listede yavaş nefes.
- Renk tonu tempodan: BPM 60 → ton ~230 (mavi), BPM 160+ → ton ~15 (turuncu-kırmızı), aradaki doğrusal; gitar seviyesi ±30 kaydırır.
- 5 saniyelik sarma adımı.
- Hareket azaltma tercihine uyum.

## Kurucu kontrolünden sonra eklenen kararlar (benim kararlarım)

- **Görsel değerler (taslaktan, birebir):** `--bg #0b0c0e`, `--panel #131519`, `--line #22252b`, `--fg #eceef1`, `--dim #8a8f98`, `--rec #e8433a`; başlık Space Grotesk 300, gövde Inter 400/500; köşe yarıçapı sahne 14–22 px, segment ve butonlar tam yuvarlak (999 px); ayraçlar 1 px `--line`.
- **Vuruş zamanlaması:** `startTake` seçeneklerine **ek, isteğe bağlı** bir `onBeatPlan({ ctx, downbeat, bpm, clickTimes })` geri çağrısı eklenir (mevcut davranış ve testler değişmez). Işık, kayıt sırasında `ctx.currentTime`'a göre vuruş fazını hesaplar: sayım tıkları, ardından downbeat'ten itibaren şarkının BPM'inde vuruşlar. Kayıt dışında (şarkı ekranında boşta) vuruş, `performance.now()` ile serbest çalışan bir zamanlayıcıdır.
- **Parça oynatıcısı ışığı sürmez:** ⚙ panelindeki parça önizlemesi çalarken ışık boştaki nabızla devam eder.
- **Gitar seviyesi:** şarkı ekranı açılınca varsayılan olarak **ses modu** seçili gelir ve mikrofon önizlemesi otomatik açılır (izin bir kez verildikten sonra tarayıcı tekrar sormaz); böylece ışık kayıt öncesinde de gitara tepki verir. Video seçilirse kamera da açılır. `LevelMeter`'ın seviyesi tek kaynaktan yayınlanır (paylaşılan ref/abonelik); ikinci analizör açılmaz. Seviye eşlemesi: LevelMeter'ın −60…0 dB aralığı → 0…1.
- **⚙ paneli ve durum:** Recorder mount'lu kalır; cihaz seçimleri Recorder'ın durumunda kalır, çekmecede gösterilir (portal ya da Recorder'ın kendi çekmece bölümü). Düzenle formu çekmecenin içinde açılır (tam ekran değişimi kalkar). Mevcut testler: seçiciler güncellenebilir, **davranış testleri korunur**.
- **Işık seçimi iki yerde:** liste ekranındaki ⚙ Ayarlar penceresinde ve şarkı ekranındaki çekmecede küçük bir segment (A / C / Kapalı); ikisi aynı tercihi değiştirir.
- **Oynatıcı ayrıntıları:** ortak oynatıcı webm'lerin `Infinity` süre sorununu kendi içinde çözer (mevcut `measureDuration` yöntemi). Aynı anda tek medya çalar: biri başlayınca diğerleri duraklar; kayıt başlarken hepsi duraklar. Oynatıcı kontrolleri odaktayken Boşluk kayıt kısayolunu tetiklemez (`isTypingTarget` oynatıcı kökünü de kapsar, ör. `[data-player]`).
- **Yerleşim:** "Kayıtlar" sahnenin altında aynı kaydırmada. Listede "N kayıt" mevcut sayım mekanizmasından (App'teki `recordingCounts`); 0 ise "—". "N VURUŞ" = sayım vuruşu. Sekme varsayılanı Çalıştığım; seçim oturum içinde korunur (mevcut davranış).

## Kurucuya kalanlar

- Bileşen ayrımı, çekmece animasyonu, ikonlar (inline SVG ya da metin karakterleri; ikon kütüphanesi yok).
- Işığın teknik uygulaması (CSS değişkenleri + requestAnimationFrame önerilir; AudioContext zamanına bağlanmalı).
- Boş durum ve hata metinlerinin yeni tasarımdaki yerleşimi.
