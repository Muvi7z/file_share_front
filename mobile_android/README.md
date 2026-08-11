# Local Video Vault Mobile

Нативное Android-приложение для просмотра видео в локальной сети.

## Что внутри

- Главный экран со списком видео.
- Вкладка `Файлы` с навигацией по папкам как в проводнике.
- Отображение пустых папок.
- Админка с логином и добавлением папки.
- Отдельная страница плеера.
- Нативный плеер Media3 ExoPlayer вместо WebView.
- Мок-данные для разработки без бэкенда.

## Плеер

Видео открывается через Media3 ExoPlayer. Для стабильного потока бэкенд должен поддерживать:

- `Range`;
- `206 Partial Content`;
- `Accept-Ranges: bytes`;
- корректный `Content-Type`.

## Настройка бэкенда

Адрес бэкенда лежит в:

```txt
app/src/main/res/values/strings.xml
```

Для Android Emulator по умолчанию используется адрес Windows-хоста:

```xml
<string name="backend_api_base_url">http://10.0.2.2:5544/api</string>
```

На физическом устройстве поменяй `backend_api_base_url` на IP компьютера в локальной сети и оставь порт/префикс бэкенда, например `http://192.168.1.10:5544/api`.

По умолчанию приложение загружает данные из бэкенда. Демо-данные доступны только через ручное переключение `Демо`.

## Сборка APK

На этой машине Android SDK/Gradle не установлены, поэтому APK здесь собрать нельзя. После установки Android Studio или Android SDK:

```powershell
cd mobile_android
.\build-apk.ps1
```

Или вручную:

```bash
cd mobile_android
gradle wrapper
./gradlew assembleDebug
```

APK будет здесь:

```txt
app/build/outputs/apk/debug/app-debug.apk
```
