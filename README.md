# СУПЕР ПИЗДАНУТЫЕ ГОНКИ 3Д — v2

Аркадные уличные гонки по реальным местам: центр Щёлково, Лиговский проспект в Петербурге и центр Варшавы
(карты из OpenStreetMap), карьера из трёх соперников и финальный босс — мех МЭДКИД во дворе Лиговского, 50 у клуба 1703.
Web (Vite + React + three) и Android (Capacitor). Контракт и архитектура — в `DESIGN.md`.

## Запуск

```sh
npm install
npm run dev            # http://localhost:3100
npm run build          # dist/
npm run preview
```

Быстрые входы (QA/отладка): `?screen=race&track=shchyolkovo&car=supra&auto=1&laps=1&opp=5`
(трассы `shchyolkovo`, `ligovsky`, `warsaw`),
`?screen=boss&auto=1`, `?screen=garage&car=m8`. Дополнительно: `q=low|medium|high` (качество),
`ts=3` (ускорение симуляции), `maxdt=0.5` (крупный шаг для медленных рендеров), `pose=0.7`
(зафиксировать поворот машины в гараже).

## Управление

Гонка: `W A S D` / стрелки — руль и газ, `Space` — ручник (дрифт заряжает нитро), `Shift` — нитро,
`C` — камера (погоня / капот / ТВ / вертолёт), `R` — вернуть на трассу, `Esc` — пауза. Геймпад: левый
стик, триггеры, A — ручник, X/RB — нитро. На тач-экранах — экранные кнопки.

Босс: `W A S D` — бег, мышь — прицел (клик захватывает курсор), `ЛКМ` / `Space` — выстрел из
базуки, `Shift` — спринт. Ядро меха открывается после залпа — урон ×3.

## QA (headless, со скринами)

```sh
node qa/shot.mjs "?screen=race&track=shchyolkovo&auto=1&q=low&maxdt=0.5&ts=3" /mnt/ramdisk/spg-shots/shch 6000,20000 1280 720
QA_OUT=/mnt/ramdisk/spg3d-qa node qa/shots.mjs   # полный прогон: все экраны, трассы, босс, отчёт <run>/index.html
node qa/track-tour.mjs ligovsky medium /mnt/ramdisk/tour/l 0.1,0.5   # кадры трассы по долям круга
node qa/view.mjs warsaw /mnt/ramdisk/view/w "320,5,-60>7,90,6"        # кадр мира с фиксированной точки
node qa/boss-shot.mjs /mnt/ramdisk/boss/b medium 3,15                  # финал
python3 qa/map-preview.py ligovsky                                    # карта сверху: трасса, здания, вода
npx esbuild qa/sim.ts --bundle --platform=node --format=esm --outfile=/mnt/ramdisk/spg3d-sim.mjs && node /mnt/ramdisk/spg3d-sim.mjs   # физика/ИИ без WebGL
```

Headless-рендер идёт через SwiftShader (Chromium) — медленно, поэтому в QA используется `q=low`,
`maxdt` и `ts`. Скрины сохраняются на рамдиск (правило хоста: диски — узкое место).

## Ассеты

Машины — GLB со Sketchfab (см. `public/CREDITS.txt`), исходники в `src/assets/cars-src/`.
`npm run assets:optimize` собирает оптимизированные копии в `src/assets/cars/`: колёса помечаются
материалами `spgwheel_<i>` (крутятся и поворачиваются), остальное объединяется по материалам,
упрощается (meshopt) и сжимается (webp ≤ 1024 px). 69 МБ → 13 МБ, ~30 draw calls на машину.

Звук синтезируется целиком (Web Audio): движок (профили v8 / i6-turbo / v6 / w16), шины, удары,
UI, босс. Музыка — десять mp3 (madk1d / Тёмный Принц) через Winamp-виджет с DSP (басуха,
найткор, слоу+реверб).

## Карты реальных мест

```sh
node scripts/osm-fetch.mjs ligovsky 59.9255 30.3620 1300   # выгрузка OSM (Overpass) на рамдиск
node scripts/osm-map.mjs ligovsky                          # → src/data/maps/ligovsky.{route,world}.json
scripts/build-landmarks.sh                                 # Blender headless → src/assets/landmarks/landmarks.glb
```

Петля трассы задаётся путевыми точками в `scripts/osm-maps.config.mjs` (кратчайший путь по графу улиц,
`free` — прямая связка), там же ориентиры: модели по координатам OSM и вывески на фасадах. Мир строит
`src/game/world/osm/OsmCity.ts`. Данные © участники OpenStreetMap, ODbL.

## Android

```sh
scripts/build-apk.sh   # dist → cap sync → gradle assembleRelease → release/spg3d-<ver>-release.apk
```

Требуется JDK 21 (`/home/n8n/tools/jdk-21.0.11+10`) и Android SDK (`/home/n8n/android-sdk`).
Ключ подписи — `android/keystore/spg3d.jks` (пароль `spg3d2026`), приложение — landscape,
immersive, `ru.spg3d.game`. Вывод gradle идёт в `/mnt/ramdisk/spg3d-android`.
