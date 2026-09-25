# СПLOVE фаза 1: воркер, база и сессия игрока

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Игра, открытая как Telegram Mini App, узнаёт игрока по подписанным данным Telegram, проверяет его членство в чате и здоровается по имени.

**Architecture:** Cloudflare Worker принимает `POST /api/session` с заголовком `X-Telegram-Init-Data`, проверяет HMAC-подпись токеном бота, апсертит игрока в D1 и раз в сутки уточняет членство в чате через `getChatMember`. Игра остаётся статикой на GitHub Pages и ходит в воркер двумя новыми модулями.

**Tech Stack:** Cloudflare Workers, D1 (SQLite), TypeScript, Vitest + `@cloudflare/vitest-pool-workers`, нативные ES-модули на клиенте без сборщика.

Спека: `docs/superpowers/specs/2026-09-25-splove-accounts-leaderboard-design.md`

---

## Что уже сделано до начала плана

| Ресурс | Значение |
|---|---|
| Аккаунт Cloudflare | `009764c4efd40770f23e6fe3a4cacb75`, `wrangler` авторизован |
| Бот | `@splove_game_bot`, id `8831222983` |
| Токен бота | `~/.config/splove/bot_token`, права 600 |
| Тестовый чат | `-5327135658`, бот в нём состоит |
| Игра | https://sorvalliny.github.io/splove-game/ |

Проверено вживую: `getChatMember` для владельца возвращает `creator`.

## Структура файлов

```
worker/
  wrangler.toml              конфигурация воркера и привязка D1
  package.json               зависимости и скрипты
  tsconfig.json
  vitest.config.ts
  migrations/
    0001_players.sql         таблица players
  src/
    index.ts                 роутер и CORS, ~60 строк
    http/envelope.ts         конверт ответа и коды ошибок, ~50
    telegram/verify.ts       разбор и проверка подписи initData, ~70
    telegram/api.ts          вызовы Bot API, пока только getChatMember, ~40
    db/players.ts            апсерт игрока и кэш членства, ~80
    routes/session.ts        обработчик POST /api/session, ~60
  test/
    envelope.test.ts
    verify.test.ts           подпись: валидная, подделанная, просроченная, битая
    players.test.ts          апсерт и кэш членства
    tgapi.test.ts            статусы членства
    session.test.ts          ручка целиком на живом воркере
js/
  api.js                     клиент воркера, ~60 строк
  auth.js                    initData и режим «вне Telegram», ~50
```

`players` в фазе 1 создаётся целиком, как в спеке, включая поля под будущие фазы. `runs` и `bests` не создаются: без них фаза работает, а пустые таблицы мешают читать миграции.

---

### Task 1: Каркас воркера

**Files:**
- Create: `worker/package.json`, `worker/tsconfig.json`, `worker/wrangler.toml`, `worker/src/index.ts`

- [ ] **Step 1: Завести проект**

```bash
mkdir -p ~/Projects/splove-game/worker/src
cd ~/Projects/splove-game/worker
npm init -y
npm install --save-dev wrangler@4 typescript @cloudflare/workers-types vitest @cloudflare/vitest-pool-workers
```

- [ ] **Step 2: Создать базу D1 и забрать её идентификатор**

```bash
cd ~/Projects/splove-game/worker
npx wrangler d1 create splove
```

Вывод содержит `database_id`. Подставить его в `wrangler.toml` следующим шагом.

- [ ] **Step 3: Написать `worker/wrangler.toml`**

```toml
name = "splove-api"
main = "src/index.ts"
compatibility_date = "2026-09-01"

[[d1_databases]]
binding = "DB"
database_name = "splove"
database_id = "ПОДСТАВИТЬ_ИЗ_ШАГА_2"

[vars]
ALLOWED_ORIGIN = "https://sorvalliny.github.io"
```

Секреты `BOT_TOKEN` и `CHAT_ID` в файл не пишутся, они кладутся командой в Task 6.

- [ ] **Step 4: Минимальный роутер**

```ts
// worker/src/index.ts
export interface Env {
  DB: D1Database;
  BOT_TOKEN: string;
  CHAT_ID: string;
  ALLOWED_ORIGIN: string;
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname === '/api/health') {
      return new Response(JSON.stringify({ ok: true, data: { up: true }, error: null }), {
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response('not found', { status: 404 });
  },
};
```

