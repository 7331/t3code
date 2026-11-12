import { useAtomSet, useAtomValue } from "@effect/atom-react";
import { AsyncResult } from "effect/reactivity";

import { mobilePreferencesAtom, updateMobilePreferencesAtom } from "../../state/preferences";
import { SettingsSection } from "../settings/components/SettingsSection";
import { SettingsSwitchRow } from "../settings/components/SettingsSwitchRow";

export function AmbientSkyAppearanceSection() {
  const savePreferences = useAtomSet(updateMobilePreferencesAtom);
  const preferences = useAtomValue(mobilePreferencesAtom);
  const enabled = AsyncResult.isSuccess(preferences)
    ? preferences.value.ambientSkyEnabled !== false
    : null;

  return (
    <SettingsSection footer="Drifting ASCII stars and wind on empty screens while the Portal theme is on.">
      <SettingsSwitchRow
        disabled={enabled === null}
        icon="star"
        label="Ambient sky"
        value={enabled ?? true}
        onValueChange={(value) => savePreferences({ ambientSkyEnabled: value })}
      />
    </SettingsSection>
  );
}
