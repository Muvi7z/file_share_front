export function createHoldToSpeed(
  media: Pick<HTMLVideoElement, "paused" | "ended" | "playbackRate">,
  onActive: (active: boolean) => void
) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let previousRate: number | undefined;
  let consumed = false;
  const stop = () => {
    clearTimeout(timer);
    timer = undefined;
    if (previousRate !== undefined) {
      media.playbackRate = previousRate;
      previousRate = undefined;
      onActive(false);
    }
  };
  return {
    start() {
      stop();
      consumed = false;
      if (media.paused || media.ended) return;
      timer = setTimeout(() => {
        timer = undefined;
        if (media.paused || media.ended) return;
        previousRate = media.playbackRate;
        consumed = true;
        media.playbackRate = 2;
        onActive(true);
      }, 450);
    },
    stop,
    consumeClick() {
      const result = consumed;
      consumed = false;
      return result;
    }
  };
}
