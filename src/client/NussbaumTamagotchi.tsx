import { ChevronLeft } from "lucide-react";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useRef, useState } from "react";

type Outfit = "whitecoat" | "scrubs";
type ButtonRole = "left" | "middle" | "right";

type PlayAudio = (src: string) => HTMLAudioElement | undefined;

const DEVICE = { width: 708, height: 1258 };
const LCD_RECT = { x: 130, y: 530, width: 450, height: 420 };
const BUTTON_RADIUS = 80;
const BUTTONS: Record<ButtonRole, { x: number; y: number; label: string }> = {
  left: { x: 216, y: 1140, label: "Play Dr. Nussbaum" },
  middle: { x: 356, y: 1170, label: "Mystery" },
  right: { x: 500, y: 1138, label: "Transform Dr. Nussbaum" }
};

const FIRST_WORDS_AUDIO = "/tamagotchi/audio/nb-first.mp3";
const OUTFIT_IMAGES: Record<Outfit, string> = {
  whitecoat: "/tamagotchi/images/nb_char_16bit_whitecoat.png",
  scrubs: "/tamagotchi/images/nb_char_16bit_scrubs.png"
};

const MYSTERY_EGG_MESSAGES = [
  "This egg is emitting weird surgical energy",
  "You hear 'scalpel' from inside",
  "This egg is spooky",
  "I wonder what is in the egg"
];

const RANDOM_PHRASES = [
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
  "nb-why-ct"
];

export function NussbaumTamagotchi({ onExit }: { onExit: () => void }) {
  const [hasStarted, setHasStarted] = useState(false);
  const [eggTapCount, setEggTapCount] = useState(0);
  const [eggCracked, setEggCracked] = useState(false);
  const [eggShakeCycle, setEggShakeCycle] = useState(0);
  const [hasHatched, setHasHatched] = useState(false);
  const [outfit, setOutfit] = useState<Outfit>("whitecoat");
  const [isTransforming, setIsTransforming] = useState(false);
  const [screenMessage, setScreenMessage] = useState<string | undefined>();
  const [pressedButton, setPressedButton] = useState<ButtonRole | undefined>();
  const audioRef = useRef<HTMLAudioElement | undefined>();
  const timeoutRefs = useRef<number[]>([]);
  const messageTimeoutRef = useRef<number | undefined>();
  const phraseDeckRef = useRef<string[]>(shufflePhrases(RANDOM_PHRASES));
  const phraseDeckIndexRef = useRef(0);
  const lastPhraseRef = useRef<string | undefined>();

  const stopAudio = useCallback(() => {
    if (!audioRef.current) return;
    audioRef.current.pause();
    audioRef.current.currentTime = 0;
    audioRef.current = undefined;
  }, []);

  const playAudio = useCallback<PlayAudio>(
    (src) => {
      stopAudio();
      const audio = new Audio(src);
      audio.onended = () => {
        if (audioRef.current === audio) audioRef.current = undefined;
      };
      audioRef.current = audio;
      void audio.play().catch(() => undefined);
      return audio;
    },
    [stopAudio]
  );

  const scheduleTimeout = useCallback((callback: () => void, delayMs: number) => {
    const timeout = window.setTimeout(callback, delayMs);
    timeoutRefs.current.push(timeout);
    return timeout;
  }, []);

  const showScreenMessage = useCallback((message: string, durationMs: number) => {
    if (messageTimeoutRef.current) window.clearTimeout(messageTimeoutRef.current);
    setScreenMessage(message);
    messageTimeoutRef.current = window.setTimeout(() => {
      setScreenMessage((current) => (current === message ? undefined : current));
      messageTimeoutRef.current = undefined;
    }, durationMs);
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onExit();
    };
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      timeoutRefs.current.forEach((timeout) => window.clearTimeout(timeout));
      if (messageTimeoutRef.current) window.clearTimeout(messageTimeoutRef.current);
      stopAudio();
    };
  }, [onExit, stopAudio]);

  function press(button: ButtonRole) {
    setPressedButton(button);
    scheduleTimeout(() => {
      setPressedButton((current) => (current === button ? undefined : current));
    }, 180);
  }

  function tapEgg() {
    if (hasStarted || hasHatched) return;
    const nextTapCount = eggTapCount + 1;
    setEggTapCount(nextTapCount);
    setEggShakeCycle((cycle) => cycle + 1);
    if (nextTapCount >= 3) runHatchSequence();
  }

  function runHatchSequence() {
    setHasStarted(true);
    scheduleTimeout(() => {
      setEggCracked(true);
      setEggShakeCycle((cycle) => cycle + 1);
    }, 420);
    scheduleTimeout(() => {
      setHasHatched(true);
      playAudio(FIRST_WORDS_AUDIO);
      showScreenMessage("His first words!", 2000);
    }, 1770);
  }

  function showMysteryEggMessage() {
    const message = MYSTERY_EGG_MESSAGES[Math.floor(Math.random() * MYSTERY_EGG_MESSAGES.length)];
    showScreenMessage(message, 2500);
  }

  function handleLeftButton() {
    press("left");
    if (!hasHatched) {
      showMysteryEggMessage();
      return;
    }
    const phraseName = nextPhraseName();
    playAudio(`/tamagotchi/audio/RandomPhrases/${phraseName}.mp3`);
  }

  function nextPhraseName(): string {
    if (phraseDeckIndexRef.current >= phraseDeckRef.current.length) {
      phraseDeckRef.current = shufflePhrases(RANDOM_PHRASES, lastPhraseRef.current);
      phraseDeckIndexRef.current = 0;
    }

    const phraseName = phraseDeckRef.current[phraseDeckIndexRef.current] ?? RANDOM_PHRASES[0];
    phraseDeckIndexRef.current += 1;
    lastPhraseRef.current = phraseName;
    return phraseName;
  }

  function handleMiddleButton() {
    press("middle");
    showScreenMessage("???", 1250);
  }

  function handleRightButton() {
    press("right");
    if (!hasHatched) {
      showMysteryEggMessage();
      return;
    }
    setIsTransforming(true);
    setOutfit((current) => (current === "whitecoat" ? "scrubs" : "whitecoat"));
    scheduleTimeout(() => setIsTransforming(false), 260);
  }

  return (
    <main className="nb-stage">
      <div className="nb-toolbar">
        <button type="button" className="secondary-button nb-back-button" onClick={onExit}>
          <ChevronLeft size={18} />
          Back
        </button>
      </div>

      <TamagotchiDevice
        hasHatched={hasHatched}
        eggCracked={eggCracked}
        eggShakeCycle={eggShakeCycle}
        outfit={outfit}
        isTransforming={isTransforming}
        screenMessage={screenMessage}
        pressedButton={pressedButton}
        onEggTap={tapEgg}
        onLeftButton={handleLeftButton}
        onMiddleButton={handleMiddleButton}
        onRightButton={handleRightButton}
      />
    </main>
  );
}

