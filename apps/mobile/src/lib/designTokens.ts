export const MOBILE_SHAPE = {
  // Portal's `--radius-card`.
  group: 16,
  // Portal's toast is a card too.
  toast: 16,
  // Portal's `--radius-popup`: floating surfaces such as popovers and the device bar.
  popup: 20,
  // Portal's `--radius-composer` on a phone.
  composer: 16,
} as const;

export const MOBILE_MOTION = {
  adjust: 120,
  enter: 200,
  exit: 150,
} as const;
