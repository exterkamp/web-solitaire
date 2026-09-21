import { bootstrapApplication } from '@angular/platform-browser';
import { appConfig } from './app/app.config';
import { App } from './app/app';
import { fontsReady } from './app/game/fonts';

// The fonts are waited on before anything renders, because Phaser rasterizes
// a Text object once, at creation, and never re-draws it when a font lands
// later. A board built a moment too early is set in the fallback face for as
// long as it exists - and since the labels are measured for centring at the
// same moment, they aren't even wrong in a consistent direction.
//
// Gating the bootstrap rather than the board is deliberate: it costs nothing
// visible - the fonts are 87kB from the same origin, and `font-display: block`
// is already holding the DOM's own text back over the same window - and
// fontsReady() gives up after 3s rather than hanging.
fontsReady()
  .then(() => bootstrapApplication(App, appConfig))
  .catch((err) => console.error(err));
