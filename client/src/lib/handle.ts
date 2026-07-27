/** A player's @handle, short enough that it cannot widen the row it sits in.
 *
 *  Telegram usernames run to 32 characters with nothing to break a line on, and one like
 *  @enemyenemyenemyenemyenemy143 is wide enough to push a list row past the edge of the screen and
 *  take the whole page with it. The CSS truncates too, but that depends on a flex item being
 *  allowed to shrink below its own content — which WebKit does not reliably honour on the cross
 *  axis, so on iOS the ellipsis never bit and the layout went sideways. Cutting the string here as
 *  well leaves no engine a say in it. */
export function shortHandle(username: string | null, userId: number): string {
  const handle = username ? `@${username}` : `Игрок #${userId}`;
  return handle.length > 20 ? `${handle.slice(0, 19)}…` : handle;
}
