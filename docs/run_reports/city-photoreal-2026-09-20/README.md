# Города: окна, небо, деревья и мокрые улицы — 2026-09-20

Рабочее дерево: `/home/n8n/gamers/spg3d`, базовый HEAD `a528f71`, версия приложения 2.6.1.
Продолжение [предыдущего прохода PBR](../city-photoreal-2026-09-19/README.md).
Все приведённые городские кадры снимаются Playwright непосредственно из WebGL. Они не обработаны генератором изображений.

## Результат и границы

Добавлены интерьерные окна с параллаксом, фотографическое HDR-небо, более естественная форма ближних деревьев,
зеркальный проход реальной сцены для мокрой дороги на High, зимнее покрытие и более сдержанное освещение.
Географические планы и существующие модели достопримечательностей сохранены.

**Полный фотореализм всех моделей не подтверждён.** Большая часть рядовой застройки по-прежнему собрана из
типовых модулей по OSM-контурам; оконные интерьеры синтетические и не воспроизводят реальные квартиры.
Дальние деревья используют прежние карточки, объёмный травяной покров отсутствует, фасадная геометрия упрощена.
Это проверяемое улучшение игрового рендера, а не заявление о фотографической точности каждого здания.

## Что изменено

| Файлы | Поведение и причина |
|---|---|
| `src/game/world/WindowInterior.ts`, `src/assets/interiors/apartments-v1.png` | 16 разных комнат, собственные mip-цепочки каждого слоя, сдержанный параллакс; фотообразная детализация вместо однотонных светящихся прямоугольников. |
| `src/game/world/osm/Kits.ts` | Стёкла выделяются по связным компонентам с приваркой координат/нормалей; UV считаются отдельно для каждого окна. Отражающий PBR-материал стекла сохранён. |
| `src/game/world/city/kit.ts` | Те же интерьеры работают на плоских фасадах дальнего плана и Low. Координаты окон согласованы с существующим painter-атласом. |
| `src/game/world/Sky.ts`, `src/game/assets.ts`, `src/assets/env/*sky.hdr` | Два фотографических неба, отдельная облачная ночная обработка. Дневная HDRI согласована с прямым солнцем и окружением; источники кэшируются. |
| `src/data/tracks.ts`, `src/game/world/Weather.ts` | Более слабый заполняющий свет, без звёзд сквозь осадки; уменьшены размеры и яркость частиц дождя/снега. Щёлково остаётся дневным, Лиговский дождливым ночным, Варшава зимней ночной. |
| `src/game/world/city/TreeLod.ts`, `street.ts`, `src/assets/trees/street-tree-v1.glb` | Ближний ствол/ветви основаны на CC0 Tree Small 02. Листовые карточки размещаются по форме исходной кроны; дальний дешёвый LOD сохраняется. Зимой листва скрыта. |
| `src/game/render/WetStreetReflection.ts`, `RoadMaterial.ts`, `RaceScene.ts` | На High мокрая дорога отражает настоящий зеркальный проход сцены, включая здания вне основного кадра. Отдельная камера с плоскостью отсечения, половинное разрешение, маска луж, Fresnel, размытие. |
| `src/game/world/SurfaceMaterial.ts`, `OsmCity.ts` | Масштаб кирпичных рядов, грязь у цоколя, снег на горизонтальных поверхностях, сохранение влажного асфальта. |
| `qa/city-materials.mjs`, `qa/city-lifecycle.mjs` | Контроль JS/WebGL/HTTP ошибок, UV окон, размеров импортированных деревьев, кадров трёх городов, повторного освобождения сцен. |

## Отражения и ограничения производительности

На High ночная сцена получает один дополнительный проход в 1/2 разрешения (ширина 256–768 px, без отдельного MSAA).
Отражение применяется к основной дороге около y=0; эстакады используют обычное окружение.
Medium/Low сохраняют существующее освещение дороги и отражения окружения без зеркального прохода.
Карты теней во время зеркального прохода повторно не строятся. Текстура отражения отвязывается перед записью,
чтобы избежать framebuffer feedback, а основная дорога исключается из зеркального прохода.

Число ближних деревьев ограничено: High — 48 в пределах 75 м, Medium — 20 в пределах 45 м.
Отсечение совпадает в цветном и теневом проходах; перед применением трансформации meshopt-позиции
разворачиваются из normalized int16 в float32. Деревья не масштабируются в целочисленном буфере.
Исходный GLB после обработки содержит 1000 + 1800 + 7000 треугольников; листовая геометрия используется
для расположения карточек и заменяется ими при сборке сцены. Runtime-бюджет не равен сумме GLB-треугольников.

Headless-проверка использует SwiftShader. Она проверяет рендер и корректность, **не подтверждает FPS на телефоне**.

## Арт-источники и воспроизводимость

