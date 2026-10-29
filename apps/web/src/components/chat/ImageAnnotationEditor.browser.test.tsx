import { describe, expect, it, vi } from "vite-plus/test";

import { render } from "../../../test/render";
import { ImageAnnotationEditor } from "./ImageAnnotationEditor";

// A 1x1 red PNG; the editor re-encodes whatever Painterro saves, so the
// fixture only needs to decode.
const ONE_PIXEL_PNG_DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

describe("ImageAnnotationEditor", () => {
  it("mounts Painterro over the image and reports a saved PNG edit", async () => {
    const onApply = vi.fn();
    await using screen = await render(
      <ImageAnnotationEditor
        src={ONE_PIXEL_PNG_DATA_URL}
        name="screenshot.png"
        onCancel={() => {}}
        onApply={onApply}
      />,
    );

    // Painterro injects its toolbar and canvas into the holder element.
    const holder = (await vi.waitFor(
      () => {
        const element = document.querySelector("[id^='painterro-holder-']");
        expect(element).not.toBeNull();
        expect(element!.querySelector("canvas")).not.toBeNull();
        return element;
      },
      { timeout: 5000 },
    ))!;
    expect(holder.querySelectorAll("[class*='ptro']").length).toBeGreaterThan(0);

    // The runtime-injected inline styles must carry the icon font as a data
    // URL (or another resolvable URL); a blank toolbar is what a missing font
    // looks like.
    await vi.waitFor(() => {
      const fontStyle = [...document.querySelectorAll("style")].find((style) =>
        style.textContent?.includes("ptroiconfont"),
      );
      expect(fontStyle?.textContent).toContain("data:");
    });

    // Save routes through saveHandler into onApply as an editable PNG File.
    // The toolbar Save button is the icon button wrapping a `ptro-icon-save` span.
    const saveButton = await vi.waitFor(() => {
      const button = [...holder.querySelectorAll("button")].find((candidate) =>
        candidate.querySelector(".ptro-icon-save"),
      );
      expect(button).not.toBeUndefined();
      return button;
    });
    saveButton!.click();
    const file = await vi.waitFor(() => {
      expect(onApply).toHaveBeenCalledTimes(1);
      return onApply.mock.calls[0]![0] as File;
    });
    expect(file.name).toBe("screenshot-edited.png");
    expect(file.type).toBe("image/png");
    expect(file.size).toBeGreaterThan(0);
  });
});
