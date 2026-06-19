import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";

import { OptionBadgeButton } from "./trim-cells";

it("배지 hover 시 onPrefetch 호출", async () => {
  const user = userEvent.setup();
  const onPrefetch = vi.fn();
  render(<OptionBadgeButton summary={undefined} onClick={() => {}} onPrefetch={onPrefetch} />);
  await user.hover(screen.getByRole("button"));
  expect(onPrefetch).toHaveBeenCalledTimes(1);
});

it("onPrefetch 없이도 렌더된다(옵션 prop)", () => {
  render(<OptionBadgeButton summary={undefined} onClick={() => {}} />);
  expect(screen.getByRole("button")).toBeInTheDocument();
});
