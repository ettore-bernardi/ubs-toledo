/* UBS Toledo — app principal (Leaflet, sem framework). */
(() => {
  "use strict";

  // Versão do app, mostrada no rodapé. Mantida em sincronia com a VERSAO do sw.js
  // pelo deploy/bump-sw.sh — assim o rodapé reflete o código que está REALMENTE
  // rodando (se mostrar a versão antiga, o cache antigo ainda está ativo).
  const APP_VERSION = "ubs-toledo-20260615-090238";

  // Ícones do Leaflet servidos localmente (offline).
  L.Icon.Default.prototype.options.imagePath = "vendor/images/";
  delete L.Icon.Default.prototype._getIconUrl;
  L.Icon.Default.mergeOptions({
    iconUrl: "vendor/images/marker-icon.png",
    iconRetinaUrl: "vendor/images/marker-icon-2x.png",
    shadowUrl: "vendor/images/marker-shadow.png",
  });

  // Pino padrão (azul) e pino destacado (maior + halo via classe CSS .pin-destaque).
  const iconePadrao = new L.Icon.Default();
  const iconeDestaque = L.icon({
    iconUrl: "vendor/images/marker-icon.png",
    iconRetinaUrl: "vendor/images/marker-icon-2x.png",
    shadowUrl: "vendor/images/marker-shadow.png",
    iconSize: [34, 55],
    iconAnchor: [17, 55],
    popupAnchor: [0, -50],
    shadowSize: [55, 55],
    className: "pin-destaque",
  });

  const TOLEDO = [-24.7253, -53.7417];
  const els = {
    map: document.getElementById("map"),
    lista: document.getElementById("lista-bairros"),
    busca: document.getElementById("busca"),
    visaoLista: document.getElementById("visao-lista"),
    visaoDetalhe: document.getElementById("visao-detalhe"),
    detalhe: document.getElementById("detalhe"),
    voltar: document.getElementById("btn-voltar"),
  };

  let mapa, camadaBairros, marcadores;
  let bairros, ubsPorId, cobertura;
  let camadaSelecionada = null;
  const marcadoresPorUbs = new Map(); // id da UBS -> [markers]
  let ubsDestacada = null;

  const estiloBase = { color: "#0a6b4f", weight: 1.5, fillColor: "#0a6b4f", fillOpacity: 0.12 };
  const estiloHover = { weight: 2.5, fillOpacity: 0.25 };
  const estiloSel = { color: "#c0392b", weight: 3, fillColor: "#c0392b", fillOpacity: 0.3 };

  // ---- utilidades de contato ----
  const soDigitos = (s) => (s || "").replace(/\D/g, "");

  function telHref(tel) {
    // Pega o primeiro número (campos podem ter "x / y" ou observações).
    const d = soDigitos((tel || "").split("/")[0]);
    return d.length >= 8 ? `tel:+55${d}` : null;
  }

  function wppHref(wpp) {
    const d = soDigitos((wpp || "").split("(")[0] || wpp);
    // whatsapp válido: DDD + número (10 ou 11 dígitos).
    return d.length >= 10 ? `https://wa.me/55${d}` : null;
  }

  // ---- inicialização ----
  async function init() {
    const rodape = document.getElementById("rodape");
    if (rodape) rodape.textContent = APP_VERSION;

    mapa = L.map(els.map, { zoomControl: true }).setView(TOLEDO, 13);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(mapa);
    marcadores = L.layerGroup().addTo(mapa);

    try {
      const [b, u, c] = await Promise.all([
        fetch("data/bairros.geojson").then((r) => r.json()),
        fetch("data/ubs.json").then((r) => r.json()),
        fetch("data/cobertura.json").then((r) => r.json()),
      ]);
      bairros = b;
      cobertura = c;
      ubsPorId = new Map(u.map((x) => [x.id, x]));
    } catch (err) {
      els.detalhe.textContent = "Não foi possível carregar os dados.";
      console.error(err);
      return;
    }

    renderPoligonos();
    desenharTodosMarcadores();
    renderLista("");
    els.busca.addEventListener("input", (e) => renderLista(e.target.value));
    els.voltar.addEventListener("click", mostrarLista);

    // Deep link: #bairro=NOME abre direto o detalhe (compartilhável).
    abrirDoHash();
    window.addEventListener("hashchange", abrirDoHash);
  }

  function abrirDoHash() {
    const m = /#bairro=(.+)/.exec(location.hash);
    if (!m) return;
    const alvo = decodeURIComponent(m[1]).toUpperCase();
    const feat = bairros.features.find((f) => f.properties.nm_bairro === alvo);
    if (feat) selecionarBairro(alvo);
  }

  function renderPoligonos() {
    camadaBairros = L.geoJSON(bairros, {
      style: () => estiloBase,
      onEachFeature: (feature, layer) => {
        const nome = feature.properties.nm_bairro;
        layer.bindTooltip(nome, { sticky: true });
        layer.on({
          mouseover: () => { if (layer !== camadaSelecionada) layer.setStyle(estiloHover); },
          mouseout: () => { if (layer !== camadaSelecionada) layer.setStyle(estiloBase); },
          click: () => selecionarBairro(nome, layer),
        });
      },
    }).addTo(mapa);
    mapa.fitBounds(camadaBairros.getBounds(), { padding: [20, 20] });
  }

  function renderLista(filtro) {
    const f = filtro.trim().toLowerCase();
    const nomes = bairros.features
      .map((x) => x.properties.nm_bairro)
      .filter((n) => n.toLowerCase().includes(f))
      .sort((a, b) => a.localeCompare(b, "pt-BR"));

    els.lista.innerHTML = "";
    if (!nomes.length) {
      const li = document.createElement("li");
      li.className = "vazio";
      li.textContent = "Nenhum bairro encontrado.";
      els.lista.appendChild(li);
      return;
    }
    for (const nome of nomes) {
      const ubs = ubsPorId.get(cobertura[nome]);
      const li = document.createElement("li");
      li.innerHTML = `${nome}<span class="sub">${ubs ? ubs.nome : "—"}</span>`;
      li.addEventListener("click", () => selecionarBairro(nome));
      els.lista.appendChild(li);
    }
  }

  function camadaDoBairro(nome) {
    let achada = null;
    camadaBairros.eachLayer((l) => {
      if (l.feature.properties.nm_bairro === nome) achada = l;
    });
    return achada;
  }

  function selecionarBairro(nome, layer) {
    layer = layer || camadaDoBairro(nome);
    if (camadaSelecionada) camadaSelecionada.setStyle(estiloBase);
    camadaSelecionada = layer;
    if (layer) layer.setStyle(estiloSel);

    const ubs = ubsPorId.get(cobertura[nome]);
    if (decodeURIComponent(location.hash) !== `#bairro=${nome}`) {
      history.replaceState(null, "", `#bairro=${encodeURIComponent(nome)}`);
    }
    renderDetalhe(nome, ubs);
    mostrarDetalhe();
    destacarUbs(ubs ? ubs.id : null);

    // Enquadra bairro + UBS.
    const bounds = layer ? layer.getBounds() : null;
    const pts = (ubs ? ubs.unidades : [])
      .filter((un) => un.lat != null)
      .map((un) => [un.lat, un.lng]);
    if (bounds && pts.length) bounds.extend(pts);
    if (bounds) mapa.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
  }

  // Desenha (uma vez) o pino de toda unidade com coordenada, indexado por UBS.
  function desenharTodosMarcadores() {
    for (const ubs of ubsPorId.values()) {
      for (const un of ubs.unidades) {
        if (un.lat == null) continue;
        const m = L.marker([un.lat, un.lng], { icon: iconePadrao }).bindPopup(
          `<strong>${ubs.nome}</strong><br>${un.nome}<br>${un.endereco}`
        );
        m.addTo(marcadores);
        if (!marcadoresPorUbs.has(ubs.id)) marcadoresPorUbs.set(ubs.id, []);
        marcadoresPorUbs.get(ubs.id).push(m);
      }
    }
  }

  // Destaca os pinos da UBS informada (null = remove o destaque atual).
  function destacarUbs(id) {
    if (ubsDestacada === id) return;
    for (const m of marcadoresPorUbs.get(ubsDestacada) || []) {
      m.setIcon(iconePadrao).setZIndexOffset(0);
    }
    ubsDestacada = id;
    const markers = marcadoresPorUbs.get(id) || [];
    markers.forEach((m) => m.setIcon(iconeDestaque).setZIndexOffset(1000));
    if (markers.length) markers[0].openPopup();
  }

  function campo(rotulo, valorHtml) {
    return `<div class="campo"><span class="rotulo">${rotulo}</span><span>${valorHtml}</span></div>`;
  }

  function renderDetalhe(nome, ubs) {
    if (!ubs) {
      els.detalhe.innerHTML =
        `<p class="detalhe-bairro">${nome}</p>` +
        `<p>Não há UBS atribuída a este bairro nos dados disponíveis. ` +
        `Procure a Secretaria de Saúde de Toledo.</p>`;
      return;
    }

    const unidadesHtml = ubs.unidades.map((un) => renderUnidade(un)).join("");
    const equipes = (ubs.equipes || []).join(" · ");

    els.detalhe.innerHTML =
      `<p class="detalhe-bairro">Seu bairro: ${nome}</p>` +
      `<h2 class="detalhe-nome">${ubs.nome}</h2>` +
      `<span class="detalhe-tipo">${ubs.tipo}</span>` +
      (equipes ? `<p class="equipes">${equipes}</p>` : "") +
      `<div class="aviso">` +
      `<strong>⚠️ Confirme antes de ir</strong>` +
      `A UBS responsável pelo seu bairro é uma estimativa por proximidade e ` +
      `<b>pode estar incorreta</b>. Ligue ou mande WhatsApp para a unidade ` +
      `para confirmar antes de se deslocar.` +
      `</div>` +
      unidadesHtml +
      (ubs.url
        ? campo("Site oficial", `<a href="${ubs.url}" target="_blank" rel="noopener">Página da UBS ↗</a>`)
        : "");
  }

  function renderUnidade(un) {
    const tel = telHref(un.telefone);
    const wpp = wppHref(un.whatsapp);
    let html = `<div class="unidade"><h3>${un.nome}</h3>`;
    html += campo("Endereço", un.endereco || "—");
    if (un.horario_funcionamento) html += campo("Horário", un.horario_funcionamento);
    if (un.gerente) html += campo("Gerente", un.gerente);
    if (un.telefone) {
      html += campo("Telefone", tel ? `<a href="${tel}">${un.telefone}</a>` : un.telefone);
    }
    if (un.email) html += campo("E-mail", `<a href="mailto:${un.email}">${un.email}</a>`);

    // Ações
    html += `<div class="acoes">`;
    if (un.lat != null) {
      const local = `${un.lat},${un.lng}`;
      // Abre o local (pino) no app de mapas — sem rota, sem pedir localização.
      // Sem target="_blank": no PWA standalone do iOS, links _blank são ignorados
      // (toque não faz nada). Navegação na própria aba aciona o universal link.
      html += `<a class="acao-rota" href="https://www.google.com/maps/search/?api=1&query=${local}">Como chegar</a>`;
    } else {
      html += `<a class="acao-rota" disabled>Localização indisponível</a>`;
    }
    if (tel) html += `<a class="acao-tel" href="${tel}">Ligar</a>`;
    if (wpp) html += `<a class="acao-wpp" href="${wpp}" target="_blank" rel="noopener">WhatsApp</a>`;
    html += `</div>`;
    if (un.lat == null) {
      html += `<p class="sem-coords">Sem localização exata no mapa — confirme o endereço com a unidade.</p>`;
    }
    html += `</div>`;
    return html;
  }

  function mostrarDetalhe() {
    els.visaoLista.hidden = true;
    els.visaoDetalhe.hidden = false;
    els.detalhe.parentElement.scrollTop = 0;
  }
  function mostrarLista() {
    if (location.hash) history.replaceState(null, "", location.pathname);
    els.visaoDetalhe.hidden = true;
    els.visaoLista.hidden = false;
    if (camadaSelecionada) {
      camadaSelecionada.setStyle(estiloBase);
      camadaSelecionada = null;
    }
    destacarUbs(null);
  }

  // Banner de instalação PWA.
  let promptInstalar = null;
  const btnInstalar = document.getElementById("btn-instalar");
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    promptInstalar = e;
    btnInstalar.hidden = false;
  });
  btnInstalar.addEventListener("click", async () => {
    if (!promptInstalar) return;
    promptInstalar.prompt();
    await promptInstalar.userChoice;
    promptInstalar = null;
    btnInstalar.hidden = true;
  });

  init();
})();