- [Kloppenheim 03 (Pure Sky)](https://polyhaven.com/a/kloppenheim_03_puresky): Greg Zaal / Jarod Guest, CC0.
- [Overcast Soil (Pure Sky)](https://polyhaven.com/a/overcast_soil_puresky): Sergej Majboroda / Jarod Guest, CC0.
- [Tree Small 02](https://polyhaven.com/a/tree_small_02): Rico Cilliers, CC0.
- `src/assets/env/sky-sources.json` и `src/assets/trees/street-tree-source.json`: URL, авторство, исходные MD5.
  Обе HDRI и все 11 файлов оригинального дерева сверены с MD5 источника.
- `CREDITS.md` и включённый в сборку `CREDITS.txt` обновлены.

Дерево воспроизводится так (первый аргумент — сохраняемый кэш):

```sh
python3 scripts/fetch-city-tree.py /mnt/ramdisk/spg3d-photo-v2/tree-source
/home/n8n/tools/blender-4.5.13-linux-x64/blender -b --factory-startup -P scripts/blender/tree-lod.py -- /mnt/ramdisk/spg3d-photo-v2/tree-source/tree.gltf /mnt/ramdisk/spg3d-photo-v2/tree-lod-v2.glb
node scripts/pack-city-tree.mjs /mnt/ramdisk/spg3d-photo-v2/tree-lod-v2.glb src/assets/trees/street-tree-v1.glb
npm run build
```

Исходники, логи промежуточных проверок и отклонённые кадры сохранены в `/mnt/ramdisk/spg3d-photo-v2/`.
Промежуточные проблемы: GLSL-имя `patch` было зарезервировано; масштабированный normalized int16
портил дерево; слишком сильное упрощение делало летнюю крону голой; экранный SSR давал полосы.
Эти варианты не являются финальным результатом. SSR заменён зеркальной камерой, а листва — карточками по объёму исходной кроны.

## Сгенерированный материал

Режим: встроенный `image_gen.imagegen`, **generate**, один новый атлас, без референсных картинок и без CLI.
Результат: `src/assets/interiors/apartments-v1.png` (1254×1254), в runtime разделён на 16 слоёв 256×256.
Оригинал сохранён: `/home/n8n/.codex/generated_images/01a0bb5f-d1d6-7263-9ae2-61fd0b852680/exec-4d3e8186-2375-46e6-970d-c8a37ad5c3fa.png`.
Запрошенный размер 2048×2048 генератор не выдал; фактический размер учтён загрузчиком.

Точный prompt:

> Create a production game texture atlas, square 2048 x 2048 image, exact 4 by 4 equal square grid, zero gaps, zero borders, no labels or text. Each of the 16 cells is a different PHOTOREALISTIC modest lived-in European apartment interior viewed straight through an open window at eye level from outside, but DO NOT draw any window frames, glass, exterior walls, borders or mullions. The whole square cell is the view INTO the room. The rear wall fills central 65 percent, side walls, ceiling and floor around it show convincing perspective, photographed architectural interiors. Fixed centered camera, straight verticals, extremely realistic physically lit materials. A mix of modest older Russian and Polish living rooms, bedrooms, kitchens, offices: curtains at edges on about half, realistic indoor plants, books, kitchen cabinets, desks, small sofas. Each cell has DIFFERENT furniture arrangement, depth, wall colors, and light brightness. Some warm lamplit tungsten rooms, some neutral softly lit office rooms, some dim rooms. Restrained exposure, detailed shadows, no overbright white patches. No people. No text. Ordinary buildings, not luxury hotel. The 16 cells must form an EXACT seamless edge-to-edge 4x4 square tile atlas for real-time rendered building windows. This is a material texture, NOT a scene of a building, NOT a collage with margins. High photographic detail, absolutely no illustration or CGI appearance.

Дополнительное исправление: горизонтальные покрытия не читают оконные/световые маски из соседних mip-уровней canvas-атласа. Это уменьшает ложные блики/полосы на снегу вдали. Снежные пятна используют гладкий непериодический шум вместо синусоидальной сетки. Старые instanced-деревья явно освобождают свои instance-буферы при выходе из сцены.

## Проверка памяти: найденная утечка

Повторный переход `menu → ligovsky/high → menu` увеличивал счётчик GPU-текстур на 2 за цикл.
Перехват `WebGL2RenderingContext.createTexture/deleteTexture` показал, что переживают уничтожение меню
две текстуры 1024×1024 из `WebGLShadowMap`: RGBA8 и DEPTH_COMPONENT24. Новые текстуры 8×8
(скелет автомобиля) и 256×256 (пол меню) освобождались корректно.
Причина — `ShowcaseScene.dispose()` не освобождал `key.shadow`. Добавлено адресное `LightShadow.dispose()`;
внутренние текстуры зеркального прохода утечки не дали. Полный диагностический след: `texture-trace.json`.
Также удаляются добавленные QA-замыкания `visualStats` и `wetReflections` после гонки.

Итоговые кадры сняты с `dist-release-v2`, сборка `build-probe.txt`: включено освобождение теней меню,
очистка QA-замыканий и read-only инструмент проверки фасадов. `dist-hashes.json` фиксирует каждый файл этой сборки.

## Корректность ракурсов

Старый ракурс Лиговского `(-202,4,-272)` находился внутри OSM-здания **114542103**; камера Варшавы
`(320,8,-60)` — внутри **350962669**, с пересекающимися building-part **977991989/977991990**.
Raycaster для верхней части Лиговского находил только обращённые вниз поверхности оконных откосов,
а не внешнюю стену; один контрольный луч вообще не имел пересечений. Это был взгляд изнутри одностороннего
фасада, а не доказательство отсутствующих наружных стен. Диагностика сохранена в `facade-probe.json`.

Камеры перенесены соответственно в `(-145,3.5,-289)` и `(253,5,-90)`. QA теперь до запуска браузера
проверяет все камеры по контурам OSM с учётом внутренних дворов и высоты. Старые кадры этих двух ракурсов
не используются как доказательное сравнение. В галерее для них показывается только новая камера.

## Артефакт и итоговая проверка

Релиз: [`spg3d-city-realism-web-20260920-v2.zip`](../../../release/spg3d-city-realism-web-20260920-v2.zip), 60305509 байт, 140 файлов.
SHA256: `30c3d28fc4471ca3d9d1e9faa8dec0175051ebc36bb260fb79bb052618228f24`.
Проверка CRC всех записей ZIP успешна. `release.json` и `dist-hashes.json` фиксируют точный состав.
Промежуточный архив без суффикса `-v2` сохранён; для запуска предназначен **-v2**.

- `npm run build`: TypeScript + Vite PASS, журнал `build-probe.txt`.
- `git diff --check`: PASS.
- High, Лиговский, три цикла `race → menu`: гонка 234 геометрии / 83 текстуры, меню 62 / 41 во всех циклах; ошибок 0.
- Medium, Щёлково: после прогрева последние два цикла совпадают, гонка 194 / 63, меню 70 / 40; ошибок 0.
- `lifecycle-high-fixed.json`, `lifecycle-medium.json`: счётчики и результат проверок.
- `gallery.html`: кадры с переключением города/качества/камеры; `ligovsky-reflections-off.png` — контроль отключения отражения.

Первые параллельные High/Low-процессы получили SIGTERM (143) после частичной записи результатов; причина не установлена.
Недостающие города запущены заново отдельными процессами, исходные журналы сохранены в рабочем каталоге.
JSON-отчёты объединяют завершённые проверки одной и той же неизменной сборки, без подмены недостающих кадров.

Воспроизведение проверки (каждый уровень отдельным запуском):

```sh
DIST=/mnt/ramdisk/spg3d-photo-v2/dist-release-v2 QA_OUT=/tmp/spg3d-city-qa QA_PORT=3897 QA_REFLECTIONS=1 node qa/city-materials.mjs high
DIST=/mnt/ramdisk/spg3d-photo-v2/dist-release-v2 QA_OUT=/tmp/spg3d-city-qa QA_PORT=3898 node qa/city-materials.mjs medium
DIST=/mnt/ramdisk/spg3d-photo-v2/dist-release-v2 QA_OUT=/tmp/spg3d-city-qa QA_PORT=3899 node qa/city-materials.mjs low
```

Следующий художественный этап для исходного требования: индивидуальная геометрия и фотоэталонные фасады
вдоль игровых маршрутов, объёмные обочины и покрытия, более плотная растительность с плавным LOD.
Текущий проход не заменяет эту работу и не доказывает полный фотореализм.

### Матрица WebGL — PASS

3 города × 3 уровня качества × 2 камеры: **18 кадров, JS/WebGL/HTTP ошибок 0**.
UV окон, атрибуты PBR и размеры деревьев проверены во всех комбинациях.

| Город | Качество | Draw calls, камеры 1 / 2 | Треугольники, камеры 1 / 2 |
|---|---|---|---|
| shchyolkovo | high | 170 / 90 | 793821 / 673899 |
| ligovsky | high | 120 / 223 | 273246 / 1235575 |
| warsaw | high | 243 / 112 | 1003439 / 364001 |
| shchyolkovo | medium | 154 / 77 | 299159 / 288297 |
| ligovsky | medium | 57 / 102 | 108907 / 420056 |
| warsaw | medium | 106 / 52 | 368673 / 157731 |
| shchyolkovo | low | 123 / 49 | 111865 / 63809 |
| ligovsky | low | 51 / 91 | 69576 / 164922 |
| warsaw | low | 95 / 40 | 201565 / 79073 |
