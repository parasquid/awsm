interface PopupNavigation {
  readonly open: () => Promise<unknown>;
  readonly dismiss: () => Promise<unknown>;
}

export function navigateFromPopup(input: PopupNavigation): void {
  const opening = input.open();
  const dismissal = input.dismiss();
  void Promise.allSettled([opening, dismissal]);
}
