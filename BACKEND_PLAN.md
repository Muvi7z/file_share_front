# Подробный план бэкенда для Local Video Vault

Базовый URL: `/api`.

Фронт поддерживает два режима:

- `api` - по умолчанию, все данные берутся с бэкенда;
- `demo` - заглушки внутри фронта, бэкенд не нужен.

Важно: фронт не решает, пользователь админ или нет. Фронт отправляет `Authorization: Bearer <token>`, если токен есть, а бэкенд сам определяет пользователя, роль и доступ. Для папок используется одна сущность `Folder`: она описывает и добавленную корневую папку, и любую вложенную папку.

## Общие правила API

- Формат запросов и ответов: JSON, кроме стриминга видео и постеров.
- Ошибки возвращать в едином формате `ErrorResponse`.
- Для публичного просмотра токен не обязателен.
- Для изменения папок, удаления, рескана и просмотра scan jobs нужен токен с подходящей ролью.
- Бэкенд должен фильтровать данные по роли пользователя.
- Фронт ожидает поля ровно в том виде, как описано ниже и в `openapi.yaml`.

## Роли

### `guest`

Пользователь без токена.

Может:

- смотреть включенные корневые папки;
- ходить по вложенным папкам внутри включенных корней;
- смотреть список видео;
- открывать поток видео;
- получать постеры.

Не может:

- добавлять папки;
- удалять папки;
- включать/выключать папки;
- запускать рескан;
- видеть отключенные папки, если ты явно не захочешь иначе.

### `viewer`

Авторизованный пользователь для просмотра.

Может то же, что `guest`, плюс при необходимости можно разрешить больше папок через свою модель прав.

### `admin`

Пользователь с доступом к администрированию.

Может:

- видеть все корневые папки, включая отключенные;
- добавлять корневую папку;
- удалять корневую папку из приложения;
- менять `enabled` и `name`;
- запускать рескан;
- смотреть статус scan jobs.

## Сущности

### `User`

Нужен для авторизации и ролей.

```ts
type User = {
  id: string;
  login: string;
  passwordHash: string;
  role: "viewer" | "admin";
  createdAt: string;
  updatedAt: string;
};
```

Поля:

- `id` - внутренний id пользователя.
- `login` - логин для входа.
- `passwordHash` - хэш пароля, пароль в открытом виде не хранить.
- `role` - роль пользователя.
- `createdAt`, `updatedAt` - даты в ISO формате.

### `UserSession`

Ответ после входа и проверка текущего пользователя.

```ts
type UserSession = {
  token: string;
  login: string;
  role: "viewer" | "admin";
  expiresAt?: string;
};
```

Поля:

- `token` - JWT или другой bearer token.
- `login` - логин пользователя.
- `role` - роль, которую определил бэкенд.
- `expiresAt` - необязательная дата окончания сессии.

Фронт сейчас использует минимум `token` и `login`, но `role` лучше отдавать сразу.

### `Folder`

Единая сущность папки.

```ts
type Folder = {
  id: string;
  name: string;
  path: string;
  parentId: string | null;
  rootFolderId: string;
  isRoot: boolean;
  enabled: boolean;
  filesCount: number;
  videoCount: number;
  childFolderCount: number;
  lastScanAt: string;
};
```

Поля:

- `id` - id папки.
- `name` - имя папки для UI.
- `path` - абсолютный путь на сервере, например `D:\Video\Movies`.
- `parentId` - id родительской папки или `null`.
- `rootFolderId` - id корневой папки, через которую эта папка доступна.
- `isRoot` - `true`, если это папка, которую добавили через админку.
- `enabled` - доступность корневой папки. Для вложенных можно хранить наследуемое значение или всегда копировать значение корня.
- `filesCount` - количество видео внутри этой папки рекурсивно.
- `videoCount` - количество видео прямо в этой папке.
- `childFolderCount` - количество вложенных папок первого уровня.
- `lastScanAt` - дата последнего скана или статус вроде `Ожидает сканирования`.

