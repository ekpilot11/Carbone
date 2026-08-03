import { useEffect, useRef, useState } from "react";
import {
  challengeFrameUrl,
  fetchChallenge,
  sendChallengeInput,
  type ChallengeStatus,
} from "../lib/api";
import type { Strings } from "../lib/i18n";

/**
 * The security check, brought to whoever is using the app.
 *
 * calc.apacrs.org occasionally asks a browser to prove there's a person
 * behind it. This project never answers that itself — a human ticks the box.
 * When the automation runs on the clinician's own machine, the window simply
 * appears in front of them. When it runs on a server, nobody is there, and
 * the check can't be moved elsewhere either: it only counts if it is passed
 * from the machine that is loading the site.
 *
 * So the window comes here instead. This shows a live picture of the real
 * browser and sends the clicks back to it — the person still looks at the
 * challenge and still clicks it, just from somewhere else.
 */
export function ChallengeOverlay({ t, active }: { t: Strings; active: boolean }) {
  const [challenge, setChallenge] = useState<ChallengeStatus | null>(null);
  const [nonce, setNonce] = useState(0);
  const [typed, setTyped] = useState("");
  const imgRef = useRef<HTMLImageElement>(null);

  // Only asked for while a calculation is in flight: a challenge window can
  // only exist during one, and polling an idle server is pointless traffic.
  useEffect(() => {
    if (!active) {
      setChallenge(null);
      return;
    }
    let stopped = false;
    const tick = async () => {
      const next = await fetchChallenge().catch(() => null);
      if (!stopped) setChallenge(next);
    };
    void tick();
    const timer = setInterval(tick, 2000);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [active]);

  // A new frame roughly once a second while the window is open. Slow enough
  // to be cheap, fast enough that a tick registers visibly.
  useEffect(() => {
    if (!challenge) return;
    const timer = setInterval(() => setNonce((n) => n + 1), 1000);
    return () => clearInterval(timer);
  }, [challenge]);

  if (!challenge) return null;

  const handleClick = async (event: React.MouseEvent<HTMLImageElement>) => {
    const img = imgRef.current;
    if (!img) return;
    // The picture is scaled to fit the screen; the browser it came from is
    // not, so the click has to be translated back into its coordinates.
    const rect = img.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / rect.width) * challenge.width;
    const y = ((event.clientY - rect.top) / rect.height) * challenge.height;
    await sendChallengeInput(challenge.id, { x, y });
    setNonce((n) => n + 1);
  };

  const handleType = async () => {
    if (typed === "") return;
    await sendChallengeInput(challenge.id, { text: typed });
    setTyped("");
    setNonce((n) => n + 1);
  };

  return (
    <div className="challenge-backdrop" role="dialog" aria-modal="true" aria-label={t.challengeTitle}>
      <div className="challenge-box">
        <h2>{t.challengeTitle}</h2>
        <p className="hint">{t.challengeHint}</p>
        <img
          ref={imgRef}
          className="challenge-frame"
          src={challengeFrameUrl(challenge.id, nonce)}
          alt={t.challengeTitle}
          width={challenge.width}
          height={challenge.height}
          onClick={handleClick}
        />
        <div className="challenge-typing">
          <input
            type="text"
            value={typed}
            placeholder={t.challengeTypePlaceholder}
            onChange={(event) => setTyped(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void handleType();
            }}
          />
          <button type="button" className="secondary" onClick={() => void handleType()}>
            {t.challengeSend}
          </button>
        </div>
        <p className="hint">{t.challengeWaiting(challenge.ageSeconds)}</p>
      </div>
    </div>
  );
}
