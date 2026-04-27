import { startListing } from "@agent-ix/ix-ui-cli";

export async function runElementsNew(_name: string): Promise<void> {
  const list = startListing("ix elements new");
  // FR-013: authoring a new element type (spec + cookiecutter scaffold)
  // Requires a meta-template (element-cookiecutter-cookiecutter) — tracked as future work.
  list.note("ix elements new is not yet implemented.");
  list.note("To create a new element type:");
  list.note(
    "  1. Create a new repo named <type>-cookiecutter (or <type>-element)",
  );
  list.note(
    "  2. Add a spec/spec.md with component_type: template and template_for: [<type>]",
  );
  list.note(
    "  3. Add the ix-element GitHub topic: gh repo edit --add-topic ix-element",
  );
  list.note("  4. Add your org as a tap: ix elements tap add github.com/<org>");
  list.warn("See above for manual steps.");
}