Правила:

- У корневой папки `isRoot = true`.
- У корневой папки `parentId = null`.
- У корневой папки `rootFolderId = id`.
- У вложенной папки `isRoot = false`.
- У вложенной папки `rootFolderId` равен id корневой папки.
- Вложенные папки нужно сохранять даже если они пустые.
- В проводнике не отдавать обычные файлы, только папки и видео.

Рекомендуемые индексы:

- `folders.id`
- `folders.parentId`
- `folders.rootFolderId`
- `folders.path`
- уникальный индекс на `path` для корневых папок или вообще для всех папок.

### `VideoFile`

```ts
type VideoFile = {
  id: string;
  title: string;
  folderId: string;
  folderName: string;
  parentFolderId: string;
  size: string;
  sizeBytes: number;
  duration: string;
  modifiedAt: string;
  codec: string;
  resolution: string;
  posterUrl: string;
  streamUrl: string;
  path: string;
};
```

Поля:

- `id` - id видео.
- `title` - имя без расширения или красивое имя.
- `folderId` - id корневой папки.
- `folderName` - имя корневой папки.
- `parentFolderId` - id папки, где видео лежит напрямую.
- `size` - строка для UI, например `733 MB`.
- `sizeBytes` - размер в байтах.
- `duration` - длительность для UI, например `01:42:13`.
- `modifiedAt` - дата изменения файла.
- `codec` - кодек, если удалось определить.
- `resolution` - разрешение, если удалось определить.
- `posterUrl` - URL постера.
- `streamUrl` - URL потока.
- `path` - абсолютный путь к файлу на сервере.

Правила:

- Сохранять только видеофайлы.
- Поддерживаемые расширения лучше вынести в настройку: `mp4`, `mkv`, `webm`, `avi`, `mov`, `m4v`.
- `streamUrl` должен указывать на `GET /api/videos/:videoId/stream`.
- Для Android TV и браузера обязательно поддержать HTTP `Range`.

Рекомендуемые индексы:

- `videos.id`
- `videos.folderId`
- `videos.parentFolderId`
- `videos.path`
- индекс для поиска по `title`.

### `FileBrowserEntry`

Эта сущность нужна только для ответа проводника.

```ts
type FileBrowserEntry =
  | { type: "folder"; folder: Folder }
  | { type: "video"; video: VideoFile };
```

Правила:

- Папки и видео можно вернуть в одном массиве.
- Рекомендуемый порядок: сначала папки по имени, потом видео по имени.
- Не возвращать обычные файлы.

### `ScanJob`

```ts
type ScanJob = {
  id: string;
  folderId: string;
  status: "queued" | "running" | "completed" | "failed";
  processedVideos: number;
  processedFolders: number;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
};
```

Поля:

- `id` - id задачи.
- `folderId` - корневая папка, которую сканируют.
- `status` - состояние.
- `processedVideos` - сколько видео обработано.
- `processedFolders` - сколько папок обработано.
- `startedAt` - дата старта или постановки в очередь.
- `finishedAt` - дата завершения.
- `error` - текст ошибки при `failed`.

### `ErrorResponse`

```ts
type ErrorResponse = {
  message: string;
  code?: string;
};
```

Примеры `code`:

- `unauthorized`
- `forbidden`
- `folder_not_found`
- `video_not_found`
- `folder_already_exists`
- `path_not_found`
- `invalid_path`
- `range_not_satisfiable`

## Endpoints

### `GET /api/health`

Проверка, что сервер работает.

Что делает бэкенд:

1. Не требует авторизации.
2. Возвращает простой статус.

Response `200`:

