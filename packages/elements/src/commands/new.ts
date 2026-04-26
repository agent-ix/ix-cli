import pc from "picocolors";
import { introCommand, outroSuccess } from "@agent-ix/ix-ui-cli";

export async function runElementsNew(_name: string): Promise<void> {
  introCommand("ix elements new");
  // FR-013: authoring a new element type (spec + cookiecutter scaffold)
  // Requires a meta-template (element-cookiecutter-cookiecutter) — tracked as future work.
  process.stdout.write(
    pc.yellow(
      "  ix elements new is not yet implemented.\n" +
        "  To create a new element type:\n" +
        "    1. Create a new repo named <type>-cookiecutter (or <type>-element)\n" +
        "    2. Add a spec/spec.md with component_type: template and template_for: [<type>]\n" +
        "    3. Add the ix-element GitHub topic: gh repo edit --add-topic ix-element\n" +
        "    4. Add your org as a tap: ix elements tap add github.com/<org>\n",
    ),
  );
  outroSuccess("See above for manual steps.");
}
