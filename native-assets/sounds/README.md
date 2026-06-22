# Özel Bildirim Sesi — KantinPay

Harcama bildirimlerinde çalan "kasa cıngırağı" sesi. Backend OneSignal payload'una şunlar eklendi:

```json
"ios_sound": "kantin_ding.caf",
"android_sound": "kantin_ding"
```

Bu yüzden dosyaların native projede **şu kesin adlarla** paketlenmesi gerekir.

## Android

Dosyayı şuraya kopyalayın:

```
android/app/src/main/res/raw/kantin_ding.mp3
```

(`res/raw/` klasörü yoksa oluşturun. Dosya adı **küçük harf** olmalı, boşluk veya tire kullanmayın — `kantin_ding.mp3`.)

Komut:

```bash
mkdir -p android/app/src/main/res/raw
cp native-assets/sounds/kantin_ding.mp3 android/app/src/main/res/raw/kantin_ding.mp3
```

## iOS

Dosyayı şuraya kopyalayın:

```
ios/App/App/kantin_ding.caf
```

Sonra **Xcode'da**:
1. `ios/App/App.xcworkspace` açın.
2. Sol paneldeki `App` grubuna `kantin_ding.caf` dosyasını sürükleyin.
3. Açılan iletişim kutusunda **"Copy items if needed"** işaretli, **target = App** seçili olsun.

Komut:

```bash
cp native-assets/sounds/kantin_ding.caf ios/App/App/kantin_ding.caf
```

## Sonra

```bash
npx cap sync
npx cap run ios     # veya android
```

Yeni bir test harcaması yapın; bildirim "çınç" sesiyle gelir.

## Notlar

- iOS'ta `.mp3` bildirim sesi olarak **çalmaz**, mutlaka `.caf` (veya `.wav`/`.aiff`) olmalı, ≤ 30 sn.
- Sessiz moddayken iOS bildirim sesi çalmaz (sistem davranışı).
- Android 8+ için OneSignal otomatik kanal açar; sesi değiştirdiğinizde **eski kanal cache'i** yüzünden uygulamayı kaldırıp tekrar yüklemek gerekebilir.
