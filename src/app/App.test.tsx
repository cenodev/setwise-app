import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";

import { App } from "./App";

vi.mock("../features/pool-analytics/PoolPage", () => ({
  PoolPage: () => <section aria-label="Pool analytics integration">Integrated pool content</section>,
}));
vi.mock("../features/wallet/NetworkBanner", () => ({ NetworkBanner: () => null }));
vi.mock("../features/wallet/WalletButton", () => ({ WalletButton: () => null }));
vi.mock("../features/pwa/PwaStatus", () => ({ PwaStatus: () => null }));

describe("App pool route", () => {
  it("is directly navigable and appears in desktop and mobile navigation", () => {
    render(<MemoryRouter initialEntries={["/pool"]}><App /></MemoryRouter>);

    expect(screen.getByRole("heading", { name: "Pool overview" })).toBeVisible();
    expect(screen.getByLabelText("Pool analytics integration")).toBeVisible();
    expect(screen.getAllByRole("link", { name: "Pool" })).toHaveLength(2);
    expect(screen.getAllByRole("link", { name: "Pool" })[0]).toHaveAttribute("href", "/pool");
    expect(screen.getByText(/Reserve values are indicative/)).toBeVisible();
  });
});
