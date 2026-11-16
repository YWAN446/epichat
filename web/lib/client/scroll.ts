type ScrollPosition = { scrollHeight: number; scrollTop: number; clientHeight: number };

/** How close to the end still counts as "reading the latest message", in pixels. */
const NEAR = 120;
/** Closer than this is the end itself, allowing for rounding. */
const AT_END = 2;

function distanceFromEnd(position: ScrollPosition): number {
  return position.scrollHeight - position.scrollTop - position.clientHeight;
}

export function isNearBottom(position: ScrollPosition): boolean {
  return distanceFromEnd(position) <= NEAR;
}

/**
 * Whether a reply that is still arriving should keep moving the page down.
 * Any scroll up stops the following; it resumes when the reader is back near
 * the end. A page that grew leaves the position alone, so it changes nothing.
 */
export function keepFollowing(following: boolean, previousTop: number, position: ScrollPosition): boolean {
  if (position.scrollTop < previousTop) return distanceFromEnd(position) <= AT_END;
  if (isNearBottom(position)) return true;
  return following;
}
