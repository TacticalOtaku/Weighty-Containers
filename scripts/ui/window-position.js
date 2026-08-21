const DEFAULT_WIDTH = 880;
const DEFAULT_HEIGHT = 720;
const MIN_WIDTH = 360;
const MIN_HEIGHT = 440;
const VIEWPORT_MARGIN = 24;

export const CONTAINER_RULES_WINDOW_SIZE = Object.freeze({
  width: DEFAULT_WIDTH,
  height: DEFAULT_HEIGHT
});

export function getCenteredWindowPosition(viewportWidth, viewportHeight) {
  const availableWidth = Math.max(MIN_WIDTH, viewportWidth - (VIEWPORT_MARGIN * 2));
  const availableHeight = Math.max(MIN_HEIGHT, viewportHeight - (VIEWPORT_MARGIN * 2));
  const width = Math.min(DEFAULT_WIDTH, availableWidth);
  const height = Math.min(DEFAULT_HEIGHT, availableHeight);

  return {
    width,
    height,
    left: Math.max(0, Math.round((viewportWidth - width) / 2)),
    top: Math.max(0, Math.round((viewportHeight - height) / 2))
  };
}
