/**
 * Role colours are derived, never stored, so nobody has to pick a hex code.
 *
 * Colour comes from a role's position in the list the API returns. That order is stable
 * (sorted by sortOrder then startDate), so a role keeps its colour across reloads, and
 * every page that renders the same payload agrees on it.
 */

// Distinct hues that hold up against the dark theme.
export const ROLE_PALETTE = [
  "#667eea", // indigo (the app's primary)
  "#10b981", // green
  "#f59e0b", // amber
  "#ec4899", // pink
  "#06b6d4", // cyan
  "#8b5cf6", // violet
  "#ef4444", // red
  "#84cc16", // lime
];

export function roleColorAt(index) {
  return ROLE_PALETTE[index % ROLE_PALETTE.length];
}

/**
 * Map every role id to its colour. Pass the roles array exactly as the API returned it so
 * the Compass page and the calendar derive the same colours.
 */
export function buildRoleColorMap(roles = []) {
  const colors = {};

  roles.forEach((role, index) => {
    colors[role._id] = roleColorAt(index);
  });

  return colors;
}
