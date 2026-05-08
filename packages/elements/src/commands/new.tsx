import {
  GLYPH_DIM_DOT,
  Listing,
  Note,
  Text,
  renderStatic,
} from "@agent-ix/ix-ui-cli";

export async function runElementsNew(_name: string): Promise<void> {
  // FR-013: authoring a new element type (spec + cookiecutter scaffold)
  // Requires a meta-template (element-cookiecutter-cookiecutter) — future work.
  await renderStatic(
    <Listing
      header="ix elements new"
      status="passed"
      variant="flow"
      pre={<Text>{` ${GLYPH_DIM_DOT} Authoring a new element type`}</Text>}
      tail="Not yet implemented — see manual steps above."
      tailVariant="warn"
    >
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
