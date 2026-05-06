import { Listing, Note, renderStatic } from "@agent-ix/ix-ui-cli";

export async function runElementsNew(_name: string): Promise<void> {
  // FR-013: authoring a new element type (spec + cookiecutter scaffold)
  // Requires a meta-template (element-cookiecutter-cookiecutter) — future work.
  await renderStatic(
    <Listing
      header="ix elements new"
      status="passed"
      tail="See above for manual steps."
      tailVariant="warn"
    >
      <Note>ix elements new is not yet implemented.</Note>
      <Note>To create a new element type:</Note>
      <Note>
        {"  1. Create a new repo named <type>-cookiecutter (or <type>-element)"}
      </Note>
      <Note>
        {
          "  2. Add a spec/spec.md with component_type: template and template_for: [<type>]"
        }
      </Note>
      <Note>
        {
          "  3. Add the ix-element GitHub topic: gh repo edit --add-topic ix-element"
        }
      </Note>
      <Note>
        {"  4. Add your org as a tap: ix elements tap add github.com/<org>"}
      </Note>
    </Listing>,
  );
}
