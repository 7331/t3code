export const SKY_FRAME_MILLISECONDS = 125;
const MAXIMUM_STEP_SECONDS = 0.25;

export interface SkyMember {
  readonly moving: boolean;
  readonly draw: (seconds: number) => void;
  readonly layout: (seconds: number) => void;
}

export interface SkyHostListeners {
  readonly onActivityChange: () => void;
  readonly onAppearanceChange: () => void;
}

export interface SkyHost {
  readonly isActive: () => boolean;
  readonly now: () => number;
  readonly setTimer: (callback: () => void, milliseconds: number) => number;
  readonly clearTimer: (timer: number) => void;
  readonly listen: (listeners: SkyHostListeners) => () => void;
}

export class SkyClock {
  private readonly members = new Set<SkyMember>();
  private playSeconds = 0;
  private lastTick = 0;
  private timer: number | null = null;
  private stopListening: (() => void) | null = null;
  private readonly host: SkyHost;

  constructor(host: SkyHost) {
    this.host = host;
  }

  get seconds(): number {
    return this.playSeconds;
  }

  add(member: SkyMember): () => void {
    this.members.add(member);
    this.stopListening ??= this.host.listen({
      onActivityChange: () => this.schedule(),
      onAppearanceChange: () => {
        for (const each of this.members) each.layout(this.playSeconds);
      },
    });
    member.layout(this.playSeconds);
    this.schedule();
    return () => {
      this.members.delete(member);
      this.schedule();
      if (this.members.size === 0) {
        this.stopListening?.();
        this.stopListening = null;
      }
    };
  }

  schedule(): void {
    const wanted = this.host.isActive() && [...this.members].some((member) => member.moving);
    if (wanted && this.timer === null) {
      this.lastTick = this.host.now();
      this.timer = this.host.setTimer(() => this.tick(), SKY_FRAME_MILLISECONDS);
    } else if (!wanted && this.timer !== null) {
      this.host.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private tick(): void {
    this.timer = null;
    const now = this.host.now();
    this.playSeconds += Math.min((now - this.lastTick) / 1000, MAXIMUM_STEP_SECONDS);
    this.lastTick = now;
    for (const member of this.members) if (member.moving) member.draw(this.playSeconds);
    this.schedule();
  }
}

export function createBrowserSkyHost(): SkyHost {
  return {
    isActive: () => document.visibilityState === "visible" && document.hasFocus(),
    now: () => performance.now(),
    setTimer: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
    clearTimer: (timer) => window.clearTimeout(timer),
    listen: ({ onActivityChange, onAppearanceChange }) => {
      window.addEventListener("focus", onActivityChange);
      window.addEventListener("blur", onActivityChange);
      document.addEventListener("visibilitychange", onActivityChange);
      const appearance = new MutationObserver(onAppearanceChange);
      appearance.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class", "data-theme-id"],
      });
      let listening = true;
      void document.fonts.ready.then(() => {
        if (listening) onAppearanceChange();
      });
      return () => {
        listening = false;
        window.removeEventListener("focus", onActivityChange);
        window.removeEventListener("blur", onActivityChange);
        document.removeEventListener("visibilitychange", onActivityChange);
        appearance.disconnect();
      };
    },
  };
}