function TamagotchiDevice({
  hasHatched,
  eggCracked,
  eggShakeCycle,
  outfit,
  isTransforming,
  screenMessage,
  pressedButton,
  onEggTap,
  onLeftButton,
  onMiddleButton,
  onRightButton
}: {
  hasHatched: boolean;
  eggCracked: boolean;
  eggShakeCycle: number;
  outfit: Outfit;
  isTransforming: boolean;
  screenMessage?: string;
  pressedButton?: ButtonRole;
  onEggTap: () => void;
  onLeftButton: () => void;
  onMiddleButton: () => void;
  onRightButton: () => void;
}) {
  return (
    <section className="nb-device" aria-label="Dr. Nussbaum Tamagotchi">
      <img className="nb-device-shell" src="/tamagotchi/images/Tamagotchi.png" alt="" draggable={false} />
      <div className="nb-lcd" style={rectStyle(LCD_RECT)}>
        <div className="nb-scanlines" aria-hidden="true" />
        {hasHatched ? (
          <div className="nb-character-scene">
            <div className="nb-nameplate">Dr. Nussbaum</div>
            <img
              className={`nb-character${isTransforming ? " is-transforming" : ""}`}
              src={OUTFIT_IMAGES[outfit]}
              alt="Dr. Nussbaum"
              draggable={false}
            />
          </div>
        ) : (
          <button
            key={eggShakeCycle}
            type="button"
            className={`nb-egg-button${eggCracked ? " is-cracked" : ""}`}
            onClick={onEggTap}
            aria-label="Hatch egg"
          >
            <span className="nb-egg" aria-hidden="true" />
          </button>
        )}
        {screenMessage && <div className="nb-screen-message">{screenMessage}</div>}
      </div>

      {(["left", "middle", "right"] as const).map((role) => (
        <button
          key={role}
          type="button"
          className={`nb-physical-button${pressedButton === role ? " is-pressed" : ""}`}
          style={buttonStyle(BUTTONS[role])}
          aria-label={BUTTONS[role].label}
          onClick={role === "left" ? onLeftButton : role === "middle" ? onMiddleButton : onRightButton}
        />
      ))}
    </section>
  );
}

function rectStyle(rect: { x: number; y: number; width: number; height: number }): CSSProperties {
  return {
    left: `${(rect.x / DEVICE.width) * 100}%`,
    top: `${(rect.y / DEVICE.height) * 100}%`,
    width: `${(rect.width / DEVICE.width) * 100}%`,
    height: `${(rect.height / DEVICE.height) * 100}%`
  };
}

function buttonStyle(button: { x: number; y: number }): CSSProperties {
  return {
    left: `${((button.x - BUTTON_RADIUS) / DEVICE.width) * 100}%`,
    top: `${((button.y - BUTTON_RADIUS) / DEVICE.height) * 100}%`,
    width: `${((BUTTON_RADIUS * 2) / DEVICE.width) * 100}%`,
    height: `${((BUTTON_RADIUS * 2) / DEVICE.height) * 100}%`
  };
}

function shufflePhrases(phrases: string[], avoidFirst?: string): string[] {
  const shuffled = [...phrases];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  if (avoidFirst && shuffled.length > 1 && shuffled[0] === avoidFirst) {
    [shuffled[0], shuffled[1]] = [shuffled[1], shuffled[0]];
  }

  return shuffled;
}
