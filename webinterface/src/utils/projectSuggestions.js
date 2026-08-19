// Read the suggestion list, tolerating the single-suggestion response shape.
export function readRecommendations(payload) {
  if (!payload?.success) return [];
  const suggestions = Array.isArray(payload.recommendations)
    ? payload.recommendations
    : [payload.recommendation];
  return suggestions.filter((suggestion) => suggestion?.projectId);
}

// Resolve suggestions to the visible Compass path, dropping any the picker cannot show.
export function recommendationOptions(suggestions, projectGroups) {
  return suggestions.reduce((options, suggestion) => {
    for (const group of projectGroups) {
      const project = group.projects.find(({ _id }) => _id === suggestion.projectId);
      if (project) {
        options.push({
          projectId: suggestion.projectId,
          label: `${group.label} → ${project.title}`,
        });
        break;
      }
    }
    return options;
  }, []);
}
