import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { useApp, SETUP_STEPS } from '../context/AppContext.jsx';

// PICO-8-style retro palette for the completion fireworks.
const PIXEL_COLORS = ['#ff004d', '#00e436', '#29adff', '#ffec27', '#ff77a8', '#ffa300'];

function completedCount(progress) {
  return SETUP_STEPS.filter(s => progress[s.key]).length;
}

// Shared progress visual — a thin fill bar plus a row of numbered circles that
// turn into checkmarks as each setup step completes. `compact` shrinks it for
// the Settings sanity-check card.
export function SetupStepCircles({ progress, compact = false }) {
  const done = completedCount(progress);
  const pct = Math.round((done / SETUP_STEPS.length) * 100);
  return (
    <div className={`setup-guide-circles${compact ? ' compact' : ''}`}>
      <div className="setup-guide-bar-track">
        <div className="setup-guide-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="setup-guide-steps">
        {SETUP_STEPS.map((step, i) => {
          const isDone = !!progress[step.key];
          const isActive = !isDone && i === done;
          return (
            <div key={step.key} className={`setup-guide-step${isDone ? ' done' : isActive ? ' active' : ''}`}>
              <div className="setup-guide-circle">{isDone ? '✓' : i + 1}</div>
              <span className="setup-guide-step-label">{step.label}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// Reference banner shown on the main view until all 4 setup steps are done —
// a quick "where am I in the initial Fusion → normalize → ProShop workflow"
// guide. Disappears for good once every step is checked off.
export function SetupGuideBanner() {
  const { setupProgress } = useApp();
  const navigate = useNavigate();
  if (SETUP_STEPS.every(s => setupProgress[s.key])) return null;
  const goToSettings = () => navigate('/settings');
  return (
    <div
      className="setup-guide-banner setup-guide-banner-link"
      role="button"
      tabIndex={0}
      onClick={goToSettings}
      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') goToSettings(); }}
      title="Open Settings — includes the ProShop export"
    >
      <div className="setup-guide-banner-text">
        <strong>Initial setup checklist</strong>
        <span className="text-sub text-xs">
          Connect the Fusion library, normalize it, merge in ProShop data, then export back —
          each step checks off automatically as you do it. Click to open Settings.
        </span>
      </div>
      <SetupStepCircles progress={setupProgress} />
      <ChevronRight size={18} className="setup-guide-banner-arrow" />
    </div>
  );
}

// Compact reference copy of the same checklist for Settings — "just a sanity
// check," so an established shop can confirm the workflow already ran.
export function SetupGuideSummary() {
  const { setupProgress } = useApp();
  return <SetupStepCircles progress={setupProgress} compact />;
}

// ─── Congratulations popup ─────────────────────────────────────────────────
// Fires once, the moment the 4th step completes in a live session — gated by
// a permanent localStorage flag so it never appears again (including for
// libraries seeded as already-established, which are marked celebrated upfront).
export function SetupCompleteModal() {
  const { setupProgress, setupCelebrated, markSetupCelebrated } = useApp();
  const [show, setShow] = useState(false);
  const allDone = SETUP_STEPS.every(s => setupProgress[s.key]);
  const bursts = useMemo(() => makeBursts(), []);

  useEffect(() => {
    if (allDone && !setupCelebrated()) setShow(true);
  }, [allDone, setupCelebrated]);

  if (!show) return null;

  const close = () => { markSetupCelebrated(); setShow(false); };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div className="modal setup-complete-modal" onClick={e => e.stopPropagation()}>
        <div className="pixel-fireworks">
          {bursts.map((burst, bi) => (
            <span key={bi} className="pixel-burst" style={{ left: `${burst.x}%`, top: `${burst.y}%` }}>
              {burst.particles.map((p, pi) => (
                <span
                  key={pi}
                  className="pixel"
                  style={{ '--dx': `${p.dx}px`, '--dy': `${p.dy}px`, '--delay': `${burst.delay + p.delay}ms`, background: p.color }}
                />
              ))}
            </span>
          ))}
        </div>
        <h3 className="modal-title setup-complete-title">SETUP COMPLETE</h3>
        <div className="modal-body">
          The Fusion library is connected, normalized, merged with ProShop data, and exported —
          the initial setup workflow is done. Settings keeps this checklist as a standing reference.
        </div>
        <div className="modal-actions">
          <button className="btn btn-primary" onClick={close}>Continue</button>
        </div>
      </div>
    </div>
  );
}

// Builds a handful of firework bursts, each spawning 8 square "pixels" that fly
// outward at even angles and fade — generated once via useMemo so replays don't
// reshuffle positions/colors on re-render.
function makeBursts() {
  const bursts = [];
  for (let b = 0; b < 5; b++) {
    const particles = [];
    for (let p = 0; p < 8; p++) {
      const angle = (Math.PI * 2 * p) / 8 + Math.random() * 0.4;
      const dist = 34 + Math.random() * 26;
      particles.push({
        dx: Math.round(Math.cos(angle) * dist),
        dy: Math.round(Math.sin(angle) * dist),
        delay: Math.round(Math.random() * 100),
        color: PIXEL_COLORS[Math.floor(Math.random() * PIXEL_COLORS.length)],
      });
    }
    bursts.push({
      x: 12 + Math.random() * 76,
      y: 12 + Math.random() * 56,
      delay: b * 260,
      particles,
    });
  }
  return bursts;
}
