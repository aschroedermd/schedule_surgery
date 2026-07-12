# Hidden Tamagotchi Feature Migration Guide

This directory packages the hidden Dr. Nussbaum Tamagotchi feature from the
SurgeryDashboard iOS app so it can be rebuilt as a standalone webapp in another
project. It includes the runtime images, audio, screenshots for visual matching,
and a Swift source reference.

## Directory Map

```text
tamagotchi-feature/
  README.md
  asset-manifest.json
  images/
    Tamagotchi.png
    nb_char_16bit_{whitecoat,scrubs,gd,grill,basketball,vacation,tux,pjs}.png
    nb_call_bg_ring.png
    nb_call_bg_answered.png
    nb_call_background.unused-reference.png
  audio/
    blip.mp3
    sonar.mp3
    nb-first.mp3
    ring.mp3
    nussbaum_call.mp3
    RandomPhrases/*.mp3
    additional top-level legacy Nussbaum clips
  screenshots/
    nussbaum-easter-egg.png
    nussbaum-buttons-scrubs.png
  source-reference/
    TimerView.swift
```

## Original App Wiring

The feature currently lives in `SurgeryDashboard/TimerView.swift`. A copied
reference version is included at `source-reference/TimerView.swift`.

Important Swift sections:

- Hidden entry point: the `Status` row title is a button. Tapping it sets
  `isEasterEggPresented = true`.
- Navigation: `navigationDestination(isPresented:)` opens
  `NussbaumEasterEggView`.
- Main state machine: `NussbaumEasterEggView`.
- Device shell and button hit zones: `TamagotchiSimulatorView`.
- LCD contents: `NussbaumLCDScreen`, `PixelEggView`, `EggCrackShape`, and
  `LCDScanlines`.
- Phone call flow: `CallMeTimerSheet` and `NussbaumCallView`.
- Audio loading: `NussbaumAudioPlayer`.

There is no backend requirement for the feature. It is a client-side UI with
local image and audio assets.

## User Experience

1. User opens the hidden feature by tapping the timer screen's `Status` label.
2. A Tamagotchi device shell appears with an egg inside the LCD.
3. The first egg tap shakes the egg, plays `sonar.mp3`, and displays `sounds
   like somethings inside!`; the second tap starts the hatch sequence.
4. After hatching, the LCD shows `Dr. Nussbaum` and the whitecoat pixel sprite.
5. The left physical button plays `blip.mp3` and moves one sprite backward,
   stopping at whitecoat.
6. The middle physical button plays the next randomized audio phrase. Every
   phrase is used once before the deck is reshuffled.
7. The right physical button plays `blip.mp3` and moves one sprite forward;
   it wraps from pajamas back to whitecoat.
8. The top-right menu contains `callme`.
9. `callme` opens a minute/second picker. After the delay, a fake full-screen
   phone call appears, rings, can be tapped to answer, then plays
   `nussbaum_call.mp3`.

## Web Port Architecture

A small React/Vite app is enough. Suggested components:

```text
src/
  App.tsx
  tamagotchi/
    NussbaumTamagotchi.tsx
    TamagotchiDevice.tsx
    LcdScreen.tsx
    CallMeDialog.tsx
    FakePhoneCall.tsx
    audio.ts
    constants.ts
  assets/
    images/
    audio/
```

Copy `images/` and `audio/` into your web project's public assets folder or
import them through the bundler. For the fastest junior-developer path, use
`public/tamagotchi/images/...` and `public/tamagotchi/audio/...`, then reference
them with plain URLs.

## Core Constants

Use these values to align the web version with the iOS layout:

```ts
export const DEVICE = { width: 708, height: 1258 };
export const LCD_RECT = { x: 130, y: 530, width: 450, height: 420 };
export const MAX_DEVICE_WIDTH = 380;
export const BUTTON_RADIUS = 80;
export const BUTTONS = {
  left: { x: 216, y: 1140 },
  middle: { x: 356, y: 1170 },
  right: { x: 500, y: 1138 },
};

export const CALL_IMAGE = { width: 1320, height: 2868 };
export const CALL_TIMER_Y_RANGE = { min: 564, max: 620 };
```

