# lampa-audio-guard

Плагин для [Lampa](https://github.com/yumata/lampa-source): усыпляет WebAudio (`AudioContext`)
на время внешнего плеера.

Открытый `AudioContext` (его, например, держит плагин Modss) не даёт системному микшеру Android
уйти в standby. На приставках вроде SberBox (Amlogic) аудио-HAL в это время не запускает прямой
поток, и битстрим AC3 / E-AC3 / DTS во внешнем плеере (ViMu и т.п.) не идёт: тишина, заикание
или откат на PCM.

Плагин перехватывает `AudioContext`, на запуске внешнего плеера (`Lampa.Android.openPlayer`) или
уходе страницы в фон вызывает `suspend()`, при возврате в Lampa — `resume()`.

## Установка

Настройки → Расширения → Добавить плагин:

```
https://rufim.github.io/lampa-audio-guard/audio-guard.js
```
