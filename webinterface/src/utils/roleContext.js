/**
 * Work vs personal. Stored only on the Role; goals, projects, and tasks derive it by
 * walking the chain. See docs/COMPASS.md.
 */

export const CONTEXTS = [
  { id: "work", label: "Work", icon: "\u{1F4BC}" },
  { id: "personal", label: "Personal", icon: "\u{1F3E0}" },
];

// The filter adds an "All" choice that no role ever carries.
export const CONTEXT_FILTERS = [{ id: "all", label: "All", icon: "" }, ...CONTEXTS];

const STORAGE_KEY = "compassContextFilter";

export function contextMeta(context) {
  return CONTEXTS.find((entry) => entry.id === context) || CONTEXTS[1];
}

export function filterRolesByContext(roles = [], context = "all") {
  if (context === "all") return roles;
  return roles.filter((role) => (role.context || "personal") === context);
}

// One remembered choice shared by Compass and Weekly Plan.
export function readContextFilter() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    return CONTEXT_FILTERS.some((entry) => entry.id === stored) ? stored : "all";
  } catch (error) {
    return "all";
  }
}

export function writeContextFilter(context) {
  try {
    window.localStorage.setItem(STORAGE_KEY, context);
  } catch (error) {
    // A blocked localStorage just means the choice is not remembered.
  }
}
