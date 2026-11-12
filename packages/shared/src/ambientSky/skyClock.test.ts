import { describe, expect, it } from "vite-plus/test";

import {
  SKY_FRAME_MILLISECONDS,
  SkyClock,
  type SkyHost,
  type SkyHostListeners,
} from "./skyClock.ts";

const frameSeconds = SKY_FRAME_MILLISECONDS / 1000;

function createFakeHost() {
  const timers = new Map<number, () => void>();
  let nextTimer = 1;
  const state = {
    active: true,
    now: 0,
    listeners: null as SkyHostListeners | null,
    listenCount: 0,
    requestedDelays: [] as number[],
  };
  const host: SkyHost<number> = {
    isActive: () => state.active,
    now: () => state.now,
    setTimer: (callback, milliseconds) => {
      const timer = nextTimer++;
      timers.set(timer, callback);
      state.requestedDelays.push(milliseconds);
      return timer;
    },
    clearTimer: (timer) => {
      timers.delete(timer);
    },
    listen: (listeners) => {
      state.listeners = listeners;
      state.listenCount += 1;
      return () => {
        state.listeners = null;
      };
    },
  };
  const advance = (milliseconds: number) => {
    state.now += milliseconds;
    const pending = [...timers.entries()];
    timers.clear();
    for (const [, callback] of pending) callback();
  };
  return { host, state, timers, advance };
}

function createMember(options: { moving: boolean }) {
  const member = {
    moving: options.moving,
    draws: [] as number[],
    layouts: 0,
    draw: (seconds: number) => member.draws.push(seconds),
    layout: () => {
      member.layouts += 1;
    },
  };
  return member;
}

describe("SkyClock", () => {
  it("ticks at the capped frame rate only while a member is moving", () => {
    const { host, state, timers, advance } = createFakeHost();
    const clock = new SkyClock(host);
    const member = createMember({ moving: false });
    clock.add(member);
    expect(member.layouts).toBe(1);
    expect(timers.size).toBe(0);

    member.moving = true;
    clock.schedule();
    expect(state.requestedDelays).toEqual([SKY_FRAME_MILLISECONDS]);
    expect(1000 / SKY_FRAME_MILLISECONDS).toBeLessThanOrEqual(12);
    advance(SKY_FRAME_MILLISECONDS);
    advance(SKY_FRAME_MILLISECONDS);
    expect(member.draws).toEqual([frameSeconds, frameSeconds * 2]);

    member.moving = false;
    advance(SKY_FRAME_MILLISECONDS);
    expect(timers.size).toBe(0);
  });

  it("pauses while the window is hidden or blurred and resumes without a time jump", () => {
    const { host, state, timers, advance } = createFakeHost();
    const clock = new SkyClock(host);
    const member = createMember({ moving: true });
    clock.add(member);
    advance(SKY_FRAME_MILLISECONDS);

    state.active = false;
    state.listeners?.onActivityChange();
    expect(timers.size).toBe(0);
    state.now += 60_000;

    state.active = true;
    state.listeners?.onActivityChange();
    advance(SKY_FRAME_MILLISECONDS);
    expect(member.draws).toEqual([frameSeconds, frameSeconds * 2]);
  });

  it("relayouts members on appearance changes", () => {
    const { host, state } = createFakeHost();
    const clock = new SkyClock(host);
    const member = createMember({ moving: false });
    clock.add(member);
    state.listeners?.onAppearanceChange();
    expect(member.layouts).toBe(2);
  });

  it("drops its timer and host listeners once the last member leaves", () => {
    const { host, state, timers } = createFakeHost();
    const clock = new SkyClock(host);
    const first = clock.add(createMember({ moving: true }));
    const second = clock.add(createMember({ moving: false }));
    expect(state.listenCount).toBe(1);

    first();
    expect(timers.size).toBe(0);
    expect(state.listeners).not.toBeNull();

    second();
    expect(state.listeners).toBeNull();

    clock.add(createMember({ moving: false }));
    expect(state.listenCount).toBe(2);
  });
});