- [ ] **Step 5: Проверить локально**

```bash
cd ~/Projects/splove-game/worker && npx wrangler dev --port 8787
curl -s localhost:8787/api/health
```

Ожидается: `{"ok":true,"data":{"up":true},"error":null}`

- [ ] **Step 6: Коммит**

```bash
cd ~/Projects/splove-game
git add worker
git commit -m "feat: каркас воркера splove-api с привязкой D1"
```

---

### Task 2: Конверт ответа и CORS

**Files:**
- Create: `worker/src/http/envelope.ts`
- Test: `worker/test/envelope.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from 'vitest';
import { ok, fail, withCors } from '../src/http/envelope';

describe('конверт ответа', () => {
  it('успех несёт данные и пустую ошибку', async () => {
    const body = await ok({ a: 1 }).json();
    expect(body).toEqual({ ok: true, data: { a: 1 }, error: null });
  });

  it('ошибка несёт код и сообщение, данных нет', async () => {
    const res = fail('not_a_member', 'Не участник чата', 403);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      ok: false, data: null,
      error: { code: 'not_a_member', message: 'Не участник чата' },
    });
  });

  it('CORS разрешает только оговорённый источник', () => {
    const res = withCors(ok({}), 'https://sorvalliny.github.io');
    expect(res.headers.get('access-control-allow-origin')).toBe('https://sorvalliny.github.io');
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `cd ~/Projects/splove-game/worker && npx vitest run test/envelope.test.ts`
Expected: FAIL, модуль `../src/http/envelope` не найден

- [ ] **Step 3: Реализовать**

```ts
// worker/src/http/envelope.ts
const json = (body: unknown, status: number) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export const ok = <T>(data: T, status = 200) => json({ ok: true, data, error: null }, status);

export const fail = (code: string, message: string, status = 400) =>
  json({ ok: false, data: null, error: { code, message } }, status);

export function withCors(res: Response, origin: string): Response {
  const out = new Response(res.body, res);
  out.headers.set('access-control-allow-origin', origin);
  out.headers.set('access-control-allow-headers', 'content-type, x-telegram-init-data');
  out.headers.set('access-control-allow-methods', 'POST, OPTIONS');
  return out;
}
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/envelope.test.ts`
Expected: PASS, 3 теста

- [ ] **Step 5: Коммит**

```bash
git add worker/src/http worker/test/envelope.test.ts
git commit -m "feat: единый конверт ответа и CORS"
```

---

### Task 3: Проверка подписи Telegram

Самое важное место фазы: на нём держится вся авторизация. Тесты строят подпись независимой реализацией на `node:crypto`, а воркер проверяет её через WebCrypto — две разные библиотеки, поэтому тест ловит ошибку, а не повторяет её.

**Files:**
- Create: `worker/src/telegram/verify.ts`
- Test: `worker/test/verify.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect } from 'vitest';
import { createHmac } from 'node:crypto';
import { verifyInitData } from '../src/telegram/verify';

const TOKEN = '123456:TEST_TOKEN_FOR_TESTS_ONLY';

function signed(fields: Record<string, string>): string {
  const check = Object.keys(fields).sort().map(k => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 956875, first_name: 'Виктор', username: 'sorval' });
const now = () => Math.floor(Date.now() / 1000);

