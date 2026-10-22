import { defineSettingsSection } from '@devias/core';
import { Label, RadioGroup, RadioGroupItem, Section, type Theme, useTheme } from '@devias/ui';

function AppearanceSettings() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="flex flex-col gap-4">
      <Section title="Theme" description="Applies to this browser only.">
        <RadioGroup value={theme} onValueChange={(value) => setTheme(value as Theme)} className="flex gap-6 pt-2">
          {(['light', 'dark', 'system'] as const).map((option) => (
            <Label key={option} className="flex items-center gap-2 text-xs font-normal capitalize">
              <RadioGroupItem value={option} /> {option}
            </Label>
          ))}
        </RadioGroup>
      </Section>
    </div>
  );
}

export const appearanceSection = defineSettingsSection({
  name: 'appearance',
  label: 'Appearance',
  icon: 'sun',
  group: 'account',
  component: AppearanceSettings,
});
