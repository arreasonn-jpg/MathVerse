# LABİRENT PROTOKOLÜ — v1.1.0 (oynanmaya hazır)

**İndir:** <https://github.com/arreasonn-jpg/MathVerse/releases/tag/v1.1.0>

Bu sürüm, geri bildirimin üç maddesi için hazırlandı:
**(1) grafikler, (2) kontroller profesyonel seviyeye**, **(3) yaşam alanında canavar olmasın.**

| Platform | Dosya | Not |
|---|---|---|
| **Windows** | `LabirentProtokolu-Kurulum-1.1.0-x64.exe` | NSIS kurulumu (Türkçe), masaüstü + Başlat menüsü kısayolu |
| **Windows** | `LabirentProtokolu-Tasinabilir-1.1.0-x64.exe` | Kurulumsuz, USB'den çalışır |
| **Windows** | `LabirentProtokolu-Klasor-1.1.0-x64.zip` | Klasöre çıkar, `Labirent Protokolu.exe` çift tıkla — *kurulum yok, uyarı en az* |
| macOS | `LabirentProtokolu-1.1.0-arm64.dmg` / `-x64.dmg` | Apple Silicon + Intel |
| Linux | `LabirentProtokolu-1.1.0-x86_64.AppImage` / `-amd64.deb` | `chmod +x` sonra çift tıkla, ya da `dpkg -i` |

> Bu proje **kod imzasız** üretiliyor (kod imzalama sertifikası yok). Windows ilk çalıştırmada
> "Windows kişisel bilgisayarınızı korudu" diyebilir → **Ek bilgi → Yine de yükle**.
> Tek seferlik kaldırma: `Unblock-File "$env:USERPROFILE\Downloads\LabirentProtokolu-Kurulum-1.1.0-x64.exe"`
> Doğrulama: aynı sürümün `SHA256SUMS-win.txt` dosyasıyla `Get-FileHash -Algorithm SHA256 <dosya>` karşılaştır.

---

## 1) Grafikler — profesyonel seviye

- **256 px doku** (eski 128 px yerine) + **normal harita ve parlama haritası**; taş bloklarda ince kum/çakıl tanesi, gözenek ve çatlak.
- **Yakın duvarlarda gerçek ışıklandırma:** normal haritalı N·L, yüzeye dik bakışta fener parlaması ve spekülar; uzak duvarlarda hızlı yol.
- **Duvar dibi temas gölgesi (AO)** — zeminle duvar birleşimi artık "havada durmuyor".
- **Ufuk sisine bağlanan uzak duvarlar** — labirentin derinliği kaybolmuyor, sisle kaynaşıyor.
- **GPU'da gökyüzü katmanı:** gradyan + **güneş/ay diski ve halesi**, yıldızlar, **kayan bulut katmanları**.
- **Sprite'lar:** çift doğrusal ölçekleme (alfa kenarları dahil, tırtıklanma yok), griever/kulübe/kovan/Kutu 2× çözünürlükte yeniden çizildi.
- **Çim ve zemin** dokuları yamalı/ince taneli — döşeme ızgarası belli olmuyor.
- **Gece + fener** yeniden dengeli: karanlık gerçekten karanlık, fenerin ışık havuzu dramatik ama patlamış değil.

Bütün kareler: `tools/out/*.png` (18 sahne) ve README görselleri `docs/`.

## 2) Kontroller — profesyonel seviye

- **Fare:** `dengeli / hassas / yumuşak` eğrileri, **kare hızından bağımsız yumuşatma**, doğru **açısal dikey bakış** (rad → piksel), ters Y seçeneği.
- **Ok/klavye + fare** aynı anda; girdi kipini oyun kendi algılar.
- **Koşu** ve **eğilme** için `basılı tut` ya da `aç / kapa` seçimi.
- **Kamera sallanması** şiddeti (0 = kapalı), ekran sarsıntısı, **nişan yardımı**.
- **Oyun kolu:** ölü bölge, tepki eğrisi, hassasiyet, titreşim; LB/RB araç, LT eğil, sağ çubuk bakış.
- **TUŞ ATAMALARI ekranı** (Duraklat → TUŞ ATAMALARI): 23 eylem için **DEĞİŞTİR / SİL / VARSAYILANA DÖN**; çakışan tuş otomatik eski eylemden alınır; değişiklik anında `settings.json`'a yazılır.
- **Otomatik iç ölçekleme:** kare süresini ölçüp ölçeği (0.62–1.0) kendi ayarlar.

## 3) Yaşam alanı — Kayran'da canavar YOK

- Kamp, Kutu ve baraka çevresinde **hiçbir yaratık bulunmaz**; Grievers ve Böcek Bıçakları **yalnızca labirent içinde** avlanır (filmdeki gibi).
- Güvenli bölgeye giren yaratık anında dışarı atılır; oyuncu Kayran'dayken yaratıklar saldırganlaşmaz.
- Doğrulandı: `tools/glade-test.js` ve `npm run smoke-test` — 500+ yaratık-kare kontrolünde **ihlal yok**
  (en yakın yaratık 11.7 → güvenli sınır 10.5).

---

## Testler

```
npm run verify
```

kapsamı: `maze-test` (labirent üretimi/erişim), **`glade-test` (yaşam alanı güvenliği)**,
`desktop-test` (paketleme + ayar şeması), `smoke-test` (tarayıcı) + `smoke-test --desktop`
(uzun simülasyon, başarımlar, oyun kolu, tuş atama turu, performans ölçümü), `render-real` (18 görsel sahne).

Bu sürümün paketleri **commit `07c9aef`** ile üretildi; CI'da üç platform da yeşil geçti.
