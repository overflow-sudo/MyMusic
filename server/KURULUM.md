# MyMusic sunucu kurulumu (Docker + Caddy)

Adres: `music.emiraksu.me`. Sunucu Docker içinde `127.0.0.1:8120` üzerinde çalışır, dışarıya senin mevcut Caddy'n açar. Komutları sırayla yapıştır. `docker` komutları için `sudo` gerekebilir (kullanıcın `docker` grubunda değilse `docker compose ...` yerine `sudo docker compose ...` yaz).

## 1. DNS

Alan adının DNS panelinde `music` için bir kayıt olsun: sunucunun IP'sine `A` (varsa `AAAA`) ya da ana alana `CNAME`. Cloudflare kullanıyorsan proxy açık (turuncu bulut) da kapalı (gri bulut) da çalışır; yüklemeler 32 MB'lık parçalarla gittiği için Cloudflare sınırına takılmaz. Proxy açıksa Cloudflare'de **SSL/TLS modu Full veya Full (strict)** olmalı ("Flexible" yönlendirme döngüsü yapar). Ayrıca proxy arkasında yanlış şifre sınırı (15 dakikada 10 deneme) Cloudflare'in uç IP'si başına sayılır; kabul edilebilir bir durum.

## 2. Repoyu klonla

```bash
sudo git clone https://github.com/overflow-sudo/MyMusic.git /opt/mymusic
sudo chown -R "$USER": /opt/mymusic
```

## 3. `.env` dosyasını oluştur

```bash
cd /opt/mymusic/server
cp .env.example .env
sed -i "s|^SIGNING_SECRET=.*|SIGNING_SECRET=$(openssl rand -base64 32)|" .env
chmod 600 .env
nano .env
```

`nano` içinde `OWNER_PASSWORD=` satırına **güçlü bir şifre** yaz (en az 12 karakter; `change-me` yer tutucusu ile sunucu başlamaz). `openssl rand -base64 24` ile üretebilirsin; uygulamada bunu gireceksin. Değerde `$` ve ` #` (boşluk + diyez) kullanma, `.env` dosyasında sorun çıkarır. `SIGNING_SECRET` az önce otomatik dolduruldu. `PUBLIC_URL` doğruysa dokunma. Kaydet: Ctrl+O, Enter, Ctrl+X.

## 4. Veri klasörü

Konteyner `10001` kullanıcısıyla çalışır; veri klasörü ona ait olmalı.

```bash
mkdir -p data && sudo chown 10001:10001 data
```

## 5. Başlat

Önce şifrenin ayarlandığını kontrol et (`change-me` görmemelisin):

```bash
grep OWNER_PASSWORD .env
```

```bash
docker compose up -d --build
```

İlk derleme birkaç dakika sürer.

## 6. Çalışıyor mu?

```bash
docker compose ps
curl -s http://127.0.0.1:8120/health
```

`ps` çıktısında `healthy` ve curl'den `{"ok":true}` görmelisin. Olmazsa: `docker compose logs --tail 50`.

## 7. Caddy

```bash
sudo cp /opt/mymusic/server/mymusic.caddy /etc/caddy/projects/mymusic.caddy
grep -n "import" /etc/caddy/Caddyfile
```

Caddyfile `/etc/caddy/projects/` klasörünü zaten herhangi bir biçimde import ediyorsa (ör. `import projects/*`, `import /etc/caddy/projects/*.caddy`) ekleme yapma, bu adımı atla. Yoksa ekle:

```bash
echo 'import /etc/caddy/projects/*' | sudo tee -a /etc/caddy/Caddyfile
```

Sonra doğrula ve yeniden yükle:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

(Yeni dosyadaki `music.emiraksu.me` bloğu, aynı adres Caddyfile'da başka yerde tanımlıysa çakışır; `validate` bunu söyler.)

## 8. Dışarıdan dene

```bash
curl -s https://music.emiraksu.me/health
```

`{"ok":true}` gelmeli. (Sertifikayı Caddy ilk istekte alır; birkaç saniye sürebilir.)

## 9. Uygulamada bağla

https://overflow-sudo.github.io/MyMusic/ → **Ayarlar → Bulut** → adres: `https://music.emiraksu.me`, şifre: `.env`'deki `OWNER_PASSWORD`.

## 10. Bakım

**Güncelleme**

```bash
cd /opt/mymusic && git pull && cd server && docker compose up -d --build
```

**Yedekleme**: her şey `/opt/mymusic/server/data/` içinde (`db.sqlite` + `files/`). Durdurup arşivle (veritabanı WAL kullandığı için canlı kopya güvenli değil):

```bash
cd /opt/mymusic/server
docker compose stop
sudo tar czf ~/mymusic-yedek-$(date +%F).tar.gz data
docker compose start
```

Arşiv `sudo` ile oluşturulduğu için root'a aittir; kopyalamadan önce `sudo chown "$USER": ~/mymusic-yedek-*.tar.gz` yapabilirsin.

**Şifre değiştirme**: `.env` içindeki `OWNER_PASSWORD`'ü düzenle, sonra `docker compose up -d` (env değişince konteyner yeniden oluşturulur). Dürüst not: daha önce giriş yapmış cihazların jetonları şifre değişince **geçersiz olmaz**; çalışmaya devam ederler. Jeton iptali şu an yalnızca telefon sayfasındaki **Çıkış yap** ile (o oturumun jetonu) yapılır. Tüm jetonları birden geçersiz kılmak için (cihazlar yeniden şifre sorar):

```bash
cd /opt/mymusic/server
docker compose stop
sudo apt-get install -y sqlite3   # kurulu değilse
sudo sqlite3 data/db.sqlite "DELETE FROM tokens;"
docker compose start
```

**Loglar**

```bash
cd /opt/mymusic/server && docker compose logs -f
```

## Sorun giderme

- **502 Bad Gateway**: konteyner kapalı. `docker compose ps` ve `docker compose logs --tail 50`; `docker compose up -d` ile başlat.
- **413 (Request Entity Too Large)**: Caddy'deki `request_body { max_size 64MB }` eksik ya da düşük. `mymusic.caddy`'yi tekrar kopyalayıp `systemctl reload caddy` yap. (Parçalar 32 MB'dır.)
- **401**: şifre yanlış ya da jeton geçersiz kılınmış. Uygulamada Ayarlar → Bulut'ta şifreyi tekrar gir.
- **429**: 15 dakikada 10'dan fazla yanlış giriş; biraz bekle.
- **Konteyner başlamıyor, "OWNER_PASSWORD is required"**: `.env` eksik ya da boş; `server/` klasöründe olduğundan emin ol.
- **Veri yazılamıyor (EACCES)**: `sudo chown 10001:10001 data`.
