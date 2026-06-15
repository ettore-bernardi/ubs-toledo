// Registro do service worker (offline-first). Falha silenciosa se não suportado.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("sw.js").catch((err) =>
      console.warn("SW não registrado:", err)
    );
  });
}
