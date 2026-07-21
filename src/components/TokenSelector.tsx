import { useEffect, useId, useMemo, useRef, useState } from "react";

import { TokenIdentity, type TokenIdentityAsset } from "./TokenIdentity";

export type TokenSelectorOption = TokenIdentityAsset & { id: string };

export function TokenSelector<T extends TokenSelectorOption>({
  ariaLabel,
  chainId,
  disabled = false,
  isOptionDisabled = () => false,
  onChange,
  options,
  value,
}: {
  ariaLabel: string;
  chainId: number;
  disabled?: boolean;
  isOptionDisabled?: (option: T) => boolean;
  onChange: (id: string) => void;
  options: readonly T[];
  value: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const selected = options.find((option) => option.id === value) ?? options[0];
  const enabledOptions = useMemo(() => options.filter((option) => !isOptionDisabled(option)), [isOptionDisabled, options]);

  useEffect(() => {
    if (open) listRef.current?.focus();
  }, [open]);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  function choose(option: T) {
    if (isOptionDisabled(option)) return;
    onChange(option.id);
    close();
  }

  function moveSelection(direction: 1 | -1) {
    if (!enabledOptions.length) return;
    const current = enabledOptions.findIndex((option) => option.id === value);
    const next = enabledOptions[(current + direction + enabledOptions.length) % enabledOptions.length];
    if (next) onChange(next.id);
  }

  return (
    <div className="token-selector">
      <button ref={triggerRef} className="token-selector__trigger" type="button" role="combobox"
        aria-label={ariaLabel} aria-controls={listId} aria-expanded={open} aria-haspopup="listbox"
        disabled={disabled || !selected} onClick={() => setOpen((current) => !current)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            if (!open) setOpen(true);
            moveSelection(event.key === "ArrowDown" ? 1 : -1);
          }
        }}>
        {selected && <TokenIdentity asset={selected} chainId={chainId} compact />}
        <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <ul ref={listRef} className="token-selector__options" id={listId} role="listbox" tabIndex={-1}
          aria-label={ariaLabel} onKeyDown={(event) => {
            if (event.key === "Escape") { event.preventDefault(); close(); }
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              moveSelection(event.key === "ArrowDown" ? 1 : -1);
            }
          }}>
          {options.map((option) => {
            const optionDisabled = isOptionDisabled(option);
            return <li key={option.id} role="option" aria-selected={option.id === value} aria-disabled={optionDisabled}>
              <button type="button" disabled={optionDisabled} onClick={() => choose(option)}>
                <TokenIdentity asset={option} chainId={chainId} />
              </button>
            </li>;
          })}
        </ul>
      )}
      <span className="sr-only" aria-live="polite">{selected ? `Selected ${selected.symbol}` : "No token selected"}</span>
    </div>
  );
}
