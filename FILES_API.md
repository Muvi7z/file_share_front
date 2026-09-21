# Контракт API файлов

Бэкенд находится в отдельном проекте. Фронтенд поддерживает отображение папок,
видео и обычных файлов в файловом проводнике.

Методы `GET /api/folders/root/entries` и
`GET /api/folders/:folderId/entries` должны возвращать обычные файлы вместе с
уже существующими элементами папок и видео:

```json
{
  "type": "file",
  "file": {
    "id": "file-id",
    "name": "photo",
    "path": "D:\\Media\\photo.jpg",
    "folderId": "folder-id",
    "folderName": "Media",
    "parentFolderId": "parent-folder-id",
    "extension": "jpg",
    "mimeType": "image/jpeg",
    "size": "2516582",
    "sizeBytes": 2516582,
    "modifiedAt": "2026-09-13T12:00:00Z"
  }
}
```

`extension` можно возвращать как `jpg` или `.jpg`: фронтенд убирает начальную
точку и приводит расширение к единому виду. Если `name` уже заканчивается этим
расширением, оно не добавляется повторно. Числовая строка в `size` отображается
в человекочитаемом виде на основе `sizeBytes`.

Поле `mimeType` рекомендуется добавить в Go-структуру так:

```go
MimeType string `json:"mimeType"`
```

В нём указывается стандартный MIME-тип без дополнительных параметров:

| Расширение | `mimeType` |
| --- | --- |
| `.jpg`, `.jpeg` | `image/jpeg` |
| `.png` | `image/png` |
| `.webp` | `image/webp` |
| `.gif` | `image/gif` |
| `.svg` | `image/svg+xml` |
| `.pdf` | `application/pdf` |
| `.txt` | `text/plain` |
| `.json` | `application/json` |
| `.zip` | `application/zip` |
| `.mp4` | `video/mp4` |

Значение можно получить через `mime.TypeByExtension`. Если система не знает
расширение, MIME определяется по первым 512 байтам через
`http.DetectContentType`:

```go
contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath)))
if contentType == "" {
    header := make([]byte, 512)
    readBytes, _ := file.Read(header)
    contentType = http.DetectContentType(header[:readBytes])
    _, _ = file.Seek(0, io.SeekStart)
}
```

`GET /api/files/:id/download` используется и для предварительного просмотра
изображения, и для скачивания файла. Фронтенд самостоятельно строит этот адрес
из поля `id`, поэтому поля `contentUrl` и `downloadUrl` в ответе не требуются.
Для изображения этот адрес передаётся элементу `<img>`, а для остальных файлов
— элементу `<a download>`.

Сервер возвращает правильный `Content-Type`. Заголовок `Content-Disposition`
нужно опустить или установить в `inline`, чтобы браузер мог показать
изображение. Скачивание запускает атрибут `download` у ссылки. Маршрут должен
быть доступен на том же домене, иначе браузер может проигнорировать этот
атрибут.

В обработчике скачивания MIME указывается именно в HTTP-заголовке ответа. Сам
файл следует передавать через `http.ServeContent`, который поддерживает
потоковую передачу, `HEAD` и диапазонные запросы:

```go
file, err := os.Open(filePath)
if err != nil {
    http.Error(w, "file not found", http.StatusNotFound)
    return
}
defer file.Close()

info, err := file.Stat()
if err != nil {
    http.Error(w, "cannot read file", http.StatusInternalServerError)
    return
}

contentType := mime.TypeByExtension(strings.ToLower(filepath.Ext(filePath)))
if contentType == "" {
    header := make([]byte, 512)
    readBytes, _ := file.Read(header)
    contentType = http.DetectContentType(header[:readBytes])
    _, _ = file.Seek(0, io.SeekStart)
}

w.Header().Set("Content-Type", contentType)
w.Header().Set("Content-Disposition", mime.FormatMediaType("inline", map[string]string{
    "filename": downloadName,
}))
http.ServeContent(w, r, downloadName, info.ModTime(), file)
```

Для этого примера нужны пакеты `io`, `mime`, `net/http`, `os`, `path/filepath`
и `strings`. В JSON поле `mimeType` помогает интерфейсу определить тип карточки,
а заголовок `Content-Type` у `/download` сообщает браузеру, как обрабатывать
содержимое самого файла. Это два отдельных места, и желательно заполнять оба.

Метод должен передавать файл потоком, поддерживать `HEAD`, а также диапазонные
запросы там, где это возможно. Сервер не должен загружать файл целиком в
оперативную память.

Маршрут файла открывается напрямую элементами `<img>` и `<a>`. Эти элементы не
могут добавить Bearer-токен, который хранит текущий фронтенд. Поэтому серверу
следует использовать сессионную cookie с флагом `HttpOnly` либо разрешать
доступ после проверки, что файл принадлежит включённой публичной папке.

Сервер не должен принимать произвольный путь к файлу из URL. Файл необходимо
находить по сохранённому на сервере идентификатору. Перед открытием нужно
нормализовать полученный путь и проверить, что он остаётся внутри разрешённой
корневой папки.

MIME-тип ответа `GET /api/files/:id/download` определяется на бэкенде по
содержимому файла или через безопасную таблицу расширений. Во входных данных
фронтенд распознаёт изображения по полю `extension`; для совместимости также
поддерживается необязательное поле `mimeType`. Видео должны по-прежнему
возвращаться как элементы с `type: "video"`.
