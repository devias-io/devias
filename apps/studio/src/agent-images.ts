/**
 * A test of agents drawn as images: abstract shader renders (PNGs in `public/agents`). An agent picks one as its icon,
 * `avatar-1` to `avatar-14` (`agent-avatar-1` to `agent-avatar-14`). An agent whose icon is not here keeps its line icon.
 */
const COUNT = 14;

export const agentImages: Record<string, string> = Object.fromEntries(
  Array.from({ length: COUNT }, (_, index) => [`avatar-${index + 1}`, `/agents/agent-avatar-${index + 1}.png`]),
);