```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### `POST /api/auth/login`

Вход пользователя.

Request:

```json
{
  "login": "admin",
  "password": "admin1234"
}
```

Что делает бэкенд:

1. Проверяет, что `login` и `password` переданы.
2. Ищет пользователя по `login`.
3. Проверяет пароль через hash verify.
4. Создает token.
5. Возвращает данные сессии.

Response `200`:

```json
{
  "token": "jwt-or-random-token",
  "login": "admin",
  "role": "admin",
  "expiresAt": "2026-06-21T12:00:00Z"
}
```

Ошибки:

- `400` - не передан логин или пароль;
- `401` - неверный логин или пароль.

### `GET /api/auth/me`

Получить текущего пользователя по токену.

Headers:

```http
Authorization: Bearer <token>
```

Что делает бэкенд:

1. Проверяет токен.
2. Находит пользователя.
3. Возвращает сессию/профиль.

Response `200`:

```json
{
  "token": "jwt-or-random-token",
  "login": "admin",
  "role": "admin",
  "expiresAt": "2026-06-21T12:00:00Z"
}
```

Ошибки:

- `401` - нет токена или токен невалидный.

### `GET /api/folders`

Получить список папок, доступных текущему пользователю.

Query:

| Параметр | Тип | Для чего нужен | Если не указан |
| --- | --- | --- | --- |
| `parentId` | `string` или `null` | Фильтрует папки по родителю. Используется, когда нужно получить папки конкретного уровня дерева. `parentId=null` означает корневые папки. | Не фильтровать по родителю, вернуть все папки, доступные пользователю с учетом остальных фильтров. |
| `rootFolderId` | `string` | Ограничивает результат одной корневой папкой и всеми папками внутри нее. Полезно для админки, рескана, поиска внутри конкретного добавленного пути. | Не ограничивать конкретной корневой папкой. |
| `query` | `string` | Поиск по имени папки и, при желании, по `path`. Поиск лучше делать case-insensitive. | Не применять поиск, вернуть все подходящие папки. |

Примеры:

- `GET /api/folders` - все папки, доступные текущему пользователю.
- `GET /api/folders?parentId=null` - только корневые папки.
- `GET /api/folders?parentId=movies` - папки внутри `movies`.
- `GET /api/folders?rootFolderId=movies` - все папки внутри корня `movies`.
- `GET /api/folders?query=season` - папки, где имя или путь содержит `season`.

Поведение по умолчанию:

- Если не передан ни один query-параметр, backend возвращает все папки, которые пользователь имеет право видеть.
- Для `guest` это обычно все папки из включенных корневых папок.
- Для `admin` это могут быть все папки, включая отключенные корни.
- Если параметр передан пустой строкой, например `query=`, его лучше считать отсутствующим.
- Если `parentId` или `rootFolderId` указывает на недоступную папку, можно вернуть пустой массив, а не `404`, потому что это list endpoint.

Что делает бэкенд:

1. Определяет пользователя по токену, если он есть.
2. Если токена нет, работает как `guest`.
3. Применяет ролевой фильтр:
   - `guest` видит только `enabled = true`;
   - `viewer` видит разрешенные ему папки;
   - `admin` может видеть все.
4. Применяет фильтры `parentId`, `rootFolderId`, `query`.
5. Возвращает массив `Folder`.

Response `200`:

```json
[
  {
    "id": "movies",
    "name": "Movies",
    "path": "D:\\Video\\Movies",
    "parentId": null,
    "rootFolderId": "movies",
    "isRoot": true,
    "enabled": true,
    "filesCount": 42,
    "videoCount": 3,
    "childFolderCount": 5,
    "lastScanAt": "2026-06-17T12:00:00Z"
  }
]
```

### `POST /api/folders`

Добавить новую корневую папку.

Headers:

```http
Authorization: Bearer <token>
```

Request:

```json
{
  "path": "D:\\Video\\Movies"
}
```

Что делает бэкенд:

1. Проверяет токен.
2. Проверяет роль: нужен `admin` или другое право управления папками.
3. Валидирует `path`: строка не пустая, путь абсолютный, путь существует.
4. Проверяет, что путь еще не добавлен.
5. Создает корневую `Folder`:
   - `parentId = null`;
   - `isRoot = true`;
   - `rootFolderId = id`;
   - `enabled = true`.
6. Создает `ScanJob` со статусом `queued`.
7. Запускает сканирование сразу или ставит в очередь.
8. Возвращает созданную папку и задачу сканирования.

Response `201`:

```json
{
  "folder": {
    "id": "movies",
    "name": "Movies",
    "path": "D:\\Video\\Movies",
    "parentId": null,
    "rootFolderId": "movies",
    "isRoot": true,
    "enabled": true,
    "filesCount": 0,
    "videoCount": 0,
    "childFolderCount": 0,
    "lastScanAt": "Ожидает сканирования"
  },
  "scanJob": {
    "id": "scan-1",
    "folderId": "movies",
    "status": "queued",
    "processedVideos": 0,
    "processedFolders": 0,
    "startedAt": "2026-06-20T12:00:00Z",
    "finishedAt": null,
    "error": null
  }
}
```

Ошибки:

- `400` - путь пустой или некорректный;
- `401` - нет токена;
- `403` - нет прав;
- `409` - путь уже добавлен.

### `GET /api/folders/root/entries`

Получить корень проводника.

Query:

| Параметр | Тип | Для чего нужен | Если не указан |
| --- | --- | --- | --- |
| `query` | `string` | Фильтрует корневые папки по имени и, при необходимости, по `path`. Нужен для поиска на странице "Все файлы", когда пользователь находится в корне проводника. | Вернуть все корневые папки, доступные текущему пользователю. |

Примеры:

- `GET /api/folders/root/entries` - все корневые папки, доступные пользователю.
- `GET /api/folders/root/entries?query=movies` - только корневые папки, подходящие под поиск `movies`.

Поведение по умолчанию:

- Если `query` не передан, вернуть все доступные корневые папки.
- Если `query` пустой, считать его отсутствующим.
- Видео в этом endpoint обычно не возвращаются, потому что корень проводника состоит из добавленных корневых папок.

Что делает бэкенд:

1. Определяет пользователя по токену, если он есть.
2. Находит корневые папки `isRoot = true`, доступные пользователю.
3. Для `guest` обычно возвращает только `enabled = true`.
4. Возвращает массив `FileBrowserEntry`, где каждая запись будет `{ type: "folder", folder }`.
5. Видео в корне не возвращает, потому что корнем являются добавленные папки.

Response `200`:

```json
[
  {
    "type": "folder",
    "folder": {
      "id": "movies",
      "name": "Movies",
      "path": "D:\\Video\\Movies",
      "parentId": null,
      "rootFolderId": "movies",
      "isRoot": true,
      "enabled": true,
      "filesCount": 42,
      "videoCount": 3,
      "childFolderCount": 5,
      "lastScanAt": "2026-06-17T12:00:00Z"
    }
  }
]
```

### `GET /api/folders/:folderId`

Получить одну папку.

Что делает бэкенд:

1. Находит папку по `folderId`.
2. Проверяет, имеет ли текущий пользователь доступ к ее `rootFolderId`.
3. Возвращает `Folder`.

Response `200`: `Folder`

Ошибки:

- `404` - папка не найдена или недоступна.

### `PATCH /api/folders/:folderId`

Изменить настройки папки.

Headers:

```http
Authorization: Bearer <token>
```

Request:

```json
{
  "name": "Movies",
  "enabled": true
}
```

Что делает бэкенд:

1. Проверяет токен.
2. Проверяет роль управления папками.
3. Находит папку.
4. Обычно разрешает менять настройки только у корневой папки `isRoot = true`.
5. Если меняется `enabled`, применяет видимость ко всему дереву через `rootFolderId`.
6. Если меняется `name`, обновляет имя.
7. Возвращает обновленную `Folder`.

Response `200`: `Folder`

Ошибки:

- `400` - некорректные поля;
- `401` - нет токена;
- `403` - нет прав;
- `404` - папка не найдена.

### `DELETE /api/folders/:folderId`

Удалить корневую папку из просмотра.

Headers:

```http
Authorization: Bearer <token>
```

Что делает бэкенд:

1. Проверяет токен.
2. Проверяет роль управления папками.
3. Находит папку.
4. Проверяет, что это корневая папка `isRoot = true`.
5. Удаляет из базы:
   - корневую папку;
   - все вложенные `Folder`, у которых `rootFolderId = folderId`;
   - все `VideoFile`, у которых `folderId = folderId`.
6. Не удаляет файлы с диска.
7. Возвращает `204`.

Response `204`: без тела.

Ошибки:

- `401` - нет токена;
- `403` - нет прав;
- `404` - папка не найдена.

### `GET /api/folders/:folderId/entries`

Получить содержимое папки.

Query:

| Параметр | Тип | Для чего нужен | Если не указан |
| --- | --- | --- | --- |
| `query` | `string` | Фильтрует содержимое текущей папки. Для папок искать по `folder.name` и можно по `folder.path`; для видео искать по `video.title`, можно дополнительно по `codec`, `resolution`, `path`. | Вернуть все дочерние папки и все видео, которые лежат прямо внутри `folderId`. |

Примеры:

- `GET /api/folders/movies/entries` - все папки и видео внутри папки `movies`.
- `GET /api/folders/movies/entries?query=trailer` - только дочерние папки и видео, подходящие под `trailer`.

Поведение по умолчанию:

- Без `query` backend возвращает прямое содержимое папки без поиска.
- Endpoint не должен рекурсивно возвращать все вложенные элементы. Только один уровень: `parentId = folderId` для папок и `parentFolderId = folderId` для видео.
- Если `query` пустой, считать его отсутствующим.
- Если после фильтрации ничего не найдено, вернуть пустой массив `[]`.

Что делает бэкенд:

1. Находит папку по `folderId`.
2. Проверяет доступ к `rootFolderId`.
3. Находит дочерние папки, у которых `parentId = folderId`.
4. Находит видео, у которых `parentFolderId = folderId`.
5. Применяет поиск по имени, если передан `query`.
6. Возвращает массив `FileBrowserEntry`.
7. Не возвращает обычные файлы.

Response `200`:

```json
[
  {
    "type": "folder",
    "folder": {
      "id": "movies-action",
      "name": "Action",
      "path": "D:\\Video\\Movies\\Action",
      "parentId": "movies",
      "rootFolderId": "movies",
      "isRoot": false,
      "enabled": true,
      "filesCount": 8,
      "videoCount": 2,
      "childFolderCount": 1,
      "lastScanAt": "2026-06-17T12:00:00Z"
    }
  },
  {
    "type": "video",
    "video": {
      "id": "video-1",
      "title": "Movie",
      "folderId": "movies",
      "folderName": "Movies",
      "parentFolderId": "movies-action",
      "size": "733 MB",
      "sizeBytes": 768606208,
      "duration": "01:42:13",
      "modifiedAt": "2026-06-17T12:00:00Z",
      "codec": "H.264",
      "resolution": "1080p",
      "posterUrl": "/api/videos/video-1/poster",
      "streamUrl": "/api/videos/video-1/stream",
      "path": "D:\\Video\\Movies\\Action\\Movie.mp4"
    }
  }
]
```

Ошибки:

- `404` - папка не найдена или недоступна.

### `POST /api/folders/:folderId/rescan`

Запустить пересканирование корневой папки.

Headers:

```http
Authorization: Bearer <token>
```

Что делает бэкенд:

1. Проверяет токен.
2. Проверяет роль управления папками.
3. Находит папку.
4. Если передали вложенную папку, можно либо вернуть `400`, либо сканировать ее корневую папку `rootFolderId`.
5. Создает `ScanJob`.
6. Ставит задачу в очередь.
7. Возвращает `202`.

Response `202`: `ScanJob`

Ошибки:

- `401` - нет токена;
- `403` - нет прав;
- `404` - папка не найдена.

### `GET /api/scan-jobs/:jobId`

Получить статус задачи сканирования.

Headers:

```http
Authorization: Bearer <token>
```

Что делает бэкенд:

1. Проверяет токен.
2. Проверяет право смотреть задачу.
3. Находит задачу.
4. Возвращает `ScanJob`.

Response `200`: `ScanJob`

Ошибки:

- `401` - нет токена;
- `403` - нет прав;
- `404` - задача не найдена.

### `GET /api/videos`

Получить список видео.

Query:

| Параметр | Тип | Для чего нужен | Если не указан |
| --- | --- | --- | --- |
| `rootFolderId` | `string` | Фильтрует видео по корневой папке. Например, показать все видео внутри добавленного пути `D:\Video\Movies`, включая вложенные папки. Сравнивать с `VideoFile.folderId`. | Не ограничивать конкретной корневой папкой. Вернуть видео из всех папок, доступных текущему пользователю. |
| `parentFolderId` | `string` | Фильтрует видео по папке, где файл лежит напрямую. Используется для проводника. Сравнивать с `VideoFile.parentFolderId`. | Не ограничивать конкретной текущей папкой. |
| `query` | `string` | Поиск по видео. Минимум искать по `title`; дополнительно можно искать по `folderName`, `codec`, `resolution`, `path`. Поиск лучше делать case-insensitive. | Не применять поиск. |
| `limit` | `number` | Максимальное количество видео в ответе. Нужно для пагинации и чтобы не отдавать огромный список сразу. Рекомендуемый максимум: `200`. | Использовать значение по умолчанию, например `100`. |
| `offset` | `number` | Сколько видео пропустить от начала результата. Используется вместе с `limit`. | Использовать `0`, то есть начать с первого найденного видео. |

Примеры:

- `GET /api/videos` - первые видео из всех доступных папок, например первые `100`.
- `GET /api/videos?rootFolderId=movies` - все видео из корневой папки `movies`, включая вложенные папки.
- `GET /api/videos?parentFolderId=movies-action` - видео, которые лежат прямо в папке `movies-action`.
- `GET /api/videos?query=matrix` - видео, подходящие под поиск `matrix`.
- `GET /api/videos?limit=50&offset=100` - третья страница, если страница равна 50 элементам.
- `GET /api/videos?rootFolderId=movies&query=trailer&limit=30` - первые 30 видео из `movies`, подходящие под `trailer`.

Поведение по умолчанию:

- Если не указан ни один query-параметр, вернуть первые `limit` видео, доступные текущему пользователю.
- Если `limit` не указан, использовать дефолт, например `100`.
- Если `limit` больше максимума, ограничить максимумом, например `200`.
- Если `offset` не указан, использовать `0`.
- Если `offset` больше количества найденных видео, вернуть `[]`.
- Если `query` пустой, считать его отсутствующим.
- Если одновременно переданы `rootFolderId` и `parentFolderId`, применить оба фильтра: видео должно быть внутри указанного корня и лежать прямо в указанной папке.
- Если указан недоступный `rootFolderId` или `parentFolderId`, вернуть пустой массив `[]`, а не раскрывать существование чужих папок через `404`.

Что делает бэкенд:

1. Определяет пользователя по токену, если есть.
2. Применяет доступ по роли.
3. Для `guest` возвращает видео только из включенных корневых папок.
4. Применяет фильтры `rootFolderId`, `parentFolderId`, `query`.
5. Применяет пагинацию.
6. Возвращает массив `VideoFile`.

Response `200`:

```json
[
  {
    "id": "video-1",
    "title": "Movie",
    "folderId": "movies",
    "folderName": "Movies",
    "parentFolderId": "movies-action",
    "size": "733 MB",
    "sizeBytes": 768606208,
    "duration": "01:42:13",
    "modifiedAt": "2026-06-17T12:00:00Z",
    "codec": "H.264",
    "resolution": "1080p",
    "posterUrl": "/api/videos/video-1/poster",
    "streamUrl": "/api/videos/video-1/stream",
    "path": "D:\\Video\\Movies\\Action\\Movie.mp4"
  }
]
```

### `GET /api/videos/:videoId`

Получить метаданные одного видео.

Что делает бэкенд:

1. Находит видео по `videoId`.
2. Проверяет доступ к его `folderId`.
3. Возвращает `VideoFile`.

Response `200`: `VideoFile`

Ошибки:

- `404` - видео не найдено или недоступно.

### `GET /api/videos/:videoId/stream`

Отдать видеофайл потоком.

Headers от клиента:

```http
Range: bytes=0-
```

Что делает бэкенд:

1. Находит видео по `videoId`.
2. Проверяет доступ к его `folderId`.
3. Проверяет, что файл существует на диске.
4. Определяет mime type.
5. Если `Range` не передан, отдает `200` и весь файл.
6. Если `Range` передан, отдает `206 Partial Content`.
7. Обязательно выставляет:
   - `Accept-Ranges: bytes`;
   - `Content-Length`;
   - `Content-Type`;
   - `Content-Range` для `206`.
8. Не загружает весь файл в память, использует stream.

Response `200`: полный файл.  
Response `206`: часть файла.

Ошибки:

- `404` - видео не найдено, недоступно или файл пропал с диска;
- `416` - некорректный `Range`.

### `GET /api/videos/:videoId/poster`

Получить постер видео.

Что делает бэкенд:

1. Находит видео.
2. Проверяет доступ.
3. Если постер есть, отдает файл.
4. Если постера нет, можно:
   - вернуть дефолтную картинку;
   - сгенерировать кадр через ffmpeg;
   - вернуть `404`.

Response `200`: `image/jpeg` или `image/png`.

Ошибки:

- `404` - видео или постер не найден.

## Сканирование папок

Алгоритм сканирования:

1. Получить корневой путь.
2. Проверить, что путь существует и это папка.
3. Создать или обновить корневую `Folder`.
4. Рекурсивно пройти все вложенные папки.
5. Для каждой вложенной папки создать или обновить `Folder`.
6. Для каждого файла:
   - проверить расширение;
   - если это видео, создать или обновить `VideoFile`;
   - если это не видео, игнорировать.
7. Обновить счетчики:
   - `videoCount` - прямые видео;
   - `childFolderCount` - прямые подпапки;
   - `filesCount` - видео рекурсивно внутри папки.
8. Удалить из базы записи о файлах и папках, которых больше нет на диске.
9. Обновить `lastScanAt`.
10. Завершить `ScanJob`.

## Минимальная структура базы

Таблица `users`:

- `id`
- `login`
- `password_hash`
- `role`
- `created_at`
- `updated_at`

Таблица `folders`:

- `id`
- `name`
- `path`
- `parent_id`
- `root_folder_id`
- `is_root`
- `enabled`
- `files_count`
- `video_count`
- `child_folder_count`
- `last_scan_at`
- `created_at`
- `updated_at`

Таблица `videos`:

- `id`
- `title`
- `folder_id`
- `folder_name`
- `parent_folder_id`
- `size`
- `size_bytes`
- `duration`
- `modified_at`
- `codec`
- `resolution`
- `poster_path`
- `path`
- `created_at`
- `updated_at`

Таблица `scan_jobs`:

- `id`
- `folder_id`
- `status`
- `processed_videos`
- `processed_folders`
- `started_at`
- `finished_at`
- `error`

## Что фронт уже ожидает

Фронт сейчас вызывает:

- `GET /api/videos`
- `GET /api/folders`
- `GET /api/folders/root/entries`
- `GET /api/folders/:folderId/entries`
- `POST /api/auth/login`
- `POST /api/folders`
- `DELETE /api/folders/:folderId`

Для этих запросов лучше реализовать бэк в первую очередь.
