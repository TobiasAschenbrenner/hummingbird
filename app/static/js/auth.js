const authDialog = document.querySelector("#auth-dialog");

if (authDialog) {
  const tabs = authDialog.querySelectorAll("[data-auth-view]");
  const forms = authDialog.querySelectorAll("[data-auth-form]");

  function selectAuthView(view) {
    for (const form of forms) {
      form.hidden = form.dataset.authForm !== view;
    }
    for (const tab of tabs) {
      tab.setAttribute("aria-pressed", String(tab.dataset.authView === view));
    }
  }

  for (const button of document.querySelectorAll("[data-open-auth]")) {
    button.addEventListener("click", () => authDialog.showModal());
  }
  authDialog
    .querySelector("[data-close-auth]")
    .addEventListener("click", () => authDialog.close());
  for (const tab of tabs) {
    tab.addEventListener("click", () => selectAuthView(tab.dataset.authView));
  }
  authDialog.addEventListener("click", (event) => {
    if (event.target !== authDialog) return;
    const bounds = authDialog.getBoundingClientRect();
    if (
      event.clientX < bounds.left ||
      event.clientX > bounds.right ||
      event.clientY < bounds.top ||
      event.clientY > bounds.bottom
    ) {
      authDialog.close();
    }
  });
}
