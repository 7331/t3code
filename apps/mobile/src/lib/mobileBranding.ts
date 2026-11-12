export type MobileStageLabel = "Dev" | "Nightly";

/** The badge beside the brand: dev and nightly installs carry one; the Release app, like Portal, none. */
export function resolveMobileStageLabel(appVariant: unknown): MobileStageLabel | null {
  if (appVariant === "development") return "Dev";
  if (appVariant === "preview") return "Nightly";
  return null;
}