The LCD and button coordinates are in the natural pixel coordinate space of
`Tamagotchi.png`. In CSS, render the device shell as a relatively positioned
container, scale its natural width to `min(containerWidth, 380px)`, and position
the LCD/buttons by multiplying their natural coordinates by the same scale.

## State Model

The web version should keep this state:

```ts
type ButtonRole = "left" | "middle" | "right";

type TamagotchiState = {
  hasStarted: boolean;
  eggTapCount: number;
  eggCracked: boolean;
  hasHatched: boolean;
  characterIndex: number;
  isTransforming: boolean;
  screenMessage: string | null;
  pressedButton: ButtonRole | null;
};
```

Hatch behavior:

- Ignore egg taps after `hasStarted` or `hasHatched`.
- On tap 1, run a short shake animation, play `audio/sonar.mp3`, and show
  `sounds like somethings inside!` for `2500ms`.
- On tap 2:
  - set `hasStarted = true`;
  - shake for `850ms`;
  - after `420ms`, set `eggCracked = true` and repeat the crack shake 5 times
    over `280ms`;
  - after another `1350ms`, set `hasHatched = true`;
  - play `audio/nb-first.mp3`;
  - show `His first words!` for `2000ms`;
  - after `250ms`, start gentle floating animations for the name and sprite.

Button behavior:

- Left button: play `audio/blip.mp3`; before hatch, show a random mystery egg
  message. After hatch, move one image backward without wrapping below
  whitecoat.
- Middle button: before hatch, show a random mystery egg message. After hatch,
  play the next randomized file from `audio/RandomPhrases/`; do not repeat a
  file until every phrase has played.
- Right button: play `audio/blip.mp3`; before hatch, show a random mystery egg
  message. After hatch, move one image forward, wrapping pajamas to whitecoat,
  and run a `260ms` transform animation.
- Any physical button press should show a visual pressed state for about
  `180ms`.

Mystery egg messages:

```ts
[
  "This egg is emitting weird surgical energy",
  "You hear 'scalpel' from inside",
  "This egg is spooky",
  "I wonder what is in the egg",
]
```

## Visual Implementation Notes

The device shell is a single bitmap: `images/Tamagotchi.png`.

The LCD is drawn on top of that image:

- LCD background: `rgb(158, 194, 138)`.
- Add horizontal scanlines every `8px` with black at about `0.09` opacity.
- Before hatch, draw the egg with CSS or SVG. No egg image is needed.
- After hatch, show the text label `Dr. Nussbaum` above the character sprite.
- Use `image-rendering: pixelated` for the character sprites.
- Character sprite sequence: `images/nb_char_16bit_whitecoat.png`,
  `images/nb_char_16bit_scrubs.png`, `images/nb_char_16bit_gd.png`,
  `images/nb_char_16bit_grill.png`,
  `images/nb_char_16bit_basketball.png`,
  `images/nb_char_16bit_vacation.png`, `images/nb_char_16bit_tux.png`, then
  `images/nb_char_16bit_pjs.png`.
- Message bubble: yellow, near the bottom of the LCD, max two lines.

The physical device buttons are not separate images. Create transparent circular
hit zones over `Tamagotchi.png`. When pressed, fill the circle with a translucent
accent color and scale to about `0.88`.

## Phone Call Flow

The `callme` menu is hidden behind a top-right menu in the iOS version. For a
webapp, this can be a small icon button that opens a modal with minute/second
inputs.

Call phases:

```ts
type CallPhase = "waiting" | "ringing" | "answered";
```

1. Start at `waiting` for the selected delay.
2. Move to `ringing`, show `images/nb_call_bg_ring.png`, and loop
   `audio/ring.mp3`.
3. On screen tap/click, move to `answered`, stop the ring, show
   `images/nb_call_bg_answered.png`, and start a visible call timer.
4. Wait `2000ms`, then play `audio/nussbaum_call.mp3`.
5. Close the call screen when `nussbaum_call.mp3` finishes.

