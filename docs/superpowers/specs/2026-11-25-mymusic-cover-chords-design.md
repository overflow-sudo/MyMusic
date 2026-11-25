# MyMusic — Albüm kapağı ve akorlar

Tarih: 2026-11-25. Boyut: küçük–orta ek özellik (mevcut tasarımlar geçerli: `2026-11-24-mymusic-design.md`, `2026-11-24-mymusic-ui-redesign-design.md`).

## Amaç

Kullanıcı her şarkıda albüm kapağını görmek ve şarkının akorlarını uygulamanın içinde, özellikle kayıt yaparken okumak istiyor. Akorları otomatik çekmek (akor siteleri) güvenilir/yasal değil; kullanıcı **yapıştırma + "Akorları ara"** yolunu seçti. Kapak için **Apple (iTunes) Search API** yolunu onayladı.

## Hedefler

### Kapak
1. Yeni şarkı eklenince (ad + sanatçı) arka planda kapak aranır: `https://itunes.apple.com/search?term=<ad sanatçı>&entity=song&limit=1&country=TR` → `artworkUrl100`, `100x100` → `600x600`.
2. Görsel indirilebilirse şarkı klasörüne `cover.jpg` olarak yazılır (`song.cover = { source: 'itunes' | 'user', fileName: 'cover.jpg' }`). İndirilemezse (CORS vb.) `song.cover = { source: 'itunes', url }` olarak uzak adres saklanır ve `<img>` ile gösterilir.
3. Arama `fetch` CORS hatası verirse JSONP (`&callback=`) ile denenir.
4. Görünüm: listede satır başında küçük kare kapak (40 px, köşe 6 px); şarkı ekranında başlığın solunda büyük kapak (~96 px masaüstü, 64 px telefon). Kapak yoksa: şarkının ilk harfi, ışık tonunda koyu kare.
5. ⚙ panelinde **Kapak** bölümü: önizleme, **Kapağı yeniden bul**, **Kendi resmini seç** (dosya → `cover.<ext>`), **Kaldır**.
6. Ağ yoksa / bulunamazsa sessizce yer tutucu kalır; ⚙ panelinde "Kapak bulunamadı." satırı.
7. Gizlilik: Apple'a yalnızca şarkı adı ve sanatçı gider (README'de yazılır).

### Akorlar
1. `song.chords?: string` (`mymusic.json`).
2. ⚙ panelinde **Akorlar**: çok satırlı metin alanı (sabit genişlikli yazı), kaydetme blur'da; **"Akorları ara"** bağlantısı → `https://www.google.com/search?q=<ad> <sanatçı> chords` yeni sekmede.
3. Gösterim (pure ayrıştırıcı + bileşen):
   - Bir satırın tüm sözcükleri akor ise (ör. `Am  G  C/E  F#m7  Bbsus4  D/F#`) "akor satırı" sayılır, akorlar vurgulanır, boşluklar korunur.
   - Satır içi `[Am]` biçimi: akor, önündeki hecenin üstüne küçük vurgulu yazı olarak.
   - `[Verse]`, `[Chorus]` gibi bölüm başlıkları (akor olmayan köşeli parantez) küçük büyük-harf etiket olur.
   - Diğer satırlar söz olarak, sabit genişlikli yazıyla.
4. Kayıt ekranında: akor varsa masaüstünde sahnenin sağında (sahne ~%62, akorlar ~%38), 900 px altında sahnenin altında; kendi kaydırma alanı, büyük punto (~18 px). Akor yoksa sahne tam genişlik kalır.
5. Boşluk tuşu akor alanında yazarken kayıt başlatmaz (mevcut yazma kuralı).

## Hedef olmayanlar
Akor sitelerinden otomatik çekme, parçayla otomatik kaydırma, ton değiştirme, MP3'ten akor çıkarma, sözleri ayrı kaynaktan çekme.

## Başarısızlık sayılacak şeyler
Kapak aramasının şarkı eklemeyi yavaşlatması/engellemesi (arka planda olmalı); hatalı akor tanıma yüzünden sözlerin vurgulanması (ör. "A" sözcüğü tek başına akor sayılır ama "A day in the life" satırı akor satırı sayılmamalı); kayıt sahnesinin akorlar yüzünden kullanışsız küçülmesi.

## Yaklaşımlar
| Yaklaşım | Artısı | Eksisi |
|---|---|---|
| **iTunes Search + yapıştırılan akorlar (seçilen)** | Anahtarsız, hızlı, güvenilir; akorlar yasal ve doğru | Akoru kullanıcı yapıştırır |
| MusicBrainz + Cover Art Archive | Açık veri | Yavaş, Türkçe şarkılarda kapsama düşük |
| Akor sitelerinden çekme | Otomatik | CORS/telif; güvenilmez |

## Kararlarım
- Akorlar `mymusic.json`'da (liste ile birlikte yedeklenir); kapak dosya olarak şarkı klasöründe.
- Mevcut şarkılar için: liste açıldığında kapağı olmayan şarkılar için sırayla (aynı anda en fazla 2) kapak aranır; başarısız olanlar oturum boyunca tekrar denenmez.
- Kapak dosyası okunurken object URL'ler kapatılır (sızıntı yok).
