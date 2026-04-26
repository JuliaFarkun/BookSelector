# Книгоподбор

Сервис подбора книг на Node.js + Express с PostgreSQL.

## Что есть в проекте

- `GET /api/catalog` — отдает каталог книг, меток и категорий из PostgreSQL.
- `POST /api/metrics/event` — принимает продуктовые события.
- `GET /api/metrics/summary` — агрегированные метрики (конверсия, качество поиска, rolling retention).
- `/admin/metrics` — закрытая админ-страница с основной аналитикой и ручным ignore/unignore плохих запросов.

## Локальный запуск через Docker Compose

```bash
docker compose up --build
```

Compose поднимет:
- `db` (PostgreSQL 16),
- `app` (Node/Express).

Приложение: `http://localhost:3780`  
Админка: `http://localhost:3780/admin/metrics` (использует `x-admin-key`, если установлен `ADMIN_KEY`).

Перед первым запуском импортируйте `booksmatch_bd.sql` в базу `bookmatch` через pgAdmin.

## Запуск без Docker

1. Поднять PostgreSQL (локально или удаленно).
2. Создать `.env` на основе `.env.example`.
3. Выполнить:

```bash
npm install
npm start
```

## Ключевые переменные окружения

- `DATABASE_URL` — строка подключения к PostgreSQL.
- `PORT` — порт приложения, по умолчанию `3780`.
- `ADMIN_KEY` — ключ для доступа к admin API/странице (опционально, но рекомендуется).
- `PGSSL_DISABLE` / `PGSSL_REJECT_UNAUTHORIZED` — параметры SSL для подключения к удаленной БД.
