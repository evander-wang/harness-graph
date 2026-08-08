export function filesForStep(detail, step) {
  const prefix = detail.catalog.path.startsWith("harness/") ? "harness/" : "";
  const workflowPath = step.workflowName === detail.catalog.name
    ? detail.catalog.path
    : `${prefix}workflows/${step.workflowName}/workflow.yaml`;
  const paths = new Set([workflowPath]);
  if (step.call) paths.add(`${prefix}skills/${step.call}/SKILL.md`);
  step.checks.forEach((check) => paths.add(`${prefix}checks/${check}/CHECK.md`));
  return detail.files.filter((file) => paths.has(file.path));
}
