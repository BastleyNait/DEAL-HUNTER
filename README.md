# Deal Hunter — Revolt Laptops (backend)

Bot personal que revisa eBay (categoría "PC Laptops & Netbooks") cada cierto tiempo
y manda una notificación a Telegram apenas encuentra una laptop que cumple los
criterios configurados (ver [8. Config de búsqueda](#8-config-de-búsqueda-search_config)).

Por defecto busca:

- Intel i7 10ma/11va gen, Intel i5 11va/12va gen, AMD Ryzen 5 5000, AMD Ryzen 7 4000
- Precio menor a $200 USD
- Sin ser "for parts / not working"
- Sin faltarle almacenamiento (HDD/SSD) ni batería
- Sin batería en estado "fair"/"poor" o por debajo del 70%

y le asigna un puntaje 0-100 para distinguir "ofertas" de "ofertazas" (ver
[7. Algoritmo de puntaje](#7-algoritmo-de-puntaje-ofertaza-vs-oferta-normal)).

Corre como una Supabase Edge Function, disparada por `pg_cron` cada N minutos.
Guarda cada ítem ya revisado en Postgres para no analizarlo ni notificarlo dos veces,
y refresca el token OAuth de eBay solo (los application tokens duran ~2h).

Este repo es solo el **backend** (cazador + API de datos vía Supabase). El
**dashboard web** (donde ves el link de cada publicación) vive en un repo
separado: `deal-hunter-web`, hecho en Vue 3 + Vite, que lee de este backend
por la vista pública `deals_public`.

## Arquitectura (por qué está separado en capas)

Pediste que esto sea adaptable y escalable, así que el código sigue principios
SOLID vía composición de interfaces (no herencia de clases, que en TypeScript/Deno
es menos idiomático) en vez de un único script con todo mezclado:

```
supabase/functions/_shared/
  domain/            Tipos e interfaces (los "puertos"). No sabe de eBay/Supabase/Telegram.
    types.ts           MarketplaceClient, ExclusionRule, ScoreFactor, DealRepository,
                        NotificationChannel, ConfigProvider, etc.
    default-config.ts  Config por defecto (fallback si falla la tabla search_config).
    hardware-signals.ts Extractores de % batería / grado / RAM / storage, detección
                        de repuestos y huella anti-duplicados, desde texto libre.
  cpu/
    cpu-matcher.ts     Matchea el título contra las CPUs buscadas.
  rules/
    exclusion-rules.ts Reglas de descarte (for-parts, repuestos/BIOS locked, sin
                        disco, batería baja, precio fuera de presupuesto...).
                        Agregar una regla nueva = agregar un objeto, no tocar las demás.
  scoring/
    factors.ts                   Un factor de puntaje por archivo-función (precio, CPU,
                                  condición, batería, RAM, storage).
    weighted-scoring-strategy.ts Combina los factores en un puntaje 0-100.
  infrastructure/    Implementaciones concretas de los puertos de domain/types.ts.
    ebay-token-store.ts             OAuth de eBay (se auto-refresca).
    ebay-marketplace-client.ts      Adaptador de eBay Browse API -> MarketplaceClient.
    supabase-config-provider.ts     Lee search_config -> ConfigProvider.
    supabase-deal-repository.ts     Persistencia de ofertas -> DealRepository.
    supabase-run-tracker.ts         Registro de cada corrida -> RunTracker.
    telegram-notification-channel.ts Notificación -> NotificationChannel.
  application/
    hunt-service.ts   Orquesta el flujo completo. Solo conoce las interfaces de
                       domain/, nunca las clases concretas de infrastructure/.
functions/hunt-deals/index.ts   Composition root: arma las implementaciones
                                 concretas y las inyecta en HuntService. Es la
                                 única pieza que "sabe" que hoy usamos eBay +
                                 Supabase + Telegram.
```

Qué te da esto en la práctica:

- **Agregar otro marketplace** (ej. Facebook Marketplace, MercadoLibre): escribís
  una clase que implemente `MarketplaceClient` en `infrastructure/`, la cableás
  en `index.ts`. `hunt-service.ts` no cambia.
- **Agregar otro canal de notificación** (push, WhatsApp): igual, implementás
  `NotificationChannel`.
- **Agregar una regla de descarte o un factor de puntaje**: un objeto nuevo en
  `rules/` o `scoring/factors.ts`, sin tocar los existentes (Open/Closed).
- **Cambiar el criterio de búsqueda sin redeployar**: editás la fila en la tabla
  `search_config` (ver más abajo).

## Cómo encuentra ofertas (pool rotativo de búsquedas)

Buscar solo `q=laptop` rendía poquísimo. Midiendo contra la Browse API real:

| Query | Resultados ≤$225 | Aciertos en la página 1 |
| --- | --- | --- |
| `laptop` | 92.268 | 23/100 |
| `1145g7` | 949 | 99/100 |
| `1135g7` | 894 | 99/100 |
| `1165g7` | 263 | 100/100 |
| `i5 11th gen` | 249 | 100/100 |

Por eso `config.searchProfiles` es un **pool de ~43 vetas** (queries por número de
modelo de CPU ordenadas por precio, más queries amplias por "recién publicado" y
subastas por terminar). Cada corrida usa una ventana rotativa de
`profilesPerRun` vetas, elegida según el id de corrida, así se recorre el pool
entero a lo largo del día sin pasarse de la cuota diaria de la API.

Además:

- `fieldgroups=EXTENDED` trae `shortDescription` en la búsqueda sin llamadas
  extra: sirve para matchear CPU cuando el título no trae el modelo, y para
  **pre-descartar** basura antes de gastar una llamada de detalle.
- Los candidatos se ordenan por precio ascendente antes de gastar el presupuesto
  de llamadas de detalle (`maxCandidatesPerRun`).
- Se colapsan republicaciones del mismo equipo por huella (título normalizado +
  precio): hay vendedores que suben la misma laptop 10 veces cambiando un solo
  carácter del título.
- Una veta o un ítem que falla (timeout, 5xx) se registra y se sigue: un error
  puntual no tira abajo la corrida entera.

Medido antes/después en la misma ventana horaria: de **41 candidatos y 16 útiles**
por corrida a **~450 candidatos y ~350 útiles**, con ~1.100 únicos por ciclo
completo del pool.

## 1. Requisitos

- Cuenta de Supabase (gratis) y un proyecto creado.
- Node.js (para correr `npx supabase ...` sin instalar la CLI global — es lo que usan los comandos de abajo).
- Bot de Telegram: hablale a [@BotFather](https://t.me/BotFather), `/newbot`, copiá el token.
- Tu `chat_id` de Telegram: escribile algo a tu bot y luego abrí
  `https://api.telegram.org/bot<TU_TOKEN>/getUpdates` — ahí aparece `"chat":{"id": ...}`.
- Tus credenciales de eBay **Production** (Developer Portal → Application Keys):
  - App ID (Client ID)
  - Cert ID (Client Secret) — mantenelo secreto, nunca lo subas a git.

## 2. Vincular el proyecto

```powershell
npx supabase login
npx supabase link --project-ref TU_PROJECT_REF
```

`TU_PROJECT_REF` está en la URL del proyecto en el dashboard de Supabase
(`https://supabase.com/dashboard/project/<project-ref>`).

## 3. Aplicar la base de datos

```powershell
npx supabase db push
```

Esto corre las migraciones en orden: `ebay_oauth_token` / `seen_listings` /
`hunt_runs` (0001), la vista pública `deals_public` (0002), y la tabla
`search_config` con los defaults ya cargados (0003).

## 4. Configurar secrets

Nunca pongas el Cert ID en un archivo dentro del repo. Cargalo directo en Supabase.

Primero generá un valor random para `CRON_SECRET` (en PowerShell no existe `openssl`
por defecto; esto hace lo mismo, compatible con Windows PowerShell 5.1):

```powershell
$rng = New-Object System.Security.Cryptography.RNGCryptoServiceProvider
$bytes = New-Object byte[] 24
$rng.GetBytes($bytes)
$cronSecret = -join ($bytes | ForEach-Object { $_.ToString("x2") })
$cronSecret
```

Copiá el valor que imprime (lo necesitás también en el paso 6) y usalo abajo:

```powershell
npx supabase secrets set EBAY_ENV=PRODUCTION
npx supabase secrets set EBAY_CLIENT_ID=Sebastia-revolt-PRD-e829e7080-01646a13
npx supabase secrets set EBAY_CLIENT_SECRET=TU_CERT_ID_DE_PRODUCTION
npx supabase secrets set TELEGRAM_BOT_TOKEN=TU_TOKEN_DE_TELEGRAM
npx supabase secrets set TELEGRAM_CHAT_ID=TU_CHAT_ID
npx supabase secrets set CRON_SECRET=$cronSecret
```

(`SUPABASE_URL` y `SUPABASE_SERVICE_ROLE_KEY` los inyecta Supabase automáticamente
dentro de la función, no hace falta setearlos.)

**Importante:** la función ahora rechaza cualquier request si `CRON_SECRET` no
está seteado o no coincide (falla cerrado a propósito). Verificá que haya quedado
bien con:

```powershell
npx supabase secrets list
```

## 5. Deployar la función

```powershell
npx supabase functions deploy hunt-deals
```

Probala a mano (reemplazando el secret y la URL del proyecto — Windows trae
`curl.exe` desde Windows 10, así que esto funciona igual en PowerShell):

```powershell
curl.exe -X POST "https://TU_PROJECT_REF.supabase.co/functions/v1/hunt-deals" -H "x-cron-secret: TU_CRON_SECRET"
```

Si todo está bien deberías ver algo como
`{"ok":true,"itemsScanned":..,"candidatesChecked":..,"itemsQualified":..}`
y, si encontró algo, un mensaje en tu Telegram.

## 6. Programar la corrida automática (pg_cron + pg_net)

En el SQL Editor del dashboard de Supabase, corré una sola vez:

```sql
create extension if not exists pg_cron with schema extensions;
create extension if not exists pg_net with schema extensions;

select cron.schedule(
  'hunt-deals-every-15-min',
  '*/15 * * * *',
  $$
  select net.http_post(
    url := 'https://TU_PROJECT_REF.supabase.co/functions/v1/hunt-deals',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', 'TU_CRON_SECRET'
    ),
    body := '{}'::jsonb
  );
  $$
);
```

**Sin este paso el bot solo caza cuando lo llamás a mano.** Se puede verificar si
está corriendo solo mirando si hay filas en `hunt_runs` con intervalos regulares.

Cuentas de cuota (la Browse API de eBay da 5.000 llamadas/día por defecto):
cada corrida usa `profilesPerRun` llamadas de búsqueda (10) más, como mucho,
`maxCandidatesPerRun` de detalle (30) — el pre-descarte hace que en la práctica
sean bastantes menos. Con el cron cada 15 min (96 corridas/día) el techo teórico
es ~3.800/día. Si ves errores de cuota, subí el intervalo a `*/20 * * * *` o
bajá `maxCandidatesPerRun` en `search_config`.

### Cuántos avisos te llegan

Con el pool ampliado pueden aparecer decenas de ofertas por corrida, así que
Telegram recibe una notificación individual solo por las **ofertazas** (hasta
`maxNotificationsPerRun`, 8 por defecto, las de mejor puntaje primero) y un
único mensaje de resumen por el resto. En el dashboard aparecen todas igual.
Para que avise por todas: `update public.search_config set config = config ||
'{"notifyOnlyGreatDeals": false}'::jsonb where id = 1;`

Para desprogramarlo más adelante: `select cron.unschedule('hunt-deals-every-15-min');`

## 7. Algoritmo de puntaje ("ofertaza" vs oferta normal)

Cada oferta que califica recibe un puntaje 0-100
([scoring/factors.ts](supabase/functions/_shared/scoring/factors.ts)) combinando:

| Factor | Peso | Detalle |
| --- | --- | --- |
| Precio | 40% | más lejos de `maxPriceUsd`, mejor |
| Tier de CPU | 20% | i7 11va(6) > i5 12va(5) > i7 10va(4) > Ryzen 7 4000(3) > i5 11va(2) > Ryzen 5 5000(1) |
| Condición del listado | 15% | Very Good > Good > Used > Acceptable |
| % de batería mencionado | 15% | escala entre 70% (0 puntos) y 100% (1 punto) |
| RAM mencionada | 5% | **0** si &lt;8GB, **0.5** si 8-15GB, **1** si ≥16GB |
| Almacenamiento mencionado | 5% | **0** si &lt;256GB, **0.5** si 256-511GB, **1** si ≥512GB (1TB+ = tope) |

Se marca como **⚡ ofertaza** (`is_great_deal`) si el precio es ≤ `greatDealMaxPrice`
($160 por defecto) **o** el puntaje es ≥ `greatDealMinScore` (80 por defecto). Las
ofertazas llegan a Telegram con el encabezado "🚨 OFERTAZA" en vez de "🔥 Oferta
encontrada", y se pueden filtrar aparte en el dashboard web.

## 8. Config de búsqueda (`search_config`)

Los valores de arriba (CPUs, precio, umbral de batería, pesos implícitos en el
puntaje) **no están hardcodeados en el código** — son los defaults, guardados
como JSON en la tabla `search_config` (fila `id = 1`, sembrada por la migración
`0003_search_config.sql`). El backend lee esa fila en cada corrida
(`SupabaseConfigProvider`); si la lectura falla, usa
[domain/default-config.ts](supabase/functions/_shared/domain/default-config.ts)
como respaldo, así el bot nunca se cae por un problema de config.

Para ajustar el criterio **sin redeployar nada**, editá la fila desde el SQL
Editor del dashboard de Supabase, por ejemplo:

```sql
-- Bajar el precio máximo a $180
update public.search_config
set config = config || '{"maxPriceUsd": 180}'::jsonb
where id = 1;

-- Agregar una CPU nueva a buscar (Ryzen 5 4000)
update public.search_config
set config = jsonb_set(
  config,
  '{cpuPatterns}',
  config->'cpuPatterns' || '[{"label": "AMD Ryzen 5 4000", "pattern": "ryzen\\s*5\\s*4\\d{3}[a-z]{0,2}\\b", "flags": "i", "tier": 1}]'::jsonb
)
where id = 1;
```

## Estructura

```
supabase/
  migrations/
    0001_init.sql                      tablas base
    0002_scoring_and_public_view.sql   columnas de puntaje + vista pública deals_public
    0003_search_config.sql             tabla de config editable + defaults
  functions/
    hunt-deals/index.ts   composition root (HTTP handler)
    _shared/               domain / cpu / rules / scoring / infrastructure / application
                            (ver sección "Arquitectura" arriba)
```

## Notas

- Las claves que me pasaste al armar esto eran las de **Production**
  (`PRD-...`), no las de Sandbox — Sandbox no tiene listados reales.
- El `CRON_SECRET` evita que cualquiera con la URL de la función pueda dispararla;
  la función devuelve 401 si el header no coincide.
- `seen_listings` guarda tanto los que calificaron como los que fueron descartados
  (con su `reject_reason`), así cada ítem se evalúa una sola vez aunque siga
  apareciendo en búsquedas futuras.
