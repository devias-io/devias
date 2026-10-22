import { SUGGESTED_PROMPT_MAX_LENGTH, SUGGESTED_PROMPTS_MAX } from '@devias/core';
import { Button, Icon, Input } from '@devias/ui';

/** What an agent suggests on Home and in an empty conversation, each finishing "I want to …". Edited as a draft. */
export function StarterPrompts({ value, onChange }: { value: string[]; onChange: (prompts: string[]) => void }) {
  return (
    <div data-slot="starter-prompts">
      {value.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {value.map((prompt, index) => (
            <li key={index} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-xs text-muted-foreground">I want to</span>
              <Input
                aria-label={`Starter prompt ${index + 1}`}
                value={prompt}
                maxLength={SUGGESTED_PROMPT_MAX_LENGTH}
                placeholder="see which deals are likely to close this month"
                onChange={(event) => onChange(value.map((item, i) => (i === index ? event.target.value : item)))}
              />
              <Button
                variant="ghost"
                size="icon-sm"
                aria-label={`Remove starter prompt ${index + 1}`}
                className="text-muted-foreground"
                onClick={() => onChange(value.filter((_, i) => i !== index))}
              >
                <Icon name="x" />
              </Button>
            </li>
          ))}
        </ul>
      ) : null}
      <Button
        variant="outline"
        size="sm"
        className={value.length > 0 ? 'mt-3' : undefined}
        disabled={value.length >= SUGGESTED_PROMPTS_MAX}
        onClick={() => onChange([...value, ''])}
      >
        <Icon name="plus" /> Add a starter prompt
      </Button>
    </div>
  );
}