The call image should be bottom-aligned and scaled like this:

```ts
const scale = Math.min(viewportWidth / 1320, viewportHeight / 2868);
const width = 1320 * scale;
const height = 2868 * scale;
const x = (viewportWidth - width) / 2;
const y = viewportHeight - height;
```

The answered-call timer belongs in the image's natural y-range `564...620`.
Scale that y-range into the rendered image frame and center a `m:ss` text label
there.

`images/nb_call_background.unused-reference.png` is not referenced by the
current Swift runtime. It is included as nearby source art in case the webapp
designer wants a neutral call screen background.

## Audio Notes

The iOS implementation uses `AVAudioPlayer`. The web version can use
`HTMLAudioElement`:

```ts
let currentAudio: HTMLAudioElement | null = null;

export function playAudio(src: string, { loop = false, onEnded }: {
  loop?: boolean;
  onEnded?: () => void;
} = {}) {
  currentAudio?.pause();
  const audio = new Audio(src);
  audio.loop = loop;
  audio.onended = onEnded ?? null;
  currentAudio = audio;
  void audio.play();
}

export function stopAudio() {
  currentAudio?.pause();
  currentAudio = null;
}
```

Browser autoplay policies matter. Audio triggered directly by taps, such as the
random phrase button, should work. The delayed `callme` ring may be blocked in
some browsers if the page has not had a user gesture recently. If that happens,
unlock audio once when the user starts `callme`, or require a tap to arm the
timer.

Random phrases used by the current app:

```ts
export const RANDOM_PHRASES = [
  "nb-altemeier-procedure",
  "nb-altmier",
  "nb-cbd-incision",
  "nb-cholangiogram-side",
  "nb-debakey",
  "nb-favorite",
  "nb-first",
  "nb-fistula",
  "nb-giant-duodenal-ulcer-2",
  "nb-giant-duodenal-ulcer",
  "nb-halsted",
  "nb-iknowwhatiwoulddo-1",
  "nb-iknowwhatiwoulddo-2",
  "nb-iknowwhatiwoulddo-3",
  "nb-lap-us",
  "nb-ng-suction",
  "nb-pyloric-channel-ulcer",
  "nb-retention-sutures",
  "nb-robert-cade",
  "nb-saline-drop-test",
  "nb-seprafilm-2",
  "nb-seprafilm-ostomy",
  "nb-seprafilm",
  "nb-shouldice",
  "nb-why-ct",
];
```

Use URLs like
`/tamagotchi/audio/RandomPhrases/${phraseName}.mp3`.

The top-level `audio/nb-first.mp3` is used for the hatch "first words" moment.
Several top-level clips duplicate files inside `RandomPhrases`; they are kept
here to preserve the original app bundle layout.

## Build Checklist For A Junior Developer

1. Create a new Vite React app.
2. Copy this directory's `images/` and `audio/` folders into
   `public/tamagotchi/`.
3. Create constants from the `Core Constants` section.
4. Build `TamagotchiDevice` as a scaled relative container with
   `Tamagotchi.png` as the base image.
5. Overlay the LCD rectangle and transparent circular button hit zones.
6. Implement the state model and hatch sequence timers.
7. Add the random phrase audio player.
8. Add outfit toggling with pixelated sprite rendering.
9. Add `callme`, the delayed ringing state, tap-to-answer behavior, and call
   completion.
10. Compare against the two screenshots in `screenshots/`.

## Acceptance Criteria

- The feature can open without any server data.
- Egg requires exactly three taps to hatch.
- Hatch plays `nb-first.mp3` and shows `His first words!`.
- Left button plays a random phrase only after hatch.
- Right button toggles between whitecoat and scrubs only after hatch.
- Button hit areas line up with the bitmap device buttons on mobile and desktop.
- `callme` rings after the selected delay, answers on tap, shows the answered
  phone screen and elapsed timer, plays `nussbaum_call.mp3`, then exits.
- Character sprites are pixelated, not smoothed.
- The webapp does not depend on Swift, Xcode, the surgery dashboard API, or any
  patient data.