describe('проверка initData', () => {
  it('принимает валидную подпись и достаёт игрока', async () => {
    const r = await verifyInitData(signed({ user, auth_date: String(now()) }), TOKEN);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.user.id).toBe(956875);
  });

  it('отклоняет подделанные данные', async () => {
    const good = signed({ user, auth_date: String(now()) });
    const tampered = good.replace('956875', '999999');
    const r = await verifyInitData(tampered, TOKEN);
    expect(r).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('отклоняет подпись старше суток', async () => {
    const old = String(now() - 60 * 60 * 25);
    const r = await verifyInitData(signed({ user, auth_date: old }), TOKEN);
    expect(r).toEqual({ ok: false, reason: 'expired' });
  });

  it('отклоняет строку без подписи', async () => {
    const r = await verifyInitData(`user=${encodeURIComponent(user)}`, TOKEN);
    expect(r).toEqual({ ok: false, reason: 'no_hash' });
  });

  it('отклоняет пустую строку', async () => {
    expect(await verifyInitData('', TOKEN)).toEqual({ ok: false, reason: 'no_hash' });
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/verify.test.ts`
Expected: FAIL, модуль не найден

- [ ] **Step 3: Реализовать**

```ts
// worker/src/telegram/verify.ts
export interface TgUser {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
}

export type VerifyResult =
  | { ok: true; user: TgUser; authDate: number }
  | { ok: false; reason: 'no_hash' | 'bad_signature' | 'expired' | 'no_user' };

const MAX_AGE_SEC = 60 * 60 * 24;
const enc = new TextEncoder();

async function hmac(keyData: BufferSource, message: string): Promise<ArrayBuffer> {
  const key = await crypto.subtle.importKey('raw', keyData, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', key, enc.encode(message));
}

const hex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

/** Сравнение за постоянное время: длина известна заранее, ранних выходов нет. */
function sameHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export async function verifyInitData(initData: string, botToken: string): Promise<VerifyResult> {
  const params = new URLSearchParams(initData);
  const given = params.get('hash');
  if (!given) return { ok: false, reason: 'no_hash' };

  params.delete('hash');
  const check = [...params.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');

  const secret = await hmac(enc.encode('WebAppData'), botToken);
  if (!sameHex(hex(await hmac(secret, check)), given)) return { ok: false, reason: 'bad_signature' };

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate || Math.floor(Date.now() / 1000) - authDate > MAX_AGE_SEC) {
    return { ok: false, reason: 'expired' };
  }

  const raw = params.get('user');
  if (!raw) return { ok: false, reason: 'no_user' };
  try {
    const user = JSON.parse(raw) as TgUser;
    if (typeof user?.id !== 'number') return { ok: false, reason: 'no_user' };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: 'no_user' };
  }
}
```

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/verify.test.ts`
Expected: PASS, 5 тестов

- [ ] **Step 5: Коммит**

```bash
git add worker/src/telegram/verify.ts worker/test/verify.test.ts
git commit -m "feat: проверка подписи Telegram initData"
```

---

### Task 4: Таблица игроков и кэш членства

**Files:**
- Create: `worker/migrations/0001_players.sql`, `worker/src/db/players.ts`
- Test: `worker/test/players.test.ts`

- [ ] **Step 1: Миграция**

```sql
-- worker/migrations/0001_players.sql
CREATE TABLE IF NOT EXISTS players (
  tg_id             INTEGER PRIMARY KEY,
  name              TEXT NOT NULL,
  username          TEXT,
  photo_url         TEXT,
  is_member         INTEGER NOT NULL DEFAULT 0,
  member_checked_at INTEGER,
  track             TEXT,
  created_at        INTEGER NOT NULL,
  last_seen_at      INTEGER NOT NULL
);
```

- [ ] **Step 2: Применить локально**

```bash
cd ~/Projects/splove-game/worker
npx wrangler d1 migrations apply splove --local
```

- [ ] **Step 3: Написать падающий тест**

```ts
import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { upsertPlayer, needsMemberCheck, setMembership } from '../src/db/players';

const user = { id: 1, first_name: 'Виктор', last_name: 'Сорваль', username: 'sorval' };

describe('игроки', () => {
  it('первый вход создаёт игрока', async () => {
    const p = await upsertPlayer(env.DB, user, 1000);
    expect(p.name).toBe('Виктор Сорваль');
    expect(p.is_member).toBe(0);
    expect(p.created_at).toBe(1000);
  });

  it('повторный вход не создаёт второго и двигает last_seen_at', async () => {
    await upsertPlayer(env.DB, user, 1000);
    const p = await upsertPlayer(env.DB, { ...user, first_name: 'Витя' }, 2000);
    expect(p.created_at).toBe(1000);
    expect(p.last_seen_at).toBe(2000);
    expect(p.name).toBe('Витя Сорваль');
    const { results } = await env.DB.prepare('SELECT COUNT(*) AS n FROM players').all();
    expect(results[0].n).toBe(1);
  });

  it('членство проверяется заново только раз в сутки', async () => {
    await upsertPlayer(env.DB, user, 1000);
    expect(needsMemberCheck(null, 1000)).toBe(true);
    await setMembership(env.DB, user.id, true, 1000);
    expect(needsMemberCheck(1000, 1000 + 3600)).toBe(false);
    expect(needsMemberCheck(1000, 1000 + 86401)).toBe(true);
  });
});
```

- [ ] **Step 4: Убедиться, что тест падает**

Run: `npx vitest run test/players.test.ts`
Expected: FAIL, модуль не найден

- [ ] **Step 5: Реализовать**

```ts
// worker/src/db/players.ts
import type { TgUser } from '../telegram/verify';

export interface Player {
  tg_id: number;
  name: string;
  username: string | null;
  photo_url: string | null;
  is_member: number;
  member_checked_at: number | null;
  track: string | null;
  created_at: number;
  last_seen_at: number;
}

const MEMBER_TTL_SEC = 60 * 60 * 24;

const fullName = (u: TgUser) => [u.first_name, u.last_name].filter(Boolean).join(' ');

export async function upsertPlayer(db: D1Database, u: TgUser, now: number): Promise<Player> {
  await db.prepare(`
    INSERT INTO players (tg_id, name, username, photo_url, created_at, last_seen_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?5)
    ON CONFLICT(tg_id) DO UPDATE SET
      name = ?2, username = ?3, photo_url = ?4, last_seen_at = ?5
  `).bind(u.id, fullName(u), u.username ?? null, u.photo_url ?? null, now).run();

  const row = await db.prepare('SELECT * FROM players WHERE tg_id = ?').bind(u.id).first<Player>();
  if (!row) throw new Error('игрок не сохранился');
  return row;
}

export const needsMemberCheck = (checkedAt: number | null, now: number): boolean =>
  checkedAt === null || now - checkedAt > MEMBER_TTL_SEC;

export async function setMembership(db: D1Database, tgId: number, isMember: boolean, now: number): Promise<void> {
  await db.prepare('UPDATE players SET is_member = ?, member_checked_at = ? WHERE tg_id = ?')
    .bind(isMember ? 1 : 0, now, tgId).run();
}
```

- [ ] **Step 6: Тест зелёный**

Run: `npx vitest run test/players.test.ts`
Expected: PASS, 3 теста

- [ ] **Step 7: Коммит**

```bash
git add worker/migrations worker/src/db worker/test/players.test.ts
git commit -m "feat: таблица игроков и кэш проверки членства"
```

---

### Task 5: Запрос членства в Telegram

**Files:**
- Create: `worker/src/telegram/api.ts`
- Test: `worker/test/tgapi.test.ts`

- [ ] **Step 1: Написать падающий тест**

Сеть в тестах не трогаем: `fetch` подменяется.

```ts
import { describe, it, expect, vi } from 'vitest';
import { isChatMember } from '../src/telegram/api';

const reply = (status: string) =>
  vi.fn(async () => new Response(JSON.stringify({ ok: true, result: { status } })));

describe('getChatMember', () => {
  it.each(['creator', 'administrator', 'member'])('%s считается участником', async (s) => {
    vi.stubGlobal('fetch', reply(s));
    expect(await isChatMember('T', '-1', 1)).toBe(true);
  });

  it.each(['left', 'kicked', 'restricted'])('%s участником не считается', async (s) => {
    vi.stubGlobal('fetch', reply(s));
    expect(await isChatMember('T', '-1', 1)).toBe(false);
  });

  it('недоступный Telegram не роняет запрос', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('сеть'); }));
    expect(await isChatMember('T', '-1', 1)).toBe(false);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/tgapi.test.ts`
Expected: FAIL, модуль не найден

- [ ] **Step 3: Реализовать**

```ts
// worker/src/telegram/api.ts
const MEMBER_STATUSES = new Set(['creator', 'administrator', 'member']);

export async function isChatMember(botToken: string, chatId: string, tgId: number): Promise<boolean> {
  try {
    const url = `https://api.telegram.org/bot${botToken}/getChatMember`
      + `?chat_id=${encodeURIComponent(chatId)}&user_id=${tgId}`;
    const res = await fetch(url);
    const body = await res.json<{ ok: boolean; result?: { status: string } }>();
    return body.ok === true && MEMBER_STATUSES.has(body.result?.status ?? '');
  } catch {
    return false;
  }
}
```

Отказ Telegram трактуется как «не участник», а не как ошибка запроса: игра должна открываться даже когда Telegram недоступен, просто без сохранения. Это решение спеки, раздел «Риски».

- [ ] **Step 4: Тест зелёный**

Run: `npx vitest run test/tgapi.test.ts`
Expected: PASS, 7 тестов

- [ ] **Step 5: Коммит**

```bash
git add worker/src/telegram/api.ts worker/test/tgapi.test.ts
git commit -m "feat: проверка членства в чате через Bot API"
```

---

### Task 6: Ручка POST /api/session

**Files:**
- Create: `worker/src/routes/session.ts`
- Modify: `worker/src/index.ts`
- Test: `worker/test/session.test.ts`

- [ ] **Step 1: Написать падающий тест**

```ts
import { describe, it, expect, vi } from 'vitest';
import { env, SELF } from 'cloudflare:test';
import { createHmac } from 'node:crypto';

const TOKEN = env.BOT_TOKEN;
const user = JSON.stringify({ id: 956875, first_name: 'Виктор', username: 'sorval' });

function initData(): string {
  const fields = { user, auth_date: String(Math.floor(Date.now() / 1000)) };
  const check = Object.keys(fields).sort()
    .map(k => `${k}=${fields[k as keyof typeof fields]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(TOKEN).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const call = (init: string) =>
  SELF.fetch('https://example.com/api/session', {
    method: 'POST', headers: { 'x-telegram-init-data': init },
  });

describe('POST /api/session', () => {
  it('участник чата получает профиль', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { status: 'member' } }))));
    const body = await (await call(initData())).json<any>();
    expect(body.ok).toBe(true);
    expect(body.data.player.name).toBe('Виктор');
    expect(body.data.player.isMember).toBe(true);
  });

  it('не участник получает отказ с понятным кодом', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(JSON.stringify({ ok: true, result: { status: 'left' } }))));
    const res = await call(initData());
    expect(res.status).toBe(403);
    expect((await res.json<any>()).error.code).toBe('not_a_member');
  });

  it('битая подпись получает 401', async () => {
    const res = await call('user=%7B%22id%22%3A1%7D&hash=deadbeef');
    expect(res.status).toBe(401);
    expect((await res.json<any>()).error.code).toBe('bad_init_data');
  });

  it('без заголовка авторизации получает 401', async () => {
    const res = await SELF.fetch('https://example.com/api/session', { method: 'POST' });
    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Убедиться, что тест падает**

Run: `npx vitest run test/session.test.ts`
Expected: FAIL, маршрут отвечает 404

- [ ] **Step 3: Реализовать обработчик**

```ts
// worker/src/routes/session.ts
import type { Env } from '../index';
import { ok, fail } from '../http/envelope';
import { verifyInitData } from '../telegram/verify';
import { isChatMember } from '../telegram/api';
import { upsertPlayer, needsMemberCheck, setMembership } from '../db/players';

export async function handleSession(req: Request, env: Env): Promise<Response> {
  const initData = req.headers.get('x-telegram-init-data');
  if (!initData) return fail('no_init_data', 'Игра открыта не из Telegram', 401);

  const v = await verifyInitData(initData, env.BOT_TOKEN);
  if (!v.ok) return fail('bad_init_data', 'Telegram не подтвердил, кто ты', 401);

  const now = Math.floor(Date.now() / 1000);
  let player = await upsertPlayer(env.DB, v.user, now);

  if (needsMemberCheck(player.member_checked_at, now)) {
    const member = await isChatMember(env.BOT_TOKEN, env.CHAT_ID, v.user.id);
    await setMembership(env.DB, v.user.id, member, now);
    player = { ...player, is_member: member ? 1 : 0, member_checked_at: now };
  }

  if (!player.is_member) {
    return fail('not_a_member', 'Рейтинг только для участников чата сплава', 403);
  }

  return ok({
    player: {
      id: player.tg_id,
      name: player.name,
      photoUrl: player.photo_url,
      track: player.track,
      isMember: true,
    },
  });
}
```

- [ ] **Step 4: Подключить маршрут в `index.ts`**

```ts
import { handleSession } from './routes/session';
import { withCors, ok, fail } from './http/envelope';

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const cors = (r: Response) => withCors(r, env.ALLOWED_ORIGIN);

    if (req.method === 'OPTIONS') return cors(new Response(null, { status: 204 }));
    if (url.pathname === '/api/health') return cors(ok({ up: true }));
    if (url.pathname === '/api/session' && req.method === 'POST') {
      return cors(await handleSession(req, env));
    }
    return cors(fail('not_found', 'Нет такой ручки', 404));
  },
};
```

- [ ] **Step 5: Тест зелёный**

Run: `npx vitest run`
Expected: PASS, все файлы

- [ ] **Step 6: Положить секреты и выкатить**

```bash
cd ~/Projects/splove-game/worker
npx wrangler d1 migrations apply splove --remote
npx wrangler secret put BOT_TOKEN < ~/.config/splove/bot_token
npx wrangler secret put CHAT_ID  < ~/.config/splove/test_chat_id
npx wrangler deploy
curl -s https://splove-api.<поддомен>.workers.dev/api/health
```

Ожидается: `{"ok":true,"data":{"up":true},"error":null}`

- [ ] **Step 7: Коммит**

```bash
git add worker
git commit -m "feat: ручка сессии игрока с проверкой членства"
```

---

### Task 7: Игра здоровается по имени

**Files:**
- Create: `js/auth.js`, `js/api.js`
- Modify: `index.html`, блок `.by` на стартовом экране

- [ ] **Step 1: Клиент Telegram**

```js
// js/auth.js
const tg = globalThis.Telegram?.WebApp ?? null;

export const inTelegram = () => Boolean(tg?.initData);
export const initData = () => tg?.initData ?? '';

export function ready() {
  if (!tg) return;
  tg.ready();
  tg.expand();
}
```

- [ ] **Step 2: Клиент воркера**

```js
// js/api.js
import { initData } from './auth.js';

const BASE = 'https://splove-api.<поддомен>.workers.dev';

async function call(path, body) {
  const res = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-telegram-init-data': initData() },
    body: JSON.stringify(body ?? {}),
  });
  const envelope = await res.json().catch(() => null);
  if (!envelope) {
    return { ok: false, error: { code: 'bad_response', message: 'Сервер ответил непонятным' } };
  }
  return envelope;
}

export const session = () => call('/api/session');
```

- [ ] **Step 3: Показать имя на стартовом экране**

В `index.html` дать блоку `.by` идентификатор и добавить модуль перед закрытием `body`:

```html
<div class="by" id="by">Сплав по Волге. Авторская игра @sorval</div>
...
<script src="https://telegram.org/js/telegram-web-app.js"></script>
<script type="module">
import { ready, inTelegram } from './js/auth.js';
import { session } from './js/api.js';

ready();
if (inTelegram()) {
  const r = await session();
  const by = document.getElementById('by');
  if (r.ok) by.textContent = `${r.data.player.name}, добро пожаловать на воду`;
  else if (r.error.code === 'not_a_member') by.textContent = 'Рейтинг только для участников чата сплава';
}
</script>
```

Вне Telegram строка остаётся прежней: игра обязана открываться и в браузере.

- [ ] **Step 4: Проверить вживую**

Открыть бота `@splove_game_bot`, нажать «На воду». Ожидается: вместо «Авторская игра @sorval» стоит имя из Telegram.

- [ ] **Step 5: Коммит**

```bash
git add js index.html
git commit -m "feat: игра узнаёт игрока через Telegram"
```

---

## Готовность фазы

Фаза считается сделанной, когда выполнено всё:

- [ ] `npx vitest run` зелёный, покрытие по `worker/src` не ниже 80%
- [ ] Воркер выкачен, `/api/health` отвечает
- [ ] Mini App, открытый из бота, показывает имя игрока
- [ ] Игра по прямой ссылке в браузере по-прежнему играется
- [ ] Секреты лежат в Cloudflare, в репозитории их нет

## Чего в этой фазе намеренно нет

Заплывы, рекорды, таблицы рейтинга, офлайн-очередь, бот и любые сообщения в чат. Всё это фазы 2-4. Разбиение движка на модули тоже не здесь: в фазе 1 игра трогается ровно одной строкой на стартовом экране.
